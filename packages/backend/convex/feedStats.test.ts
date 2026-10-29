/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { countFeedOutcome } from "./feedStats";

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

const finish = async (t: Fixture["t"]) => {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
};

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

  describe("one open or finish is one outcome", () => {
    async function setup() {
      const f = await secondReaderTest(modules);
      const { feedId, articleId } = await f.t.run((ctx) =>
        feedWithArticle(ctx, OWNER, "paired"),
      );
      const sessionId = await f.owner.mutation(api.sessions.create, {
        requestedMinutes: 10,
      });
      const startedAt = Date.now() - 20_000;
      const checkpoint = (visitId: string, extra = {}) => ({
        articleId,
        sessionId,
        visitId,
        day: new Date(startedAt).toISOString().slice(0, 10),
        startedAt,
        updatedAt: startedAt + 10_000,
        activeTimeMs: 6000,
        visibleTimeMs: 8000,
        timeSpentMs: 10_000,
        maxScrollPercent: 40,
        annotationsOpened: [],
        ...extra,
      });
      return { ...f, feedId, articleId, sessionId, checkpoint };
    }
    const VISIT = "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e";
    const VISIT_2 = "270d1ba0-28c2-44b1-9d97-c9f9bc9e944e";

    it("counts the desk's open and the reader page's first checkpoint as one", async () => {
      const { t, owner, articleId, sessionId, checkpoint } = await setup();
      await owner.mutation(api.sessions.recordInteraction, {
        articleId,
        sessionId,
        action: "opened",
      });
      await owner.mutation(api.readingActivity.checkpoint, checkpoint(VISIT));
      await owner.mutation(api.readingActivity.checkpoint, checkpoint(VISIT));
      expect((await stats(t))[0].opened).toBe(1);
    });

    it("counts the same pair once when the checkpoint beats the desk's record", async () => {
      const { t, owner, articleId, sessionId, checkpoint } = await setup();
      await owner.mutation(api.readingActivity.checkpoint, checkpoint(VISIT));
      await owner.mutation(api.sessions.recordInteraction, {
        articleId,
        sessionId,
        action: "opened",
      });
      expect((await stats(t))[0].opened).toBe(1);
    });

    it("still counts a later visit, with or without the desk", async () => {
      const { t, owner, articleId, sessionId, checkpoint } = await setup();
      await owner.mutation(api.sessions.recordInteraction, {
        articleId,
        sessionId,
        action: "opened",
      });
      await owner.mutation(api.readingActivity.checkpoint, checkpoint(VISIT));
      await owner.mutation(api.sessions.recordInteraction, {
        articleId,
        sessionId,
        action: "opened",
      });
      await owner.mutation(api.readingActivity.checkpoint, checkpoint(VISIT_2));
      expect((await stats(t))[0].opened).toBe(2);
      const VISIT_3 = "370d1ba0-28c2-44b1-9d97-c9f9bc9e944e";
      await owner.mutation(api.readingActivity.checkpoint, {
        ...checkpoint(VISIT_3),
        sessionId: undefined,
      });
      expect((await stats(t))[0].opened).toBe(3);
    });

    it("pairs the same way when the backfill counts the history later", async () => {
      vi.useFakeTimers();
      const { t, articleId, sessionId } = await setup();
      await t.run(async (ctx) => {
        for (const visitId of [undefined, VISIT, undefined, VISIT_2])
          await ctx.db.insert("articleInteractions", {
            userId: OWNER,
            articleId,
            sessionId,
            visitId,
            action: "opened",
            createdAt: Date.now(),
          });
      });
      await t.mutation(internal.feedStats.backfill, { userId: OWNER });
      await finish(t);
      expect((await stats(t))[0].opened).toBe(2);
      vi.useRealTimers();
    });

    it("counts a visit's finish once when it is retried on the next day", async () => {
      const { t, owner, articleId, checkpoint } = await setup();
      const began = Date.now() - 3 * 24 * 3_600_000;
      const first = checkpoint(VISIT, {
        finished: true,
        startedAt: began,
        updatedAt: began + 10_000,
        day: new Date(began).toISOString().slice(0, 10),
      });
      await owner.mutation(api.readingActivity.checkpoint, first);
      // The same visit's finish, retried once the clock has passed midnight
      const dayTwo = new Date(first.startedAt + 24 * 3_600_000);
      await owner.mutation(api.readingActivity.checkpoint, {
        ...first,
        day: dayTwo.toISOString().slice(0, 10),
        startedAt: dayTwo.getTime(),
        updatedAt: dayTwo.getTime() + 1000,
        activeTimeMs: 500,
        visibleTimeMs: 800,
        timeSpentMs: 1000,
      });
      const finished = await t.run((ctx) =>
        ctx.db
          .query("articleInteractions")
          .withIndex("by_user_article_action", (q) =>
            q
              .eq("userId", OWNER)
              .eq("articleId", articleId)
              .eq("action", "finished"),
          )
          .collect(),
      );
      expect(finished).toHaveLength(1);
      expect((await stats(t))[0].finished).toBe(1);
    });
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

  it("decides each interaction once, however live counting and the backfill interleave", async () => {
    vi.useFakeTimers();
    const { t, owner } = await secondReaderTest(modules);
    const a = await t.run((ctx) => feedWithArticle(ctx, OWNER, "a"));
    await seedHistory(
      t,
      OWNER,
      a.articleId,
      Array.from({ length: 20 }, () => "presented" as const),
    );
    await owner.mutation(api.sessions.recordInteraction, {
      articleId: a.articleId,
      action: "presented",
    });
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    await owner.mutation(api.sessions.recordInteraction, {
      articleId: a.articleId,
      action: "presented",
    });
    await finish(t);
    expect((await stats(t))[0].offered).toBe(22);
    // Starting over from the first interaction finds every one already decided
    await t.run(async (ctx) => {
      const state = await ctx.db.query("feedStatsBackfill").first();
      if (state)
        await ctx.db.replace(state._id, { userId: OWNER, ready: false });
    });
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    await finish(t);
    expect((await stats(t))[0].offered).toBe(22);
    vi.useRealTimers();
  });

  it("counts a late-committed interaction created before its neighbours exactly once", async () => {
    vi.useFakeTimers();
    const { t } = await secondReaderTest(modules);
    const a = await t.run((ctx) => feedWithArticle(ctx, OWNER, "a"));
    await seedHistory(t, OWNER, a.articleId, ["presented"]);
    vi.advanceTimersByTime(10);
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    await finish(t);
    // A row an older deployment wrote after the backfill had passed is decided
    // by its marker alone: a second run counts it once, a third adds nothing
    await seedHistory(t, OWNER, a.articleId, ["presented"]);
    await t.run(async (ctx) => {
      const state = await ctx.db.query("feedStatsBackfill").first();
      if (state)
        await ctx.db.replace(state._id, { userId: OWNER, ready: false });
    });
    for (let i = 0; i < 2; i++) {
      await t.mutation(internal.feedStats.backfill, { userId: OWNER });
      await finish(t);
      await t.run(async (ctx) => {
        const state = await ctx.db.query("feedStatsBackfill").first();
        if (state)
          await ctx.db.replace(state._id, { userId: OWNER, ready: false });
      });
    }
    expect((await stats(t))[0].offered).toBe(2);
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

describe("a library being deleted", () => {
  it("takes no late checkpoint, offer or backfill once deletion has started", async () => {
    vi.useFakeTimers();
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    const { articleId } = await t.run((ctx) =>
      feedWithArticle(ctx, readerLibraryId, "late"),
    );
    await reader.mutation(api.account.deleteMine, { confirmation: "DELETE" });
    const startedAt = Date.now() - 20_000;
    const late = {
      articleId,
      userId: readerLibraryId,
      visitId: "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e",
      day: new Date(startedAt).toISOString().slice(0, 10),
      startedAt,
      updatedAt: startedAt + 10_000,
      activeTimeMs: 6000,
      visibleTimeMs: 8000,
      timeSpentMs: 10_000,
      maxScrollPercent: 40,
      annotationsOpened: [],
      dwell: { "1": 3000 },
    };
    await expect(
      t.mutation(internal.readingActivity.record, late),
    ).rejects.toThrow("no longer active");
    await t.run(async (ctx) => {
      const interaction = await ctx.db.insert("articleInteractions", {
        userId: readerLibraryId,
        articleId,
        action: "presented",
        createdAt: Date.now(),
      });
      const article = await ctx.db.get(articleId);
      if (article) await countFeedOutcome(ctx, article, interaction);
    });
    await t.mutation(internal.feedStats.backfill, { userId: readerLibraryId });
    const rows = await t.run(async (ctx) => ({
      dwell: await ctx.db.query("paragraphDwell").collect(),
      activity: await ctx.db.query("readingActivity").collect(),
      stats: await ctx.db.query("feedStats").collect(),
      state: await ctx.db.query("feedStatsBackfill").collect(),
    }));
    expect(rows).toEqual({ dwell: [], activity: [], stats: [], state: [] });
    vi.useRealTimers();
  });
});

describe("opens and finishes past any scan window", () => {
  const VISIT = (n: number) => `visit-${n}`;

  async function setup() {
    const f = await secondReaderTest(modules);
    const article = await f.t.run((ctx) => feedWithArticle(ctx, OWNER, "busy"));
    const sessionId = await f.owner.mutation(api.sessions.create, {
      requestedMinutes: 10,
    });
    const sessionB = await f.owner.mutation(api.sessions.create, {
      requestedMinutes: 10,
    });
    /** Inserts and counts in its own transaction, as the live path does. */
    const live = (
      action: "opened" | "finished",
      extra: { sessionId?: Id<"sessions">; visitId?: string },
    ) =>
      f.t.run(async (ctx) => {
        const id = await ctx.db.insert("articleInteractions", {
          userId: OWNER,
          articleId: article.articleId,
          action,
          createdAt: Date.now(),
          ...extra,
        });
        const row = await ctx.db.get(article.articleId);
        if (row) await countFeedOutcome(ctx, row, id);
      });
    const seed = (
      rows: {
        action?: "opened" | "finished";
        sessionId?: Id<"sessions">;
        visitId?: string;
        feedCounted?: boolean;
      }[],
    ) =>
      f.t.run(async (ctx) => {
        for (const row of rows)
          await ctx.db.insert("articleInteractions", {
            userId: OWNER,
            articleId: article.articleId,
            action: row.action ?? "opened",
            sessionId: row.sessionId,
            visitId: row.visitId,
            feedCounted: row.feedCounted,
            createdAt: Date.now(),
          });
      });
    const opened = async () => (await stats(f.t))[0]?.opened;
    return { ...f, ...article, sessionId, sessionB, live, seed, opened };
  }

  it("counts 101 alternating desk and visit pairs in one session as 101", async () => {
    const { live, opened, sessionId } = await setup();
    for (let i = 0; i < 101; i++) {
      await live("opened", { sessionId });
      await live("opened", { sessionId, visitId: VISIT(i) });
    }
    expect(await opened()).toBe(101);
  });

  it("counts 101 pairs with no session as 101, and visit-first pairs the same", async () => {
    const { live, opened } = await setup();
    for (let i = 0; i < 101; i++) {
      if (i % 2) {
        await live("opened", { visitId: VISIT(i) });
        await live("opened", {});
      } else {
        await live("opened", {});
        await live("opened", { visitId: VISIT(i) });
      }
    }
    expect(await opened()).toBe(101);
  });

  it("counts a new desk open in a session whose earlier pair is over 200 rows back", async () => {
    const { live, opened, sessionId, sessionB } = await setup();
    await live("opened", { sessionId });
    await live("opened", { sessionId, visitId: VISIT(0) });
    for (let i = 0; i < 200; i++) await live("opened", { sessionId: sessionB });
    expect(await opened()).toBe(201);
    await live("opened", { sessionId });
    expect(await opened()).toBe(202);
  });

  it("counts a backfill over 202 rows, a pair before 200 desk-only opens elsewhere, as 201", async () => {
    vi.useFakeTimers();
    const { t, seed, opened, sessionId, sessionB } = await setup();
    await seed([
      { sessionId },
      { sessionId, visitId: VISIT(0) },
      ...Array.from({ length: 200 }, () => ({ sessionId: sessionB })),
    ]);
    vi.advanceTimersByTime(10);
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    await finish(t);
    expect(await opened()).toBe(201);
    const counters = await t.run((ctx) =>
      ctx.db.query("feedOpenCounts").collect(),
    );
    expect(
      counters.map(({ sessionId: s, desk, visit }) => [s, desk, visit]),
    ).toEqual(
      expect.arrayContaining([
        [sessionId, 1, 1],
        [sessionB, 200, 0],
      ]),
    );
    vi.useRealTimers();
  });

  it("counts a visit's finish once however many finished rows it has", async () => {
    const { live, t, feedId, seed } = await setup();
    for (let i = 0; i < 250; i++) await live("finished", { visitId: VISIT(1) });
    await live("finished", { visitId: VISIT(2) });
    expect((await stats(t))[0]).toMatchObject({ feedId, finished: 2 });
    // The backfill agrees on the same rows stored as history
    vi.useFakeTimers();
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("articleInteractions").collect())
        await ctx.db.delete(row._id);
      for (const row of await ctx.db.query("feedStats").collect())
        await ctx.db.delete(row._id);
    });
    await seed(
      Array.from({ length: 250 }, () => ({
        action: "finished" as const,
        visitId: VISIT(1),
      })),
    );
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    await finish(t);
    expect((await stats(t))[0]).toMatchObject({ finished: 1 });
    vi.useRealTimers();
  });

  it("stays exact for opens arriving while a backfill is half done", async () => {
    vi.useFakeTimers();
    const { t, seed, live, opened, sessionId } = await setup();
    await seed(Array.from({ length: 20 }, () => ({ sessionId })));
    vi.advanceTimersByTime(10);
    // One page of eight: its first open builds the key's counter from all 20
    // rows, so the pages still to come find them decided
    await t.mutation(internal.feedStats.backfill, { userId: OWNER });
    expect(
      (await t.run((ctx) => ctx.db.query("feedStatsBackfill").collect()))[0]
        .ready,
    ).toBe(false);
    // A visit open pairs with a desk open already in history: no new open
    await live("opened", { sessionId, visitId: VISIT(1) });
    expect(await opened()).toBe(20);
    await live("opened", { sessionId });
    expect(await opened()).toBe(21);
    await finish(t);
    expect(await opened()).toBe(21);
    const counter = await t.run((ctx) =>
      ctx.db.query("feedOpenCounts").unique(),
    );
    expect(counter).toMatchObject({ desk: 21, visit: 1 });
    vi.useRealTimers();
  });

  it("does not count again what an earlier version already counted", async () => {
    const { t, feedId, seed, live, opened, sessionId } = await setup();
    // History decided before the counters existed, and its feedStats row
    await seed([{ sessionId, feedCounted: true }]);
    await t.run((ctx) =>
      ctx.db.insert("feedStats", {
        userId: OWNER,
        feedId: feedId as Id<"feeds">,
        offered: 0,
        opened: 1,
        finished: 0,
        skipped: 0,
        updatedAt: Date.now(),
      }),
    );
    await live("opened", { sessionId, visitId: VISIT(1) });
    expect(await opened()).toBe(1);
    await live("opened", { sessionId });
    expect(await opened()).toBe(2);
  });
});
