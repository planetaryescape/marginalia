// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoveryTabs } from "./test/discovery-tabs";
import { topicSearchCache } from "./topic-search-cache";
import {
  invalidateTopicSearchCache,
  type TopicSearch,
  useTopicSearch,
} from "./use-topic-search";

const mocks = vi.hoisted(() => ({
  // SAFETY: mutable fixture slot includes logout; the initial value is a string.
  session: "session-a" as string | null,
  counts: { waiting: 2 },
  // SAFETY: mutable server fixture covers pending, unsupported and valid epochs.
  revision: "0" as string | null | undefined,
  post: vi.fn(),
  convex: { query: vi.fn(async () => []) },
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: mocks.session ? { session: { id: mocks.session } } : null,
    }),
  },
}));
vi.mock("convex/react", () => ({
  useConvex: () => mocks.convex,
  useQuery: () => mocks.revision,
}));
vi.mock("@/lib/topic-search-request", () => ({ postTopicSearch: mocks.post }));

let result: TopicSearch;
function Probe({
  mode = "typing",
  enabled = true,
}: {
  mode?: "typing" | "list";
  enabled?: boolean;
}) {
  result = useTopicSearch("attention", enabled, 0, mode);
  return null;
}
const match = {
  articleId: "a",
  title: "Attention",
  author: null,
  source: null,
  minutes: 3,
  status: "Up next",
};
let root: Root;
let tabs: ReturnType<typeof discoveryTabs>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.session = "session-a";
  mocks.counts = { waiting: 2 };
  mocks.revision = "0";
  mocks.post.mockReset();
  window.dispatchEvent(new Event("pagehide"));
  tabs = discoveryTabs();
  window.dispatchEvent(new Event("pageshow"));
  invalidateTopicSearchCache();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  window.dispatchEvent(new Event("pagehide"));
  tabs.close();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = (props: Parameters<typeof Probe>[0] = {}) =>
  act(async () => root.render(<Probe {...props} />));
const tick = (ms = 250) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("topic search cache phases", () => {
  it("reuses cards and explanations after remount only after the same initial epoch is confirmed", async () => {
    mocks.post.mockImplementation((path) =>
      Promise.resolve(
        path === "find"
          ? { matches: [match], more: false }
          : { matches: [{ ...match, reason: "Fits" }] },
      ),
    );
    await render();
    await tick();
    await act(async () => root.render(null));
    mocks.revision = undefined;
    await render();
    await tick();
    expect(mocks.post).toHaveBeenCalledTimes(2);
    mocks.revision = "0";
    await render();
    await tick();
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(result.reasons).toEqual({ a: "Fits" });
  });

  it("does not start a legacy paid fallback when an invalidated find returns 404", async () => {
    let reject: (reason: Response) => void = () => {};
    mocks.post.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    await render();
    await tick();
    await act(async () => tabs.remote.publish());
    await act(async () => reject(new Response(null, { status: 404 })));
    expect(mocks.post.mock.calls.map(([path]) => path)).toEqual(["find"]);
  });
  it("a remote successful edit evicts cards/reasons without refreshing unchanged input", async () => {
    mocks.post.mockImplementation((path) =>
      Promise.resolve(
        path === "find"
          ? { matches: [match], more: false }
          : { matches: [{ ...match, reason: "Fits" }] },
      ),
    );
    await render();
    await tick();
    expect(result.reasons).toEqual({ a: "Fits" });
    const snapshot = result;
    await act(async () => tabs.remote.publish());
    await render(); // unrelated rerender with exactly the same input
    await tick(500);
    expect(mocks.post.mock.calls.map(([path]) => path)).toEqual([
      "find",
      "search",
    ]);
    expect(result).toBe(snapshot);
    expect(topicSearchCache.get("attention")).toBeUndefined();
    await render({ enabled: false });
    await render({ mode: "list" });
    await tick(0);
    expect(mocks.post.mock.calls.map(([path]) => path)).toEqual([
      "find",
      "search",
      "find",
    ]);
  });

  it("rejects a late in-flight remote-invalidated result even while still mounted", async () => {
    let resolve: (value: { matches: (typeof match)[]; more: boolean }) => void =
      () => {};
    mocks.post.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await render();
    await tick();
    await act(async () => tabs.remote.publish());
    await act(async () => resolve({ matches: [match], more: false }));
    expect(mocks.post).toHaveBeenCalledTimes(1); // no downstream explanation
    expect(result.status).toBe("error"); // existing explicit Retry, never stuck loading
    expect(topicSearchCache.get("attention")).toBeUndefined();
    expect(result.matches).toEqual([]);
    mocks.post.mockResolvedValue({ matches: [], more: false });
    await render({ enabled: false });
    await render();
    await tick();
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it.each([
    null,
    "session-b",
  ])("fences a delayed result across logout/switch to %s", async (session) => {
    let resolve: (value: { matches: (typeof match)[]; more: boolean }) => void =
      () => {};
    mocks.post.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await render();
    await tick();
    mocks.session = session;
    await render();
    await act(async () => resolve({ matches: [match], more: false }));
    expect(topicSearchCache.get("attention")).toBeUndefined();
    expect(result.matches).toEqual([]);
  });
  it("never requests explanations for a disabled or invalidated list-only search", async () => {
    mocks.post.mockResolvedValue({ matches: [match], more: false });
    await render({ mode: "list", enabled: false });
    await tick(500);
    expect(mocks.post).not.toHaveBeenCalled();
    await render({ mode: "list" });
    await tick(0);
    await render({ mode: "list", enabled: false });
    invalidateTopicSearchCache();
    await render({ mode: "list" });
    await tick(0);
    expect(mocks.post.mock.calls.map(([path]) => path)).toEqual([
      "find",
      "find",
    ]);
  });
  it("does not extend old card freshness when only explanations are retried", async () => {
    mocks.post.mockImplementation((path) =>
      path === "find"
        ? Promise.resolve({ matches: [match], more: false })
        : Promise.reject(new Error("offline")),
    );
    await render();
    await tick();
    await tick(4 * 60_000);
    await render({ enabled: false });
    await render();
    await tick(0);
    expect(
      mocks.post.mock.calls.filter(([path]) => path === "find"),
    ).toHaveLength(1);
    await tick(60_000);
    await render({ enabled: false });
    await render({ mode: "list" });
    await tick(0);
    expect(
      mocks.post.mock.calls.filter(([path]) => path === "find"),
    ).toHaveLength(2);
  });
  it("committed lists start immediately and never request unused explanations", async () => {
    mocks.post.mockResolvedValue({ matches: [match], more: false });
    await render({ mode: "list" });
    await tick(0);
    expect(mocks.post.mock.calls.map(([path]) => path)).toEqual(["find"]);
    expect(result.matches).toEqual([match]);
    expect(result.explained).toBe(true);
  });

  it("keeps cards after closing before an explanation, and only retries reasons", async () => {
    mocks.post.mockImplementation((path) =>
      path === "find"
        ? Promise.resolve({ matches: [match], more: false })
        : new Promise(() => {}),
    );
    await render();
    await tick();
    expect(result.matches).toHaveLength(1);
    await render({ enabled: false });
    await render();
    expect(result.matches).toHaveLength(1);
    await tick(0);
    expect(mocks.post.mock.calls.map(([path]) => path)).toEqual([
      "find",
      "search",
      "search",
    ]);
  });

  it("keeps cards when explanations fail and reuses them in list-only mode", async () => {
    mocks.post.mockImplementation((path) =>
      path === "find"
        ? Promise.resolve({ matches: [match], more: false })
        : Promise.reject(new Error("offline")),
    );
    await render();
    await tick();
    expect(result.status).toBe("ready");
    await render({ enabled: false });
    await render({ mode: "list" });
    await tick(0);
    expect(result.matches).toHaveLength(1);
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it("caches empty finds and evicts server revisions without provider auto-retry", async () => {
    mocks.post.mockResolvedValue({ matches: [], more: false });
    await render();
    await tick();
    await render({ enabled: false });
    await render();
    await tick();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    mocks.session = "session-b";
    await render();
    await tick();
    expect(mocks.post).toHaveBeenCalledTimes(2);
    mocks.revision = "1";
    await render();
    await tick();
    expect(mocks.post).toHaveBeenCalledTimes(2);
    await render({ enabled: false });
    await render();
    await tick();
    expect(mocks.post).toHaveBeenCalledTimes(3);
  });

  it("waits for initial revision registration and fences a revision racing with a late 404", async () => {
    mocks.revision = undefined;
    await render();
    await tick();
    expect(mocks.post).not.toHaveBeenCalled();
    mocks.revision = "0";
    let reject: (reason: Response) => void = () => {};
    mocks.post.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    await render();
    await tick();
    mocks.revision = "1";
    await render();
    await act(async () => reject(new Response(null, { status: 404 })));
    expect(mocks.post.mock.calls.map(([path]) => path)).toEqual(["find"]);
    expect(topicSearchCache.get("attention")).toBeUndefined();
  });
});
