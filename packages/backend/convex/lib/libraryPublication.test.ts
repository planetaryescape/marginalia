import { getFunctionName } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { findLibraryArticles, retrieveLibraryContext } from "./library";
import { startTimings } from "./serverTiming";

afterEach(() => vi.unstubAllGlobals());
const embedding = Array.from({ length: 1536 }, () => 1);

it.each([
  "find",
  "retrieve",
] as const)("%s joins publication on search, hydration, activity and Stop exits", async (mode) => {
  for (const failure of ["search", "hydration", "activity", "stop"] as const) {
    if (mode === "find" && failure === "activity") continue;
    const caller = new AbortController();
    let publish!: () => void;
    const publication = new Promise<void>((resolve) => {
      publish = resolve;
    });
    const runMutation = vi.fn().mockImplementation(() => {
      if (failure === "stop") caller.abort();
      return publication;
    });
    const runQuery = vi.fn().mockImplementation(async (ref) => {
      const name = getFunctionName(ref);
      if (name === "queryEmbeddings:lookup") return null;
      if (name === "library:recentActivity") {
        if (failure === "activity") throw new Error("activity failed");
        return { impressions: [], interactions: [] };
      }
      if (failure === "hydration") throw new Error("hydration failed");
      if (name === "library:loadMatches")
        return { impressions: [], notes: [], highlights: [], threads: [] };
      return [];
    });
    const vectorSearch = vi.fn().mockImplementation(async () => {
      if (failure === "search") throw new Error("search failed");
      return [];
    });
    vi.stubGlobal("fetch", async () =>
      Response.json({ data: [{ index: 0, embedding }] }),
    );
    const ctx = { runMutation, runQuery, vectorSearch };
    const target = {
      provider: "openai" as const,
      apiKey: "fixture",
      signal: caller.signal,
    };
    let settled = false;
    const request =
      mode === "find"
        ? findLibraryArticles(ctx, "reader", "query", target, startTimings())
        : retrieveLibraryContext(ctx, "reader", "query", target);
    const pending = request.then(
      () => {
        settled = true;
        return null;
      },
      (error) => {
        settled = true;
        return error;
      },
    );
    await vi.waitFor(() => expect(runMutation).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    publish();
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(settled).toBe(true);
  }
});

it("cache publication failure cannot fail an otherwise successful find", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({ data: [{ index: 0, embedding }] }),
  );
  const ctx = {
    runMutation: vi.fn().mockRejectedValue(new Error("cache unavailable")),
    runQuery: vi.fn().mockResolvedValueOnce(null).mockResolvedValue([]),
    vectorSearch: vi.fn().mockResolvedValue([]),
  };
  expect(
    await findLibraryArticles(
      ctx,
      "reader",
      "query",
      { provider: "openai", apiKey: "fixture" },
      startTimings(),
    ),
  ).toEqual({ matches: [], more: false });
});
