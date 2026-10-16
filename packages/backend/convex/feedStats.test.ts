/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;

async function feedWithArticle(
  ctx: MutationCtx,
  userId: string,
  name: string,
  withFeed = true,
) {
  const feedId = withFeed
    ? await ctx.db.insert("feeds", {
        userId,
        url: `https://${name}.example/feed`,
        title: name,
        isActive: true,
        createdAt: Date.now(),
      })
    : undefined;
  const articleId = await ctx.db.insert("articles", {
    feedId,
    userId,
    guid: `${userId}-${name}`,
    url: `https://${name}.example/a`,
    title: name,
    extractionStatus: "extracted",
    annotationStatus: "annotated",
    createdAt: Date.now(),
  });
  return { feedId, articleId };
}
const stats = (t: Fixture["t"]) =>
  t.run((ctx) => ctx.db.query("feedStats").collect());
const totals = (rows: Awaited<ReturnType<typeof stats>>) =>
  rows.map(({ userId, feedId, offered, opened, finished, skipped }) => ({
    userId,
    feedId,
    offered,
    opened,
    finished,
    skipped,
  }));

describe("per-feed outcome counts", () => {
  it("counts offered, opened, finished and skipped as they happen, and nothing else", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const { feedId, articleId } = await t.run((ctx) =>
      feedWithArticle(ctx, OWNER, "one"),
    );
    for (const action of [
      "presented",
      "presented",
      "skipped",
      "saved",
      "abandoned",
      "opened",
      "finished",
    ] as const)
      await owner.mutation(api.sessions.recordInteraction, {
        articleId,
        action,
      });
    expect(totals(await stats(t))).toEqual([
      {
        userId: OWNER,
        feedId,
        offered: 2,
        opened: 1,
        finished: 1,
        skipped: 1,
      },
    ]);
  });

  it("counts the opened and finished interactions that reading checkpoints write", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const { feedId, articleId } = await t.run((ctx) =>
      feedWithArticle(ctx, OWNER, "reading"),
    );
    const startedAt = Date.now() - 20_000;
    const checkpoint = {
      articleId,
      visitId: "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e",
      day: new Date(startedAt).toISOString().slice(0, 10),
      startedAt,
      updatedAt: startedAt + 10_000,
      activeTimeMs: 6000,
      visibleTimeMs: 8000,
      timeSpentMs: 10_000,
      maxScrollPercent: 40,
      annotationsOpened: [],
    };
    await owner.mutation(api.readingActivity.checkpoint, checkpoint);
    // A retry of the same cumulative checkpoint adds nothing
    await owner.mutation(api.readingActivity.checkpoint, checkpoint);
    await owner.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      finished: true,
    });
    await owner.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      finished: true,
    });
    const [row] = await stats(t);
    expect(row).toMatchObject({ feedId, opened: 1, finished: 1, offered: 0 });
  });

  it("leaves articles without a feed uncounted", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const { articleId } = await t.run((ctx) =>
      feedWithArticle(ctx, OWNER, "loose", false),
    );
    await owner.mutation(api.sessions.recordInteraction, {
      articleId,
      action: "presented",
    });
    expect(await stats(t)).toHaveLength(0);
  });

  it("keeps each reader's counts apart", async () => {
    const { t, owner, reader, readerLibraryId } =
      await secondReaderTest(modules);
    const mine = await t.run((ctx) => feedWithArticle(ctx, OWNER, "mine"));
    const theirs = await t.run((ctx) =>
      feedWithArticle(ctx, readerLibraryId, "theirs"),
    );
    await owner.mutation(api.sessions.recordInteraction, {
      articleId: mine.articleId,
      action: "presented",
    });
    await reader.mutation(api.sessions.recordInteraction, {
      articleId: theirs.articleId,
      action: "skipped",
    });
    await expect(
      reader.mutation(api.sessions.recordInteraction, {
        articleId: mine.articleId,
        action: "presented",
      }),
    ).rejects.toThrow("Article not found");
    const rows = totals(await stats(t));
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(
      expect.objectContaining({
        userId: OWNER,
        feedId: mine.feedId,
        offered: 1,
        skipped: 0,
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        userId: readerLibraryId,
        feedId: theirs.feedId,
        offered: 0,
        skipped: 1,
      }),
    );
  });

  it("matches a recount of articleInteractions after a mix of interactions", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const a = await t.run((ctx) => feedWithArticle(ctx, OWNER, "a"));
    const b = await t.run((ctx) => feedWithArticle(ctx, OWNER, "b"));
    const plan = [
      [a, "presented"],
      [b, "presented"],
      [a, "opened"],
      [b, "skipped"],
      [a, "finished"],
      [a, "presented"],
      [b, "saved"],
    ] as const;
    for (const [{ articleId }, action] of plan)
      await owner.mutation(api.sessions.recordInteraction, {
        articleId,
        action,
      });
    const counted = new Map<string, number>();
    for (const [{ feedId }, action] of plan) {
      const key = `${feedId}:${action}`;
      counted.set(key, (counted.get(key) ?? 0) + 1);
    }
    for (const row of await stats(t)) {
      expect(row.offered).toBe(counted.get(`${row.feedId}:presented`) ?? 0);
      expect(row.opened).toBe(counted.get(`${row.feedId}:opened`) ?? 0);
      expect(row.finished).toBe(counted.get(`${row.feedId}:finished`) ?? 0);
      expect(row.skipped).toBe(counted.get(`${row.feedId}:skipped`) ?? 0);
    }
  });
});

describe("feed stats backfill", () => {
  /** History written before the counters existed: interactions with no counts. */
  async function seedHistory(
    t: Fixture["t"],
    userId: string,
    articleId: Id<"articles">,
    actions: ("presented" | "opened" | "finished" | "skipped" | "saved")[],
  ) {
    await t.run(async (ctx) => {
      for (const action of actions)
        await ctx.db.insert("articleInteractions", {
          userId,
          articleId,
          action,
          createdAt: Date.now(),
        });
    });
  }
  const finish = async (t: Fixture["t"]) => {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  };

  it("counts existing history in resumable pages, once, whatever order it was stored", async () => {
    vi.useFakeTimers();
    const { t, readerLibraryId } = await secondReaderTest(modules);
    const a = await t.run((ctx) => feedWithArticle(ctx, OWNER, "a"));
    const b = await t.run((ctx) => feedWithArticle(ctx, OWNER, "b"));
    const other = await t.run((ctx) =>
      feedWithArticle(ctx, readerLibraryId, "other"),
    );
    // 30 interactions is several pages
    await seedHistory(
      t,
      OWNER,
      a.articleId,
      Array.from({ length: 12 }, () => "presented" as const),
    );
    await seedHistory(t, OWNER, b.articleId, ["skipped", "opened", "saved"]);
    await seedHistory(
      t,
      OWNER,
      a.articleId,
      Array.from({ length: 6 }, () => "finished" as const),
    );
    await seedHistory(t, readerLibraryId, other.articleId, ["presented"]);
    vi.advanceTimersByTime(10);
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    // One page only so far: resumable, not complete
    const partial = await t.run((ctx) =>
      ctx.db.query("feedStatsBackfill").collect(),
    );
    expect(partial[0].ready).toBe(false);
    await finish(t);
    await finish(t);
    const state = await t.run((ctx) =>
      ctx.db.query("feedStatsBackfill").collect(),
    );
    expect(state.map((s) => s.ready)).toEqual([true]);
    const rows = totals(await stats(t));
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({
      userId: OWNER,
      feedId: a.feedId,
      offered: 12,
      opened: 0,
      finished: 6,
      skipped: 0,
    });
    expect(rows).toContainEqual({
      userId: OWNER,
      feedId: b.feedId,
      offered: 0,
      opened: 1,
      finished: 0,
      skipped: 1,
    });
    // Running it again, or concurrently, changes nothing
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    await Promise.all([
      t.mutation(internal.feedStats.backfill, { userId: OWNER }),
      t.mutation(internal.feedStats.backfill, { userId: OWNER }),
    ]);
    await finish(t);
    expect(totals(await stats(t))).toEqual(rows);
    vi.useRealTimers();
  });

  it("does not count an interaction twice when it arrives while the backfill is under way", async () => {
    vi.useFakeTimers();
    const { t, owner } = await secondReaderTest(modules);
    const a = await t.run((ctx) => feedWithArticle(ctx, OWNER, "a"));
    await seedHistory(
      t,
      OWNER,
      a.articleId,
      Array.from({ length: 20 }, () => "presented" as const),
    );
    vi.advanceTimersByTime(5);
    // The first live interaction starts the backfill and is counted live
    await owner.mutation(api.sessions.recordInteraction, {
      articleId: a.articleId,
      action: "presented",
    });
    vi.advanceTimersByTime(5);
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    vi.advanceTimersByTime(5);
    await owner.mutation(api.sessions.recordInteraction, {
      articleId: a.articleId,
      action: "presented",
    });
    await finish(t);
    const [row] = await stats(t);
    expect(row.offered).toBe(22);
    vi.useRealTimers();
  });

  it("skips history for deleted articles and readers who are no longer active", async () => {
    vi.useFakeTimers();
    const { t, readerLibraryId } = await secondReaderTest(modules);
    const gone = await t.run((ctx) => feedWithArticle(ctx, OWNER, "gone"));
    await seedHistory(t, OWNER, gone.articleId, ["presented"]);
    await t.run((ctx) => ctx.db.delete(gone.articleId));
    vi.advanceTimersByTime(10);
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    await finish(t);
    expect(await stats(t)).toHaveLength(0);
    await t.run(async (ctx) => {
      const reader = await ctx.db.query("readers").first();
      if (reader) await ctx.db.patch(reader._id, { status: "disabled" });
    });
    await t.mutation(internal.feedStats.backfill, { userId: readerLibraryId });
    expect(
      await t.run((ctx) => ctx.db.query("feedStatsBackfill").collect()),
    ).toHaveLength(1);
    vi.useRealTimers();
  });

  it("is started for every active reader by the background fan-out", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    await t.mutation(internal.background.fanOut, { job: "feedStats" });
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(50),
    );
    const users = jobs
      .filter((job) => job.name.includes("feedStats"))
      .map((job) => (job.args[0] as { userId: string }).userId);
    expect(new Set(users)).toEqual(new Set([OWNER, readerLibraryId]));
  });
});
