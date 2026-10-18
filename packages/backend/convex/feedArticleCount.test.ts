/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownerTest, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function insertFeed(ctx: MutationCtx, userId: string, count?: number) {
  return ctx.db.insert("feeds", {
    userId,
    url: `https://example.com/${userId}.xml`,
    title: userId,
    isActive: true,
    articleCount: count,
    createdAt: Date.now(),
  });
}

/** A row written directly, so it doesn't touch the counter. */
function rawArticle(
  ctx: MutationCtx,
  userId: string,
  feedId: Id<"feeds">,
  n: number,
) {
  return ctx.db.insert("articles", {
    userId,
    feedId,
    guid: `${userId}-${n}`,
    url: `https://example.com/${userId}/${n}`,
    title: `Post ${n}`,
    extractionStatus: "extracted",
    annotationStatus: "annotated",
    createdAt: Date.now(),
  });
}

const post = (userId: string, feedId: Id<"feeds">, n: number) => ({
  feedId,
  userId,
  guid: `${userId}-${n}`,
  url: `https://example.com/${userId}/${n}`,
  title: `Post ${n}`,
  extractionStatus: "pending" as const,
  annotationStatus: "pending" as const,
  createdAt: Date.now(),
});

const countOf = (t: Awaited<ReturnType<typeof ownerTest>>, id: Id<"feeds">) =>
  t.run(async (ctx) => (await ctx.db.get(id))?.articleCount);

describe("a feed's article count", () => {
  it("starts at zero for a feed added now", async () => {
    const t = await ownerTest(modules);
    const feedId = await t.mutation(api.feeds.add, {
      url: "https://example.com/new.xml",
      title: "New",
    });
    expect(await countOf(t, feedId)).toBe(0);
  });

  it("goes up with each article inserted and down with each one removed", async () => {
    const t = await ownerTest(modules);
    const feedId = await t.run((ctx) => insertFeed(ctx, OWNER, 0));
    for (const n of [1, 2, 3])
      await t.mutation(internal.articles.insert, post(OWNER, feedId, n));
    expect(await countOf(t, feedId)).toBe(3);

    await t.mutation(api.feeds.remove, { feedId, articles: "all" });
    // The feed is gone; recreate the case on a feed that stays
    const kept = await t.run((ctx) => insertFeed(ctx, OWNER, 0));
    const ids: Id<"articles">[] = [];
    for (const n of [4, 5, 6, 7])
      ids.push(
        await t.mutation(internal.articles.insert, post(OWNER, kept, n)),
      );
    expect(await countOf(t, kept)).toBe(4);
    await t.run(async (ctx) => {
      const { deleteArticle } = await import("./lib/feedRemoval");
      for (const id of ids.slice(0, 2)) {
        const article = await ctx.db.get("articles", id);
        if (article) await deleteArticle(ctx, article);
      }
    });
    expect(await countOf(t, kept)).toBe(2);
  });

  it("counts correctly when inserts land in the same moment", async () => {
    const t = await ownerTest(modules);
    const feedId = await t.run((ctx) => insertFeed(ctx, OWNER, 0));
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        t.mutation(internal.articles.insert, post(OWNER, feedId, n)),
      ),
    );
    expect(await countOf(t, feedId)).toBe(5);
  });

  it("stays unset until the backfill, rather than showing a partial number", async () => {
    const t = await ownerTest(modules);
    const feedId = await t.run((ctx) => insertFeed(ctx, OWNER));
    await t.mutation(internal.articles.insert, post(OWNER, feedId, 1));
    expect(await countOf(t, feedId)).toBeNull();
  });

  it("is shown by the feeds list", async () => {
    const t = await ownerTest(modules);
    const feedId = await t.run((ctx) => insertFeed(ctx, OWNER, 0));
    await t.mutation(internal.articles.insert, post(OWNER, feedId, 1));
    const [feed] = await t.query(api.feeds.list, {});
    expect(feed.articleCount).toBe(1);
  });
});

describe("backfilling article counts", () => {
  it("counts across pages and across feeds, and a rerun gives the same answer", async () => {
    const t = await ownerTest(modules);
    const { a, b, empty } = await t.run(async (ctx) => {
      const a = await insertFeed(ctx, OWNER);
      const b = await ctx.db.insert("feeds", {
        userId: OWNER,
        url: "https://example.com/b.xml",
        title: "b",
        isActive: true,
        articleCount: 99,
        createdAt: Date.now(),
      });
      const empty = await ctx.db.insert("feeds", {
        userId: OWNER,
        url: "https://example.com/empty.xml",
        title: "empty",
        isActive: true,
        createdAt: Date.now(),
      });
      // 27 rows: three pages of ten
      for (let n = 0; n < 27; n++) await rawArticle(ctx, OWNER, a, n);
      for (let n = 100; n < 104; n++) await rawArticle(ctx, OWNER, b, n);
      return { a, b, empty };
    });
    const run = async () => {
      await t.mutation(internal.feeds.backfillArticleCounts, {
        userId: OWNER,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    };
    await run();
    expect(await countOf(t, a)).toBe(27);
    expect(await countOf(t, b)).toBe(4);
    expect(await countOf(t, empty)).toBe(0);
    await run();
    expect(await countOf(t, a)).toBe(27);
    expect(await countOf(t, b)).toBe(4);
  });

  it("reads at most ten articles in a transaction", async () => {
    const t = await ownerTest(modules);
    const feedId = await t.run(async (ctx) => {
      const id = await insertFeed(ctx, OWNER);
      for (let n = 0; n < 25; n++) await rawArticle(ctx, OWNER, id, n);
      return id;
    });
    await t.mutation(internal.feeds.backfillArticleCounts, { userId: OWNER });
    // One page in, the count is still unset and the rest is scheduled
    expect(await countOf(t, feedId)).toBeNull();
    const pending = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(pending).toHaveLength(1);
  });

  it("keeps two readers' counts apart", async () => {
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    const { mine, theirs } = await t.run(async (ctx) => {
      const mine = await insertFeed(ctx, OWNER);
      const theirs = await insertFeed(ctx, readerLibraryId);
      for (let n = 0; n < 3; n++) await rawArticle(ctx, OWNER, mine, n);
      for (let n = 0; n < 12; n++)
        await rawArticle(ctx, readerLibraryId, theirs, n);
      return { mine, theirs };
    });
    await t.mutation(internal.feeds.backfillArticleCounts, { userId: OWNER });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const counts = await t.run(async (ctx) => ({
      mine: (await ctx.db.get(mine))?.articleCount,
      theirs: (await ctx.db.get(theirs))?.articleCount,
    }));
    expect(counts).toEqual({ mine: 3, theirs: undefined });
    const readerFeeds = await reader.query(api.feeds.list, {});
    expect(readerFeeds.map((f) => f._id)).toEqual([theirs]);
    expect(readerFeeds[0].articleCount).toBeUndefined();
  });

  it("refuses an article for a feed the importing reader doesn't own", async () => {
    const t = await ownerTest(modules);
    const theirs = await t.run((ctx) => insertFeed(ctx, "other-reader", 5));
    await expect(
      t.mutation(internal.articles.insert, post(OWNER, theirs, 1)),
    ).rejects.toThrow("Feed not found");
    expect(
      await t.run(async (ctx) => (await ctx.db.get(theirs))?.articleCount),
    ).toBe(5);
  });
});

describe("checking feeds", () => {
  it("flags active feeds until each one reports back", async () => {
    const t = await ownerTest(modules);
    const feedId = await t.run((ctx) => insertFeed(ctx, OWNER, 0));
    const paused = await t.run((ctx) =>
      ctx.db.insert("feeds", {
        userId: OWNER,
        url: "https://example.com/paused.xml",
        title: "paused",
        isActive: false,
        createdAt: Date.now(),
      }),
    );
    await t.mutation(internal.feeds.markChecking, { userId: OWNER });
    const flag = (id: Id<"feeds">) =>
      t.run(async (ctx) => (await ctx.db.get(id))?.checkingSince ?? null);
    expect(await flag(feedId)).toBeTypeOf("number");
    expect(await flag(paused)).toBeNull();
    await t.mutation(internal.feeds.updateLastFetched, { feedId });
    expect(await flag(feedId)).toBeNull();
  });
});
