// @vitest-environment happy-dom
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ScriptureStudyFollowUps } from "./scripture-study-follow-ups";

type QuestionRow = {
  requestKey?: string;
  id: string;
  question: string;
  status: string;
  answer: { answer: string; evidenceIds: string[] } | null;
};
const state = vi.hoisted(() => {
  const rows: QuestionRow[] = [];
  return { rows, ask: vi.fn(), cancel: vi.fn() };
});
vi.mock("convex/react", () => ({
  useQuery: () => state.rows,
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref).endsWith(":ask") ? state.ask : state.cancel,
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.rows = [];
  state.ask.mockReset();
  state.cancel.mockReset();
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
// SAFETY: synthetic IDs are consumed only by the mocked Convex boundary.
const render = () =>
  act(() =>
    root.render(
      <ScriptureStudyFollowUps
        runId={"run-1" as Id<"scriptureStudyRuns">}
        renderCitations={(ids) => <span>{ids.map(() => "[1]")}</span>}
      />,
    ),
  );
function type(value: string) {
  const input = host.querySelector("textarea");
  if (!input) throw new Error("Missing question input");
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const submit = () =>
  host
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
it("does no automatic generation, preserves a question draft across unmount, and sends exactly one explicit request", async () => {
  render();
  expect(state.ask).not.toHaveBeenCalled();
  type("What is the argument here?");
  expect(sessionStorage.getItem("marginalia:study-question:run-1")).toBe(
    "What is the argument here?",
  );
  act(() => root.render(null));
  render();
  expect(host.querySelector("textarea")?.value).toBe(
    "What is the argument here?",
  );
  let finish: (() => void) | undefined;
  state.ask.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  act(() => {
    submit();
    submit();
  });
  expect(state.ask).toHaveBeenCalledTimes(1);
  expect(state.ask).toHaveBeenCalledWith({
    runId: "run-1",
    question: "What is the argument here?",
    requestKey: expect.any(String),
  });
  await act(async () => finish?.());
  expect(host.querySelector("textarea")?.value).toBe("");
  expect(sessionStorage.getItem("marginalia:study-question:run-1")).toBeNull();
});
it("retains the draft and reuses the request key after an uncertain admission", async () => {
  state.ask
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue("answer-1");
  render();
  type("Why does this matter?");
  await act(async () => {
    submit();
  });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "draft is still here",
  );
  expect(host.querySelector("textarea")?.value).toBe("Why does this matter?");
  act(() => root.render(null));
  render();
  await act(async () => {
    submit();
  });
  expect(state.ask.mock.calls[0][0].requestKey).toBe(
    state.ask.mock.calls[1][0].requestKey,
  );
});
it("starts a new attempt after an uncertain request is confirmed failed, rather than reusing its failed key forever", async () => {
  state.ask
    .mockRejectedValueOnce(new Error("uncertain"))
    .mockResolvedValue("q2");
  render();
  type("Explain this?");
  await act(async () => {
    submit();
  });
  const firstKey = state.ask.mock.calls[0][0].requestKey;
  state.rows = [
    {
      id: "q1",
      requestKey: firstKey,
      question: "Explain this?",
      status: "failed",
      answer: null,
    },
  ];
  render();
  expect(host.querySelector("textarea")?.value).toBe("Explain this?");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => {
    submit();
  });
  expect(state.ask.mock.calls[1][0].requestKey).not.toBe(firstKey);
});
it("clears a stale transport error when the saved row confirms the question, without generating again", async () => {
  state.ask.mockRejectedValueOnce(new Error("uncertain"));
  render();
  type("Explain this?");
  await act(async () => {
    submit();
  });
  state.rows = [
    {
      id: "q1",
      requestKey: state.ask.mock.calls[0][0].requestKey,
      question: "Explain this?",
      status: "complete",
      answer: { answer: "Saved answer", evidenceIds: ["web-1"] },
    },
  ];
  render();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector("textarea")?.value).toBe("");
  expect(state.ask).toHaveBeenCalledTimes(1);
});

it("replays saved answers safely, stops unfinished answers and keeps the next draft", async () => {
  state.rows = [
    {
      id: "q1",
      question: "First?",
      status: "complete",
      answer: {
        answer: "<script>Not executable</script>",
        evidenceIds: ["web-1"],
      },
    },
    { id: "q2", question: "Second?", status: "running", answer: null },
  ];
  render();
  type("My next question");
  expect(host.querySelector("script")).toBeNull();
  expect(host.textContent).toContain("<script>Not executable</script>[1]");
  expect(state.ask).not.toHaveBeenCalled();
  const stop = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Stop answer",
  );
  await act(async () => stop?.click());
  expect(state.cancel).toHaveBeenCalledWith({ id: "q2" });
  expect(host.querySelector("textarea")?.value).toBe("My next question");
});
it("does not offer a dead retry action after the attempt limit is reached", () => {
  state.rows = Array.from({ length: 24 }, (_, index) => ({
    id: `failed-${index}`,
    question: "Previous question",
    status: "failed",
    answer: null,
  }));
  render();
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).toContain("follow-up limit");
  expect(
    [...host.querySelectorAll("button")].some(
      (button) => button.textContent === "Ask again",
    ),
  ).toBe(false);
  expect(state.ask).not.toHaveBeenCalled();
});
