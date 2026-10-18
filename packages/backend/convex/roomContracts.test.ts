import { describe, expect, it } from "vitest";
import { ownerTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

describe("small room contracts", () => {
  it("keeps source summaries compact and reader-owned while preserving failures", async () => {
    const t = await ownerTest(modules);
    await t.run(async (ctx) => {
      for (const source of [
        { userId: "default_user", title: "Healthy" },
        {
          userId: "default_user",
          title: "Failed",
          lastError: "private error detail",
        },
        {
          userId: "other-reader",
          title: "Foreign",
          lastError: "foreign error",
        },
      ])
        await ctx.db.insert("feeds", {
          ...source,
          url: "https://example.test/feed",
          articleCount: 0,
          isActive: true,
          createdAt: 1,
        });
    });
    expect(await t.query(api.feeds.statusSummary, {})).toEqual({
      count: 2,
      failingCount: 1,
      failedTitle: "Failed",
    });
  });
  it("keeps unknown counts unknown without falling back to article hydration", async () => {
    const t = await ownerTest(modules);
    expect(await t.query(api.home.counts, {})).toMatchObject({
      countsReady: false,
      annotatedTotal: null,
      waiting: null,
      fits: { 5: null, 10: null, 20: null, 30: null },
    });
  });

  it("returns only owned small headers, deduplicates ids and handles deleted articles", async () => {
    const t = await ownerTest(modules);
    const [owned, foreign, removed] = await t.run(async (ctx) => {
      const add = (userId: string) =>
        ctx.db.insert("articles", {
          userId,
          guid: userId,
          url: "https://example.test/article",
          title: userId,
          extractionStatus: "extracted",
          annotationStatus: "annotated",
          createdAt: 1,
          content: "A long body that must never be shipped for a heading",
        });
      const a = await add("default_user");
      const b = await add("another-reader");
      const c = await add("deleted");
      await ctx.db.delete(c);
      return [a, b, c];
    });
    const rows = await t.query(api.articles.headers, {
      articleIds: [owned, foreign, removed, owned],
    });
    expect(rows).toEqual([
      {
        articleId: owned,
        article: { title: "default_user", url: "https://example.test/article" },
      },
      { articleId: foreign, article: null },
      { articleId: removed, article: null },
    ]);
    await expect(
      t.query(api.articles.headers, { articleIds: Array(9).fill(owned) }),
    ).rejects.toThrow("Too many");
  });

  it("counts the same recent impressions without shipping article bodies", async () => {
    const t = await ownerTest(modules);
    await t.run(async (ctx) => {
      const articleId = await ctx.db.insert("articles", {
        userId: "default_user",
        guid: "g",
        url: "https://example.test",
        title: "Read",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
      for (const rating of [undefined, 4])
        await ctx.db.insert("impressions", {
          userId: "default_user",
          articleId,
          rating,
          tags: [],
          createdAt: 1,
          updatedAt: 1,
        });
    });
    expect(await t.query(api.impressions.recentCount, {})).toBe(1);
    expect(await t.query(api.impressions.listRecent, {})).toHaveLength(1);
  });
});
