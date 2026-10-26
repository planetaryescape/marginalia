/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
// Wednesday 14 October 2026, 18:00 UTC
const NOW = Date.UTC(2026, 9, 14, 18, 0);
const AT = Date.UTC(2026, 9, 13, 8);
const args = { timeZone: "UTC", period: "month" } as const;
type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;

afterEach(() => vi.useRealTimers());
const clock = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
};

function articleRow(userId: string, guid: string) {
  return {
    userId,
    guid,
    url: `https://example.com/${guid}`,
    title: guid,
    extractionStatus: "extracted" as const,
    annotationStatus: "annotated" as const,
    createdAt: 1,
  };
}

describe("readingHabits", () => {
  async function seed({ t, readerLibraryId }: Fixture) {
    await t.run(async (ctx) => {
      const a = await ctx.db.insert("articles", articleRow(OWNER, "a"));
      const b = await ctx.db.insert("articles", articleRow(OWNER, "b"));
      const c = await ctx.db.insert("articles", articleRow(OWNER, "c"));
      const event = (
        userId: string,
        articleId: typeof a,
        action: "presented" | "opened" | "finished" | "abandoned" | "skipped",
        createdAt = AT,
      ) =>
        ctx.db.insert("articleInteractions", {
          userId,
          articleId,
          action,
          createdAt,
        });
      await event(OWNER, a, "presented");
      await event(OWNER, a, "skipped");
      await event(OWNER, b, "skipped");
      await event(OWNER, b, "opened");
      await event(OWNER, b, "finished");
      await event(OWNER, c, "opened");
      // Before the month began
      await event(OWNER, a, "skipped", Date.UTC(2026, 8, 1));
      for (const [minutes, startedAt] of [
        [5, AT],
        [5, AT + 1],
        [20, AT + 2],
        [10, Date.UTC(2026, 8, 1)],
      ] as const)
        await ctx.db.insert("sessions", {
          userId: OWNER,
          requestedMinutes: minutes,
          startedAt,
          readingStatus: "selecting",
        });
      // Another reader's activity, which must never reach the owner's numbers
      const theirs = await ctx.db.insert(
        "articles",
        articleRow(readerLibraryId, "theirs"),
      );
      await event(readerLibraryId, theirs, "skipped");
      await event(readerLibraryId, theirs, "skipped");
      await event(readerLibraryId, theirs, "finished");
      await ctx.db.insert("sessions", {
        userId: readerLibraryId,
        requestedMinutes: 30,
        startedAt: AT,
        readingStatus: "selecting",
      });
    });
  }

  it("counts the times chosen, Another presses, finishes and unfinished opens in the period", async () => {
    clock();
    const f = await secondReaderTest(modules);
    await seed(f);
    expect(await f.owner.query(api.readingHabits.readingHabits, args)).toEqual({
      timesChosen: [
        { minutes: 5, count: 2 },
        { minutes: 20, count: 1 },
      ],
      anotherPresses: 2,
      finishes: 1,
      leftUnfinished: 1,
      partial: false,
    });
  });

  it("counts a finished book as a finish, not as left unfinished", async () => {
    clock();
    const f = await secondReaderTest(modules);
    await f.t.run(async (ctx) => {
      const bookArticle = await ctx.db.insert(
        "articles",
        articleRow(OWNER, "book"),
      );
      await ctx.db.insert("articleInteractions", {
        userId: OWNER,
        articleId: bookArticle,
        action: "opened",
        createdAt: AT,
      });
      await ctx.db.insert("books", {
        userId: OWNER,
        articleId: bookArticle,
        unitCount: 3,
        finishedThrough: 2,
        furthestUnit: 2,
        furthestScroll: 100,
        finished: true,
        lastReadAt: AT,
        createdAt: 1,
      });
    });
    const result = await f.owner.query(api.readingHabits.readingHabits, args);
    expect(result.finishes).toBe(1);
    expect(result.leftUnfinished).toBe(0);
  });

  it("shows another reader only their own counts", async () => {
    clock();
    const f = await secondReaderTest(modules);
    await seed(f);
    expect(await f.reader.query(api.readingHabits.readingHabits, args)).toEqual(
      {
        timesChosen: [{ minutes: 30, count: 1 }],
        anotherPresses: 2,
        finishes: 1,
        leftUnfinished: 0,
        partial: false,
      },
    );
  });

  it("is empty for a reader with no activity", async () => {
    clock();
    const f = await secondReaderTest(modules);
    expect(await f.owner.query(api.readingHabits.readingHabits, args)).toEqual({
      timesChosen: [],
      anotherPresses: 0,
      finishes: 0,
      leftUnfinished: 0,
      partial: false,
    });
  });

  it("stops reading at its cap and says the period is partial", async () => {
    clock();
    const f = await secondReaderTest(modules);
    await f.t.run(async (ctx) => {
      const a = await ctx.db.insert("articles", articleRow(OWNER, "a"));
      for (let i = 0; i < 1510; i++)
        await ctx.db.insert("articleInteractions", {
          userId: OWNER,
          articleId: a,
          action: "skipped",
          createdAt: AT + i,
        });
    });
    const result = await f.owner.query(api.readingHabits.readingHabits, args);
    expect(result.partial).toBe(true);
    expect(result.anotherPresses).toBe(1500);
  });
});

describe("readingLinger", () => {
  async function seed({ t, readerLibraryId }: Fixture) {
    await t.run(async (ctx) => {
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
      const read = async (
        userId: string,
        guid: string,
        tags: Awaited<ReturnType<typeof tag>>[],
        seconds: number[],
        updatedAt = AT,
      ) => {
        const articleId = await ctx.db.insert(
          "articles",
          articleRow(userId, guid),
        );
        await ctx.db.insert("readingActivity", {
          userId,
          visitId: `v-${guid}`,
          day: "2026-10-13",
          articleId,
          startedAt: updatedAt,
          updatedAt,
          activeTimeMs: 600_000,
          visibleTimeMs: 600_000,
          timeSpentMs: 600_000,
          maxScrollPercent: 50,
          annotationsOpened: [],
        });
        await ctx.db.insert("paragraphDwell", {
          userId,
          visitId: `v-${guid}`,
          day: "2026-10-13",
          articleId,
          dwell: Object.fromEntries(
            seconds.map((s, i) => [String(i + 1), s * 1000]),
          ),
          updatedAt,
        });
        for (const tagId of tags)
          await ctx.db.insert("articleTags", {
            userId,
            articleId,
            tagId,
            createdAt: 1,
          });
      };
      const slow = await tag(OWNER, "slow", "active");
      const quick = await tag(OWNER, "quick", "active");
      const maybe = await tag(OWNER, "maybe", "candidate");
      const rare = await tag(OWNER, "rare", "active");
      // Ten held paragraphs averaging 10 s, and another ten averaging 2 s
      await read(OWNER, "s1", [slow, maybe], Array(10).fill(10));
      await read(OWNER, "q1", [quick], Array(10).fill(2));
      // Too few paragraphs to mean anything
      await read(OWNER, "r1", [rare], [30, 30]);
      // Before the month began
      await read(
        OWNER,
        "old",
        [quick],
        Array(10).fill(100),
        Date.UTC(2026, 8, 1),
      );

      const theirs = await tag(readerLibraryId, "secret topic", "active");
      await read(readerLibraryId, "t1", [theirs], Array(12).fill(5));
      // Their link on the owner's article must not count for the owner either
      const [owned] = await ctx.db
        .query("articles")
        .withIndex("by_user", (q) => q.eq("userId", OWNER))
        .take(1);
      await ctx.db.insert("articleTags", {
        userId: readerLibraryId,
        articleId: owned._id,
        tagId: theirs,
        createdAt: 1,
      });
    });
  }

  it("ranks active topics by average seconds a paragraph held the reader, in the period", async () => {
    clock();
    const f = await secondReaderTest(modules);
    await seed(f);
    expect(await f.owner.query(api.readingHabits.readingLinger, args)).toEqual({
      topics: [
        { name: "slow", secondsPerParagraph: 10, paragraphs: 10, articles: 1 },
        { name: "quick", secondsPerParagraph: 2, paragraphs: 10, articles: 1 },
      ],
      partial: false,
    });
  });

  it("counts every visit in the period, not only the latest few", async () => {
    clock();
    const f = await secondReaderTest(modules);
    await f.t.run(async (ctx) => {
      const tagId = await ctx.db.insert("tags", {
        userId: OWNER,
        name: "skewed",
        key: "skewed",
        status: "active",
        count: 1,
        aliases: [],
        createdAt: 1,
      });
      const articleId = await ctx.db.insert(
        "articles",
        articleRow(OWNER, "skew"),
      );
      await ctx.db.insert("articleTags", {
        userId: OWNER,
        articleId,
        tagId,
        createdAt: 1,
      });
      await ctx.db.insert("readingActivity", {
        userId: OWNER,
        visitId: "v-skew-0",
        day: "2026-10-13",
        articleId,
        startedAt: AT,
        updatedAt: AT,
        activeTimeMs: 600_000,
        visibleTimeMs: 600_000,
        timeSpentMs: 600_000,
        maxScrollPercent: 50,
        annotationsOpened: [],
      });
      // Seven visits: the oldest held ten paragraphs for 100 s each, the six
      // newer ones for 2 s each. The mean over all seven is not the newest six's.
      for (let v = 0; v < 7; v++)
        await ctx.db.insert("paragraphDwell", {
          userId: OWNER,
          visitId: `v-skew-${v}`,
          day: "2026-10-13",
          articleId,
          dwell: Object.fromEntries(
            Array.from({ length: 10 }, (_, i) => [
              String(i + 1),
              (v === 0 ? 100 : 2) * 1000,
            ]),
          ),
          updatedAt: AT + v,
        });
    });
    const result = await f.owner.query(api.readingHabits.readingLinger, args);
    expect(result.topics).toEqual([
      {
        name: "skewed",
        // (100 s x 10 + 2 s x 60) / 70 paragraphs
        secondsPerParagraph: 16,
        paragraphs: 70,
        articles: 1,
      },
    ]);
    expect(result.partial).toBe(false);
  });

  it("says so when more visits exist than are read", async () => {
    clock();
    const f = await secondReaderTest(modules);
    await f.t.run(async (ctx) => {
      const articleId = await ctx.db.insert(
        "articles",
        articleRow(OWNER, "many"),
      );
      await ctx.db.insert("readingActivity", {
        userId: OWNER,
        visitId: "v-many",
        day: "2026-10-13",
        articleId,
        startedAt: AT,
        updatedAt: AT,
        activeTimeMs: 600_000,
        visibleTimeMs: 600_000,
        timeSpentMs: 600_000,
        maxScrollPercent: 50,
        annotationsOpened: [],
      });
      for (let v = 0; v < 25; v++)
        await ctx.db.insert("paragraphDwell", {
          userId: OWNER,
          visitId: `v-many-${v}`,
          day: "2026-10-13",
          articleId,
          dwell: { "1": 5000 },
          updatedAt: AT + v,
        });
    });
    expect(
      (await f.owner.query(api.readingHabits.readingLinger, args)).partial,
    ).toBe(true);
  });

  it("shows another reader only their own topics", async () => {
    clock();
    const f = await secondReaderTest(modules);
    await seed(f);
    expect(
      (await f.reader.query(api.readingHabits.readingLinger, args)).topics,
    ).toEqual([
      {
        name: "secret topic",
        secondsPerParagraph: 5,
        paragraphs: 12,
        articles: 1,
      },
    ]);
  });

  it("has nothing for a reader with no dwell", async () => {
    clock();
    const f = await secondReaderTest(modules);
    expect(await f.owner.query(api.readingHabits.readingLinger, args)).toEqual({
      topics: [],
      partial: false,
    });
  });
});

describe("articlesForTopic", () => {
  async function seed({ t, readerLibraryId }: Fixture, count = 3) {
    await t.run(async (ctx) => {
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
      const mine = await tag(OWNER, "attention", "active");
      const candidate = await tag(OWNER, "maybe", "candidate");
      const theirs = await tag(readerLibraryId, "attention", "active");
      for (let i = 0; i < count; i++) {
        const articleId = await ctx.db.insert(
          "articles",
          articleRow(OWNER, `mine-${i}`),
        );
        await ctx.db.insert("articleTags", {
          userId: OWNER,
          articleId,
          tagId: mine,
          createdAt: i,
        });
        if (i === 0)
          await ctx.db.insert("articleTags", {
            userId: OWNER,
            articleId,
            tagId: candidate,
            createdAt: i,
          });
      }
      const other = await ctx.db.insert(
        "articles",
        articleRow(readerLibraryId, "theirs"),
      );
      await ctx.db.insert("articleTags", {
        userId: readerLibraryId,
        articleId: other,
        tagId: theirs,
        createdAt: 1,
      });
    });
  }
  const opts = { numItems: 10, cursor: null };

  it("lists the reader's articles with the topic, without their bodies", async () => {
    const f = await secondReaderTest(modules);
    await seed(f);
    const result = await f.owner.query(api.tags.articlesForTopic, {
      topic: "Attention",
      paginationOpts: opts,
    });
    expect(result.page.map((a) => a.title).sort()).toEqual([
      "mine-0",
      "mine-1",
      "mine-2",
    ]);
    for (const body of ["content", "contentHtml", "embedding"])
      expect(result.page[0]).not.toHaveProperty(body);
  });

  it("lists nothing for a candidate or unknown topic", async () => {
    const f = await secondReaderTest(modules);
    await seed(f);
    for (const topic of ["maybe", "nothing", "   "])
      expect(
        (
          await f.owner.query(api.tags.articlesForTopic, {
            topic,
            paginationOpts: opts,
          })
        ).page,
      ).toEqual([]);
  });

  it("gives another reader only their own articles under a topic of the same name", async () => {
    const f = await secondReaderTest(modules);
    await seed(f);
    const result = await f.reader.query(api.tags.articlesForTopic, {
      topic: "attention",
      paginationOpts: opts,
    });
    expect(result.page.map((a) => a.title)).toEqual(["theirs"]);
  });

  it("marks an opened, unfinished article as reading, and nothing else", async () => {
    const f = await secondReaderTest(modules);
    await f.t.run(async (ctx) => {
      const tag = await ctx.db.insert("tags", {
        userId: OWNER,
        name: "attention",
        key: "attention",
        status: "active",
        count: 3,
        aliases: [],
        createdAt: 1,
      });
      // Finishing sets finishedAt on the article as well as a finished row
      const add = async (guid: string, actions: ("opened" | "finished")[]) => {
        const articleId = await ctx.db.insert("articles", {
          ...articleRow(OWNER, guid),
          finishedAt: actions.includes("finished") ? 2 : undefined,
        });
        await ctx.db.insert("articleTags", {
          userId: OWNER,
          articleId,
          tagId: tag,
          createdAt: 1,
        });
        for (const action of actions)
          await ctx.db.insert("articleInteractions", {
            userId: OWNER,
            articleId,
            action,
            createdAt: 1,
          });
      };
      await add("up-next", []);
      await add("opened-once", ["opened"]);
      await add("opened-then-finished", ["opened", "finished"]);
    });
    const result = await f.owner.query(api.tags.articlesForTopic, {
      topic: "attention",
      paginationOpts: opts,
    });
    const reading = Object.fromEntries(
      result.page.map((a) => [a.title, a.reading]),
    );
    expect(reading).toEqual({
      "up-next": false,
      "opened-once": true,
      "opened-then-finished": false,
    });
  });

  it("caps a page whatever the client asks for, and pages on", async () => {
    const f = await secondReaderTest(modules);
    await seed(f, 30);
    const first = await f.owner.query(api.tags.articlesForTopic, {
      topic: "attention",
      paginationOpts: { numItems: 5000, cursor: null },
    });
    expect(first.page).toHaveLength(12);
    expect(first.isDone).toBe(false);
    const second = await f.owner.query(api.tags.articlesForTopic, {
      topic: "attention",
      paginationOpts: { numItems: 5000, cursor: first.continueCursor },
    });
    expect(second.page).toHaveLength(12);
    expect(second.page.map((a) => a._id)).not.toContain(first.page[0]._id);
  });
});
