// @vitest-environment happy-dom

import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type SavedAnswerBody,
  useSavedAnswerBody,
} from "./use-saved-answer-body";

const mocks = vi.hoisted(() => ({ query: vi.fn(), onOpen: vi.fn() }));
vi.mock("convex/react", () => ({ useConvex: () => mocks }));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: { companionThreads: { getBody: "getBody" } },
}));

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
let hook: ReturnType<typeof useSavedAnswerBody>;
function Harness({ scope }: { scope: string }) {
  hook = useSavedAnswerBody(
    { articleId, unitIndex: scope === "article:0" ? 0 : 1 },
    mocks.onOpen,
  );
  return (
    <p>
      {hook.pendingId} {hook.error}
    </p>
  );
}
async function render(scope = "article:0") {
  await act(async () => root.render(<Harness scope={scope} />));
}
// SAFETY: synthetic IDs exercise client request lifetimes; Convex owns ID validation.
const threadId = "thread1" as Id<"companionThreads">;
// SAFETY: synthetic article ID belongs only to this isolated client fixture.
const articleId = "article1" as Id<"articles">;
const body: SavedAnswerBody = {
  _id: threadId,
  articleId,
  answerId: undefined,
  mode: "ask",
  selection: "",
  question: undefined,
  paragraphIndex: undefined,
  summaryDefinition: undefined,
  unitIndex: 0,
  turns: [],
  model: undefined,
  keptAt: undefined,
  createdAt: 1,
  updatedAt: 1,
  legacyOversized: false,
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.query.mockReset();
  mocks.onOpen.mockReset();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("loads only the chosen body and does not request anything before opening", async () => {
  mocks.query.mockResolvedValue(body);
  await render();
  expect(mocks.query).not.toHaveBeenCalled();
  await act(async () => hook.open(body._id));
  expect(mocks.query).toHaveBeenCalledWith("getBody", { threadId: body._id });
  expect(mocks.onOpen).toHaveBeenCalledWith(body);
  expect(hook.pendingId).toBeNull();
});

it("ignores folded, superseded and round-trip book-part responses", async () => {
  const resolve: ((body: SavedAnswerBody) => void)[] = [];
  mocks.query.mockImplementation(
    () => new Promise<SavedAnswerBody>((done) => resolve.push(done)),
  );
  await render();
  act(() => {
    void hook.open(body._id);
  });
  act(() => hook.cancel());
  await act(async () => resolve[0](body));
  expect(mocks.onOpen).not.toHaveBeenCalled();
  act(() => {
    void hook.open(body._id);
  });
  await render("article:1");
  await render("article:0");
  await act(async () => resolve[1](body));
  expect(mocks.onOpen).not.toHaveBeenCalled();
  act(() => {
    void hook.open(body._id);
    void hook.open(body._id);
  });
  await act(async () => resolve[2](body));
  expect(mocks.onOpen).not.toHaveBeenCalled();
  await act(async () => resolve[3](body));
  expect(mocks.onOpen).toHaveBeenCalledTimes(1);
});

it("retains a visible load failure for retry without invoking companion or writing", async () => {
  mocks.query
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(body);
  await render();
  await act(async () => hook.open(body._id));
  expect(host.textContent).toContain("Couldn't load the answer");
  expect(mocks.onOpen).not.toHaveBeenCalled();
  await act(async () => hook.open(body._id));
  expect(mocks.onOpen).toHaveBeenCalledTimes(1);
  expect(hook.error).toBeNull();
});

it("does not reopen an owned answer from a different book part", async () => {
  mocks.query.mockResolvedValue({ ...body, unitIndex: 99 });
  await render();
  await act(async () => hook.open(body._id));
  expect(mocks.onOpen).not.toHaveBeenCalled();
  expect(hook.error).toContain("no longer available");
});

it("does not reopen after the reader unmounts", async () => {
  let resolve: (body: SavedAnswerBody) => void = () => {};
  mocks.query.mockImplementation(
    () =>
      new Promise<SavedAnswerBody>((done) => {
        resolve = done;
      }),
  );
  await render();
  act(() => {
    void hook.open(body._id);
  });
  await act(async () => root.render(null));
  await act(async () => resolve(body));
  expect(mocks.onOpen).not.toHaveBeenCalled();
});
