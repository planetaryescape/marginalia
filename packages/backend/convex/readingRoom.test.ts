/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { readerTest, secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
// Wednesday 14 October 2026, 18:00 UTC
const NOW = Date.UTC(2026, 9, 14, 18, 0);
afterEach(() => vi.useRealTimers());

async function seed(t: Awaited<ReturnType<typeof secondReaderTest>>["t"]) {
  return t.run(async (ctx) => {
    const feedId = await ctx.db.insert("feeds", {
      userId: OWNER,
      url: "https://owner.example/feed",
      title: "Owner feed",
      isActive: true,
      createdAt: 1,
    });
    const quietFeed = await ctx.db.insert("feeds", {
      userId: OWNER,
      url: "https://owner.example/quiet",
      title: "Quiet feed",
      isActive: true,
      createdAt: 1,
    });
    const article = (guid: string, minutes: number) =>
      ctx.db.insert("articles", {
        userId: OWNER,
        guid,
        url: `https://example.com/${guid}`,
        title: guid,
        estimatedReadMinutes: minutes,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
    const short = await article("short", 5);
    const long = await article("long", 30);
    const visit = (
      articleId: typeof short,
      visitId: string,
      startedAt: number,
      activeTimeMs: number,
      userId = OWNER,
    ) =>
      ctx.db.insert("readingActivity", {
        userId,
        visitId,
        day: new Date(startedAt).toISOString().slice(0, 10),
        articleId,
        startedAt,
        updatedAt: startedAt,
        activeTimeMs,
        visibleTimeMs: activeTimeMs,
        timeSpentMs: activeTimeMs,
        maxScrollPercent: 50,
        annotationsOpened: [],
      });
    // Tuesday 07:15 UTC, five minutes
    await visit(short, "v1", Date.UTC(2026, 9, 13, 7, 15), 5 * 60_000);
    // Saturday 10 October 15:00 UTC, twenty minutes
    await visit(long, "v2", Date.UTC(2026, 9, 10, 15, 0), 20 * 60_000);
    // Before the month began
    await visit(long, "v3", Date.UTC(2026, 8, 20, 15, 0), 20 * 60_000);
    // Under the accidental-open threshold
    await visit(short, "v4", Date.UTC(2026, 9, 12, 9, 0), 5_000);
    await ctx.db.insert("feedStats", {
      userId: OWNER,
      feedId,
      offered: 40,
      opened: 2,
      finished: 1,
      skipped: 30,
      updatedAt: 1,
    });
    await ctx.db.insert("feedStats", {
      userId: OWNER,
      feedId: quietFeed,
      offered: 9,
      opened: 0,
      finished: 0,
      skipped: 9,
      updatedAt: 1,
    });
    return { short, long };
  });
}

describe("readingRoom", () => {
  it("aggregates the period's visits by local hour and read length", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { t, owner } = await secondReaderTest(modules);
    await seed(t);
    const room = await owner.query(api.stats.readingRoom, {
      timeZone: "UTC",
      period: "month",
    });
    expect(room.partial).toBe(false);
    // The September visit is outside "this month"; the 5 second one is a visit but not a read
    expect(room.activeTimeMs).toBe(25 * 60_000 + 5_000);
    expect(room.readingDays).toBe(3);
    expect(room.heat[1 * 24 + 7]).toBe(5);
    expect(room.heat[5 * 24 + 15]).toBe(20);
    expect(room.weekday).toEqual({ short: 1, middle: 0, long: 0 });
    expect(room.weekend).toEqual({ short: 0, middle: 0, long: 1 });
    expect(room.feeds).toMatchObject([
      { title: "Owner feed", offered: 40, opened: 2, skipsMost: true },
      { title: "Quiet feed", offered: 9, skipsMost: false },
    ]);
    const la = await owner.query(api.stats.readingRoom, {
      timeZone: "America/Los_Angeles",
      period: "month",
    });
    // 15:00 UTC is 08:00 in Los Angeles
    expect(la.heat[5 * 24 + 8]).toBe(20);
  });

  it("is empty for a month with no reading", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { owner } = await secondReaderTest(modules);
    const room = await owner.query(api.stats.readingRoom, {
      timeZone: "UTC",
      period: "month",
    });
    expect(room.activeTimeMs).toBe(0);
    expect(room.feeds).toEqual([]);
    expect(room.heat.every((m) => m === 0)).toBe(true);
  });

  it("never shows another reader's visits, feeds or lengths", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { t, reader } = await secondReaderTest(modules);
    await seed(t);
    const room = await reader.query(api.stats.readingRoom, {
      timeZone: "UTC",
      period: "30days",
    });
    expect(room.activeTimeMs).toBe(0);
    expect(room.feeds).toEqual([]);
    expect(room.weekday).toEqual({ short: 0, middle: 0, long: 0 });
  });

  it("rejects a caller who isn't signed in", async () => {
    const t = readerTest(modules);
    await expect(
      t.query(api.stats.readingRoom, { timeZone: "UTC", period: "month" }),
    ).rejects.toThrow();
    await expect(
      t.query(api.stats.readingTopics, { timeZone: "UTC", period: "month" }),
    ).rejects.toThrow();
  });
});

describe("readingTopics", () => {
  async function seedTopics(
    t: Awaited<ReturnType<typeof secondReaderTest>>["t"],
    readerLibraryId: string,
  ) {
    await t.run(async (ctx) => {
      const article = (userId: string, guid: string) =>
        ctx.db.insert("articles", {
          userId,
          guid,
          url: `https://example.com/${guid}`,
          title: guid,
          extractionStatus: "extracted",
          annotationStatus: "annotated",
          createdAt: 1,
        });
      const tag = (
        userId: string,
        name: string,
        status: "active" | "candidate",
      ) =>
        ctx.db.insert("tags", {
          userId,
          name,
          key: name,
          status,
          count: 1,
          aliases: [],
          createdAt: 1,
        });
      const visit = (
        userId: string,
        articleId: Awaited<ReturnType<typeof article>>,
        startedAt: number,
        minutes: number,
      ) =>
        ctx.db.insert("readingActivity", {
          userId,
          visitId: `${articleId}-${startedAt}`,
          day: "2026-10-13",
          articleId,
          startedAt,
          updatedAt: startedAt,
          activeTimeMs: minutes * 60_000,
          visibleTimeMs: minutes * 60_000,
          timeSpentMs: minutes * 60_000,
          maxScrollPercent: 10,
          annotationsOpened: [],
        });
      const link = (
        userId: string,
        articleId: Awaited<ReturnType<typeof article>>,
        tagId: Awaited<ReturnType<typeof tag>>,
      ) =>
        ctx.db.insert("articleTags", {
          userId,
          articleId,
          tagId,
          createdAt: 1,
        });
      const at = Date.UTC(2026, 9, 13, 8);

      const a1 = await article(OWNER, "a1");
      const a2 = await article(OWNER, "a2");
      const old = await article(OWNER, "old");
      const attention = await tag(OWNER, "attention", "active");
      const hiring = await tag(OWNER, "hiring", "active");
      const maybe = await tag(OWNER, "maybe", "candidate");
      await visit(OWNER, a1, at, 10);
      await visit(OWNER, a1, at + 3_600_000, 5);
      await visit(OWNER, a2, at, 20);
      // Before the month began, so it adds nothing
      await visit(OWNER, old, Date.UTC(2026, 8, 1), 60);
      await link(OWNER, a1, attention);
      await link(OWNER, a2, attention);
      await link(OWNER, a2, hiring);
      await link(OWNER, a1, maybe);
      await link(OWNER, old, hiring);

      // a1 finished in the period; the older finish and the other reader's don't count
      const interaction = (
        userId: string,
        articleId: Awaited<ReturnType<typeof article>>,
        action: "finished" | "skipped",
        createdAt: number,
      ) =>
        ctx.db.insert("articleInteractions", {
          userId,
          articleId,
          action,
          createdAt,
        });
      await interaction(OWNER, a1, "finished", at + 1000);
      await interaction(OWNER, old, "finished", Date.UTC(2026, 8, 1));
      await interaction(readerLibraryId, a2, "finished", at + 1000);
      await interaction(readerLibraryId, a2, "skipped", at + 1000);
      // Passed over with Another and never opened; its topic still shows it
      const passed = await article(OWNER, "passed");
      await link(OWNER, passed, hiring);
      await interaction(OWNER, passed, "skipped", at + 2000);
      await interaction(OWNER, passed, "skipped", at + 3000);
      // A skip that was later finished is a finish
      await interaction(OWNER, a1, "skipped", at - 1000);

      // Another reader's tag on the same article, and their own reading
      const theirs = await tag(readerLibraryId, "secret topic", "active");
      await link(readerLibraryId, a1, theirs);
      const theirArticle = await article(readerLibraryId, "theirs");
      await visit(readerLibraryId, theirArticle, at, 90);
      await link(readerLibraryId, theirArticle, theirs);
      await interaction(readerLibraryId, theirArticle, "finished", at + 500);
    });
  }

  it("ranks the reader's active tags by minutes read in the period", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { t, owner, readerLibraryId } = await secondReaderTest(modules);
    await seedTopics(t, readerLibraryId);
    expect(
      await owner.query(api.stats.readingTopics, {
        timeZone: "UTC",
        period: "month",
      }),
    ).toEqual([
      {
        name: "attention",
        minutes: 35,
        articles: 2,
        finished: 1,
        skipped: 0,
        outcomesPartial: false,
      },
      {
        name: "hiring",
        minutes: 20,
        articles: 1,
        finished: 0,
        skipped: 1,
        outcomesPartial: false,
      },
    ]);
  });

  it("shows another reader only their own topics", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    await seedTopics(t, readerLibraryId);
    expect(
      await reader.query(api.stats.readingTopics, {
        timeZone: "UTC",
        period: "month",
      }),
    ).toEqual([
      {
        name: "secret topic",
        minutes: 90,
        articles: 1,
        finished: 1,
        skipped: 0,
        outcomesPartial: false,
      },
    ]);
  });

  it("has no topics for a reader with no tags", async () => {
    const { owner } = await secondReaderTest(modules);
    expect(
      await owner.query(api.stats.readingTopics, {
        timeZone: "UTC",
        period: "month",
      }),
    ).toEqual([]);
  });
});

type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;
const visitRow = (
  articleId: Awaited<ReturnType<typeof insertArticle>>,
  startedAt: number,
  extra: { estimatedReadMinutes?: number; day?: string } = {},
) => ({
  userId: OWNER,
  visitId: `v-${articleId}-${startedAt}`,
  day: extra.day ?? "2026-10-13",
  articleId,
  startedAt,
  updatedAt: startedAt,
  activeTimeMs: 10 * 60_000,
  visibleTimeMs: 10 * 60_000,
  timeSpentMs: 10 * 60_000,
  maxScrollPercent: 10,
  annotationsOpened: [],
  estimatedReadMinutes: extra.estimatedReadMinutes,
});
const insertArticle = (
  ctx: Parameters<Parameters<Fixture["t"]["run"]>[0]>[0],
  guid: string,
  minutes?: number,
) =>
  ctx.db.insert("articles", {
    userId: OWNER,
    guid,
    url: `https://example.com/${guid}`,
    title: guid,
    estimatedReadMinutes: minutes,
    extractionStatus: "extracted",
    annotationStatus: "annotated",
    createdAt: 1,
  });

describe("readingRoom article reads", () => {
  it("uses the length stored on the visit and doesn't need the article", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { t, owner } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      const id = await insertArticle(ctx, "stored", 30);
      await ctx.db.insert(
        "readingActivity",
        visitRow(id, Date.UTC(2026, 9, 13, 8), { estimatedReadMinutes: 30 }),
      );
      await ctx.db.delete("articles", id);
    });
    const room = await owner.query(api.stats.readingRoom, {
      timeZone: "UTC",
      period: "month",
    });
    expect(room.weekday.long).toBe(1);
    expect(room.readsPartial).toBe(false);
  });

  it("reads at most 8 articles for old visits and says the rest are left out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { t, owner } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 10; i++) {
        const id = await insertArticle(ctx, `old${i}`, 5);
        await ctx.db.insert(
          "readingActivity",
          visitRow(id, Date.UTC(2026, 9, 13, 8, i)),
        );
      }
    });
    const room = await owner.query(api.stats.readingRoom, {
      timeZone: "UTC",
      period: "month",
    });
    expect(room.weekday.short).toBe(8);
    expect(room.readsPartial).toBe(true);
  });

  it("counts reading days in the requested zone, not the day the device recorded", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { t, owner } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      const id = await insertArticle(ctx, "days", 5);
      // 11:30 and 12:30 Auckland time on 14 October, but recorded as two days
      await ctx.db.insert(
        "readingActivity",
        visitRow(id, Date.UTC(2026, 9, 13, 22, 30), { day: "2026-10-13" }),
      );
      await ctx.db.insert(
        "readingActivity",
        visitRow(id, Date.UTC(2026, 9, 13, 23, 30), { day: "2026-10-14" }),
      );
    });
    const auckland = await owner.query(api.stats.readingRoom, {
      timeZone: "Pacific/Auckland",
      period: "month",
    });
    expect(auckland.readingDays).toBe(1);
    const utc = await owner.query(api.stats.readingRoom, {
      timeZone: "UTC",
      period: "month",
    });
    expect(utc.readingDays).toBe(1);
    const la = await owner.query(api.stats.readingRoom, {
      timeZone: "America/Los_Angeles",
      period: "month",
    });
    expect(la.readingDays).toBe(1);
    // Straddling local midnight in UTC: 23:30 and 00:30 are two days there
    await t.run(async (ctx) => {
      const id = await insertArticle(ctx, "days2", 5);
      await ctx.db.insert(
        "readingActivity",
        visitRow(id, Date.UTC(2026, 9, 11, 23, 30), { day: "2026-10-11" }),
      );
      await ctx.db.insert(
        "readingActivity",
        visitRow(id, Date.UTC(2026, 9, 12, 0, 30), { day: "2026-10-11" }),
      );
    });
    const split = await owner.query(api.stats.readingRoom, {
      timeZone: "UTC",
      period: "month",
    });
    expect(split.readingDays).toBe(3);
  });

  it("accepts the optional today argument", async () => {
    const { owner } = await secondReaderTest(modules);
    const args = {
      timeZone: "UTC",
      period: "month" as const,
      today: "2026-10-16",
    };
    expect((await owner.query(api.stats.readingRoom, args)).activeTimeMs).toBe(
      0,
    );
    expect(await owner.query(api.stats.readingTopics, args)).toEqual([]);
  });
});

describe("readingTopics finish and skip counts", () => {
  it("looks up the tags of a bounded number of articles that were only skipped", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { t, owner } = await secondReaderTest(modules);
    const at = Date.UTC(2026, 9, 13, 8);
    await t.run(async (ctx) => {
      const tagId = await ctx.db.insert("tags", {
        userId: OWNER,
        name: "busy",
        key: "busy",
        status: "active",
        count: 1,
        aliases: [],
        createdAt: 1,
      });
      const read = await insertArticle(ctx, "read");
      await ctx.db.insert("readingActivity", { ...visitRow(read, at) });
      await ctx.db.insert("articleTags", {
        userId: OWNER,
        articleId: read,
        tagId,
        createdAt: 1,
      });
      for (let i = 0; i < 130; i++) {
        const articleId = await insertArticle(ctx, `skipped-${i}`);
        await ctx.db.insert("articleTags", {
          userId: OWNER,
          articleId,
          tagId,
          createdAt: 1,
        });
        await ctx.db.insert("articleInteractions", {
          userId: OWNER,
          articleId,
          action: "skipped",
          createdAt: at + i,
        });
      }
    });
    const [topic] = await owner.query(api.stats.readingTopics, {
      timeZone: "UTC",
      period: "month",
    });
    expect(topic).toMatchObject({
      name: "busy",
      articles: 1,
      skipped: 130,
      outcomesPartial: false,
    });
  });

  it("keeps a finish counted when many newer browsing events follow it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { t, owner } = await secondReaderTest(modules);
    const at = Date.UTC(2026, 9, 13, 8);
    await t.run(async (ctx) => {
      const tagId = await ctx.db.insert("tags", {
        userId: OWNER,
        name: "busy",
        key: "busy",
        status: "active",
        count: 1,
        aliases: [],
        createdAt: 1,
      });
      const read = await insertArticle(ctx, "read");
      await ctx.db.insert("readingActivity", { ...visitRow(read, at) });
      await ctx.db.insert("articleTags", {
        userId: OWNER,
        articleId: read,
        tagId,
        createdAt: 1,
      });
      await ctx.db.insert("articleInteractions", {
        userId: OWNER,
        articleId: read,
        action: "finished",
        createdAt: at,
      });
      for (let i = 0; i < 700; i++)
        await ctx.db.insert("articleInteractions", {
          userId: OWNER,
          articleId: read,
          action: "presented",
          createdAt: at + 1 + i,
        });
    });
    const [topic] = await owner.query(api.stats.readingTopics, {
      timeZone: "UTC",
      period: "month",
    });
    expect(topic).toMatchObject({ name: "busy", finished: 1 });
  });
});

describe("readingTopics when a period has more finishes than it reads", () => {
  it("stops at the byte budget and leaves skips out rather than count a finished one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { t, owner } = await secondReaderTest(modules);
    const at = Date.UTC(2026, 9, 13, 8);
    const heavy = Array.from({ length: 128 }, (_, i) =>
      `annotation-${i}`.padEnd(32, "x"),
    );
    await t.run(async (ctx) => {
      const tagId = await ctx.db.insert("tags", {
        userId: OWNER,
        name: "busy",
        key: "busy",
        status: "active",
        count: 1,
        aliases: [],
        createdAt: 1,
      });
      const read = await insertArticle(ctx, "read");
      await ctx.db.insert("readingActivity", { ...visitRow(read, at) });
      await ctx.db.insert("articleTags", {
        userId: OWNER,
        articleId: read,
        tagId,
        createdAt: 1,
      });
      // Skipped, then finished, and that finish is too old to be read
      await ctx.db.insert("articleInteractions", {
        userId: OWNER,
        articleId: read,
        action: "skipped",
        createdAt: at,
      });
      await ctx.db.insert("articleInteractions", {
        userId: OWNER,
        articleId: read,
        action: "finished",
        createdAt: at + 1,
      });
      const other = await insertArticle(ctx, "other");
      for (let i = 0; i < 300; i++)
        await ctx.db.insert("articleInteractions", {
          userId: OWNER,
          articleId: other,
          action: "finished",
          annotationsOpened: heavy,
          createdAt: at + 2 + i,
        });
    });
    const [topic] = await owner.query(api.stats.readingTopics, {
      timeZone: "UTC",
      period: "month",
    });
    expect(topic).toMatchObject({
      name: "busy",
      skipped: 0,
      outcomesPartial: true,
    });
  });
});

describe("readingTopics with many candidates", () => {
  it("keeps scanning past candidate tags to find the active one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { t, owner } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      const lightArticle = await insertArticle(ctx, "light");
      await ctx.db.insert("readingActivity", {
        ...visitRow(lightArticle, Date.UTC(2026, 9, 13, 8)),
        activeTimeMs: 60_000,
      });
      const active = await ctx.db.insert("tags", {
        userId: OWNER,
        name: "quiet topic",
        key: "quiet",
        status: "active",
        count: 1,
        aliases: [],
        createdAt: 1,
      });
      await ctx.db.insert("articleTags", {
        userId: OWNER,
        articleId: lightArticle,
        tagId: active,
        createdAt: 1,
      });
      // 100 candidates, each on a heavier-read article than the active tag's
      for (let i = 0; i < 100; i++) {
        const id = await insertArticle(ctx, `heavy${i}`);
        await ctx.db.insert("readingActivity", {
          ...visitRow(id, Date.UTC(2026, 9, 13, 9, i)),
          activeTimeMs: (30 + i) * 60_000,
        });
        const candidate = await ctx.db.insert("tags", {
          userId: OWNER,
          name: `c${i}`,
          key: `c${i}`,
          status: "candidate",
          count: 1,
          aliases: [],
          createdAt: 1,
        });
        await ctx.db.insert("articleTags", {
          userId: OWNER,
          articleId: id,
          tagId: candidate,
          createdAt: 1,
        });
      }
    });
    expect(
      await owner.query(api.stats.readingTopics, {
        timeZone: "UTC",
        period: "month",
      }),
    ).toEqual([
      {
        name: "quiet topic",
        minutes: 1,
        articles: 1,
        finished: 0,
        skipped: 0,
        outcomesPartial: false,
      },
    ]);
  });
});

describe("readingTopics with candidates on every article", () => {
  it("finds the active tag when every read article carries three candidates", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { t, owner } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      const tag = (name: string, status: "active" | "candidate") =>
        ctx.db.insert("tags", {
          userId: OWNER,
          name,
          key: name,
          status,
          count: 1,
          aliases: [],
          createdAt: 1,
        });
      const active = await tag("the one", "active");
      const candidates = [
        await tag("x", "candidate"),
        await tag("y", "candidate"),
        await tag("z", "candidate"),
      ];
      for (let i = 0; i < 100; i++) {
        const id = await insertArticle(ctx, `many${i}`);
        // The active tag sits on the least-read article
        await ctx.db.insert("readingActivity", {
          ...visitRow(id, Date.UTC(2026, 9, 13, 9, i)),
          activeTimeMs: (i === 0 ? 1 : 10 + i) * 60_000,
        });
        for (const tagId of candidates)
          await ctx.db.insert("articleTags", {
            userId: OWNER,
            articleId: id,
            tagId,
            createdAt: 1,
          });
        if (i === 0)
          await ctx.db.insert("articleTags", {
            userId: OWNER,
            articleId: id,
            tagId: active,
            createdAt: 1,
          });
      }
    });
    expect(
      await owner.query(api.stats.readingTopics, {
        timeZone: "UTC",
        period: "month",
      }),
    ).toEqual([
      {
        name: "the one",
        minutes: 1,
        articles: 1,
        finished: 0,
        skipped: 0,
        outcomesPartial: false,
      },
    ]);
  });
});
