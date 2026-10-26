// @vitest-environment happy-dom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { useSessionRecorder } from "./use-session-recorder";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  record: vi.fn(async () => {}),
  update: vi.fn(async () => {}),
}));
vi.mock("convex/react", () => ({
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    return name === "sessions:create"
      ? state.create
      : name === "sessions:recordInteraction"
        ? state.record
        : state.update;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
});
it("opens immediately while the exact original session resolves after unmount", async () => {
  let resolve: (id: string) => void = () => {};
  state.create.mockReturnValue(
    new Promise<string>((r) => {
      resolve = r;
    }),
  );
  let recorder: ReturnType<typeof useSessionRecorder> | undefined;
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  function Probe() {
    recorder = useSessionRecorder({ requestedMinutes: 17 });
    return null;
  }
  await act(async () => root.render(<Probe />));
  // SAFETY: the mocked Convex mutation consumes this synthetic ID only inside the fixture.
  const query = recorder?.open("article" as never);
  expect(query).toMatch(/^sessionKey=[\da-f-]{36}&minutes=17$/);
  expect(state.record).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  await act(async () => {
    resolve("session-original");
    await Promise.resolve();
  });
  expect(state.record).toHaveBeenCalledWith({
    articleId: "article",
    sessionId: "session-original",
    action: "opened",
  });
  expect(state.update).toHaveBeenCalledWith({
    articleId: "article",
    sessionId: "session-original",
    readingStatus: "reading",
  });
  host.remove();
});

it("keeps the opening key after a failed creation and retries attribution after navigation", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  state.create
    .mockRejectedValueOnce(new Error("temporary"))
    .mockResolvedValueOnce("retry-session");
  let recorder: ReturnType<typeof useSessionRecorder> | undefined;
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  function Probe() {
    recorder = useSessionRecorder({ requestedMinutes: 23 });
    return null;
  }
  await act(async () => root.render(<Probe />));
  // SAFETY: the mocked Convex mutation consumes this synthetic ID only inside the fixture.
  const query = recorder?.open("article" as never);
  expect(query).toContain("minutes=23");
  await act(async () => {
    await Promise.resolve();
  });
  expect(state.create).toHaveBeenCalledTimes(2);
  expect(state.create.mock.calls[0]).toEqual(state.create.mock.calls[1]);
  expect(state.record).toHaveBeenCalledWith({
    articleId: "article",
    sessionId: "retry-session",
    action: "opened",
  });
  await act(async () => root.unmount());
  host.remove();
  log.mockRestore();
});
