// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidateTopicSearchCache,
  type TopicSearch,
  useTopicSearch,
} from "./use-topic-search";

const mocks = vi.hoisted(() => ({
  session: "session-a",
  counts: { waiting: 2 },
  post: vi.fn(),
  convex: { query: vi.fn(async () => []) },
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { session: { id: mocks.session } } }),
  },
}));
vi.mock("convex/react", () => ({
  useConvex: () => mocks.convex,
  useQuery: () => mocks.counts,
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
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.session = "session-a";
  mocks.counts = { waiting: 2 };
  mocks.post.mockReset();
  invalidateTopicSearchCache();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
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

  it("caches empty finds and forgets them across sessions and queue revisions", async () => {
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
    mocks.counts = { waiting: 3 };
    await render();
    await tick();
    expect(mocks.post).toHaveBeenCalledTimes(3);
  });
});
