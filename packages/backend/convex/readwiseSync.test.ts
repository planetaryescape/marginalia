/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerTest } from "../test/owner";
import { api, internal } from "./_generated/api";

vi.mock("./lib/aiModels", () => ({
  embedText: vi.fn().mockResolvedValue(undefined),
}));
const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Reader backfill action", () => {
  it("imports beyond the former 100-item cap and resumes across pages without paid model calls", async () => {
    vi.useFakeTimers();
    vi.stubEnv("READWISE_TOKEN", "isolated-test-token");
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      const offset = Number(url.searchParams.get("pageCursor") ?? "0");
      const results =
        url.searchParams.get("location") === "new"
          ? Array.from({ length: Math.min(5, 125 - offset) }, (_, i) => ({
              id: `reader-${offset + i}`,
              url: `https://example.com/${offset + i}`,
              source_url: null,
              title: `Piece ${offset + i}`,
              category: "article",
              parent_id: null,
              html_content: "<p>Some article text.</p>",
            }))
          : [];
      return new Response(
        JSON.stringify({
          results,
          nextPageCursor:
            results.length && offset + 5 < 125 ? String(offset + 5) : null,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const t = await ownerTest(modules);
    // An already-connected account must still discover its older, unchanged items.
    await t.run((ctx) =>
      ctx.db.insert("userSettings", {
        userId: "default_user",
        readwiseSyncedAt: 12345,
        updatedAt: 12345,
      }),
    );
    for (let step = 0; step < 28; step++) {
      await t.action(internal.actions.readwiseSync.sync, {
        userId: "default_user",
      });
      vi.setSystemTime(Date.now() + 61_000);
    }
    const status = await t.query(api.readwise.status, {});
    expect(status.progress).toMatchObject({
      active: false,
      backfilling: false,
      imported: 125,
      scanned: 125,
    });
    expect(
      await t.query(internal.readwise.findArticle, {
        userId: "default_user",
        readerDocumentId: "reader-124",
      }),
    ).toMatchObject({ title: "Piece 124" });
    expect(fetchMock).toHaveBeenCalledTimes(28);
    for (const [url] of fetchMock.mock.calls)
      expect(new URL(url).searchParams.has("updatedAfter")).toBe(false);
    const articleIds = await t.run(async (ctx) =>
      (await ctx.db.query("articles").take(200)).map((a) => a.readerDocumentId),
    );
    expect(new Set(articleIds).size).toBe(125);
  });

  it("skips unsupported and missing-text documents without abandoning the following article", async () => {
    vi.stubEnv("READWISE_TOKEN", "isolated-test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              { id: "pdf", category: "pdf", parent_id: null },
              {
                id: "empty",
                category: "article",
                parent_id: null,
                url: "https://example.com/empty",
              },
              {
                id: "good",
                category: "article",
                parent_id: null,
                url: "https://example.com/good",
                html_content: "<p>Good.</p>",
              },
            ],
            nextPageCursor: null,
          }),
        ),
      ),
    );
    const t = await ownerTest(modules);
    await t.action(internal.actions.readwiseSync.sync, {
      userId: "default_user",
    });
    expect((await t.query(api.readwise.status, {})).progress).toMatchObject({
      scanned: 3,
      skipped: 2,
      imported: 1,
      phase: "Later",
    });
  });
});
