// @vitest-environment happy-dom
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScriptureStudy } from "./use-scripture-study";

const mock = vi.hoisted(() => ({
  admit: vi.fn(),
  cancel: vi.fn(),
  hash: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useMutation: (fn: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(fn) === "scriptureStudy:start" ? mock.admit : mock.cancel,
}));
vi.mock("@marginalia/backend/prepared-representation", () => ({
  sourceHash: mock.hash,
}));
// SAFETY: Test-only opaque IDs are never submitted to a real backend.
const articleId = "article-fixture" as Id<"articles">;
// SAFETY: Test-only opaque IDs are never submitted to a real backend.
const studyId = "study-fixture" as Id<"scriptureStudies">;
// SAFETY: Test-only opaque IDs are never submitted to a real backend.
const runId = "run-fixture" as Id<"scriptureStudyRuns">;
const selection = {
  referenceKey: "PSA.23.4",
  startVerseId: "PSA.23.4",
  endVerseId: "PSA.23.4",
  versificationId: "web" as const,
};
let controller: ReturnType<typeof useScriptureStudy>;
let root: Root;
let host: HTMLDivElement;
function Fixture() {
  controller = useScriptureStudy({
    _id: articleId,
    content: "23:4 saved WEB",
    contentHtml: "<p>saved WEB</p>",
  });
  return <p>{controller.pane?.selection.referenceKey}</p>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.admit
    .mockReset()
    .mockResolvedValue({ studyId, runId, admission: "started" });
  mock.cancel.mockReset().mockResolvedValue(null);
  mock.hash.mockReset().mockResolvedValue("saved-source-hash");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Fixture />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Explicit Study admission and stale intent fencing", () => {
  it("does not generate on render or reopen; submits only the saved source proof", async () => {
    expect(mock.admit).not.toHaveBeenCalled();
    await act(async () => controller.start(selection));
    expect(mock.hash).toHaveBeenCalledWith(
      "23:4 saved WEB",
      "<p>saved WEB</p>",
    );
    expect(mock.admit).toHaveBeenCalledOnce();
    expect(mock.admit.mock.calls[0][0]).toEqual({
      articleId,
      selection,
      sourceHash: "saved-source-hash",
      requestKey: expect.any(String),
    });
    act(() => root.render(<Fixture />));
    await act(async () => controller.reopen(studyId, selection, runId));
    expect(mock.admit).toHaveBeenCalledOnce();
  });

  it("cancels a late admission after the pane was closed, without reopening it", async () => {
    const gate = deferred<{
      studyId: typeof studyId;
      runId: typeof runId;
      admission: string;
    }>();
    mock.admit.mockReturnValueOnce(gate.promise);
    let pending: Promise<void>;
    await act(async () => {
      pending = controller.start(selection);
    });
    expect(controller.pane?.pending).toBe(true);
    let closing: Promise<boolean>;
    await act(async () => {
      closing = controller.close();
    });
    expect(controller.pane?.pending).toBe(true);
    await act(async () => {
      gate.resolve({ studyId, runId, admission: "started" });
      await pending;
      await closing;
    });
    expect(mock.cancel).toHaveBeenCalledWith({ studyId, runId });
    expect(controller.pane).toBeNull();
  });

  it("coalesces repeated starts while the same selection is being admitted", async () => {
    const gate = deferred<{
      studyId: typeof studyId;
      runId: typeof runId;
      admission: string;
    }>();
    mock.admit.mockReturnValueOnce(gate.promise);
    let first: Promise<void>, second: Promise<void>;
    await act(async () => {
      first = controller.start(selection);
    });
    await act(async () => {
      second = controller.start({ ...selection });
    });
    expect(mock.admit).toHaveBeenCalledOnce();
    await act(async () => {
      gate.resolve({ studyId, runId, admission: "started" });
      await first;
      await second;
    });
    expect(mock.cancel).not.toHaveBeenCalled();
    expect(controller.pane?.studyId).toBe(studyId);
  });

  it("does not replace a pane when cancellation fails and retries explicitly", async () => {
    await act(async () => controller.start(selection));
    mock.cancel.mockRejectedValueOnce(new Error("offline"));
    let closed: boolean | undefined;
    await act(async () => {
      closed = await controller.close();
    });
    expect(closed).toBe(false);
    expect(controller.pane?.studyId).toBe(studyId);
    expect(controller.pane?.error).toContain("Could not confirm cancellation");
    await act(async () => {
      closed = await controller.close();
    });
    expect(closed).toBe(true);
    expect(controller.pane).toBeNull();
  });

  it("fences a selection replaced before source hashing finishes", async () => {
    const gate = deferred<string>();
    mock.hash.mockReturnValueOnce(gate.promise);
    let pending: Promise<void>;
    await act(async () => {
      pending = controller.start(selection);
    });
    const next = {
      ...selection,
      referenceKey: "PSA.23.5",
      startVerseId: "PSA.23.5",
      endVerseId: "PSA.23.5",
    };
    await act(async () => controller.start(next));
    await act(async () => {
      gate.resolve("old-source");
      await pending;
    });
    expect(mock.admit).toHaveBeenCalledOnce();
    expect(mock.admit.mock.calls[0][0].selection).toEqual(next);
    expect(controller.pane?.selection).toEqual(next);
  });
});
