/// <reference types="vite/client" />
import type { PaginationResult } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownerTest, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { READER_LIMITS } from "./limits";

const modules = import.meta.glob("./**/*.ts");

// Scheduled annotation jobs stay queued, so no model call is attempted
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Status = "pending" | "annotated" | "deferred" | "failed";

async function seed(
  t: Awaited<ReturnType<typeof ownerTest>>,
  articles: {
    title: string;
    minutes: number;
    status: Status;
    userId?: string;
    extraction?: "pending" | "extracted";
  }[],
) {
  return t.run(async (ctx) => {
    const ids: Id<"articles">[] = [];
    for (const [i, a] of articles.entries())
      ids.push(
        await ctx.db.insert("articles", {
          userId: a.userId ?? "default_user",
          guid: `guid-${i}`,
          url: `https://example.com/${i}`,
          title: a.title,
          extractionStatus: a.extraction ?? "extracted",
          annotationStatus: a.status,
          estimatedReadMinutes: a.minutes,
          createdAt: Date.now(),
        }),
      );
    return ids;
  });
}

const only = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("missing fixture");
  return value;
};

const jobs = (t: Awaited<ReturnType<typeof ownerTest>>) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").take(500)).filter((j) =>
      j.name.includes("generateForArticle"),
    ),
  );

const statusOf = (
  t: Awaited<ReturnType<typeof ownerTest>>,
  id: Id<"articles">,
) => t.run(async (ctx) => (await ctx.db.get(id))?.annotationStatus);

const imported = (minutes: number) => ({
  userId: "default_user",
  guid: `import-${minutes}`,
  url: `https://example.com/import-${minutes}`,
  title: `import ${minutes}`,
  content: "word ".repeat(120),
  contentHtml: "<p>word</p>",
  excerpt: "word",
  wordCount: 120,
  estimatedReadMinutes: minutes,
});

describe("the 20-minute line at import", () => {
  it("annotates an article of exactly 20 minutes and defers one of 21", async () => {
    const t = await ownerTest(modules);
    const exact = await t.mutation(
      internal.articles.insertExtracted,
      imported(20),
    );
    const long = await t.mutation(
      internal.articles.insertExtracted,
      imported(21),
    );
    expect(await statusOf(t, exact)).toBe("pending");
    expect(await statusOf(t, long)).toBe("deferred");
    const scheduled = await jobs(t);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.args).toEqual([{ articleId: exact }]);
  });

  it("defers a long feed article when extraction records its length", async () => {
    const t = await ownerTest(modules);
    const [short, long] = await seed(t, [
      { title: "short", minutes: 0, status: "pending", extraction: "pending" },
      { title: "long", minutes: 0, status: "pending", extraction: "pending" },
    ]);
    const extract = (articleId: Id<"articles">, minutes: number) =>
      t.mutation(internal.articles.updateExtracted, {
        articleId,
        content: "x",
        contentHtml: "<p>x</p>",
        excerpt: "x",
        wordCount: 5000,
        estimatedReadMinutes: minutes,
      });
    expect(await extract(only(short), 20)).toBe(true);
    expect(await extract(only(long), 45)).toBe(false);
    expect(await statusOf(t, only(short))).toBe("pending");
    expect(await statusOf(t, only(long))).toBe("deferred");
  });
});

describe("overlapping extractions", () => {
  it("schedule one annotation when the article is opened in between", async () => {
    const t = await ownerTest(modules);
    const [id] = await seed(t, [
      { title: "long", minutes: 0, status: "pending", extraction: "pending" },
    ]);
    const articleId = only(id);
    const extract = () =>
      t.mutation(internal.articles.updateExtracted, {
        articleId,
        content: "x",
        contentHtml: "<p>x</p>",
        excerpt: "x",
        wordCount: 5000,
        estimatedReadMinutes: 45,
      });
    expect(await extract()).toBe(false);
    expect(await statusOf(t, articleId)).toBe("deferred");
    await t.mutation(api.articles.annotateAhead, { articleIds: [articleId] });
    // The second worker finishes after annotation has started
    expect(await extract()).toBe(false);
    expect(await statusOf(t, articleId)).toBe("pending");
    expect(
      await t.mutation(api.articles.annotateAhead, { articleIds: [articleId] }),
    ).toBe(0);
    expect(await jobs(t)).toHaveLength(1);
  });

  it("leaves annotation to the first short extraction only", async () => {
    const t = await ownerTest(modules);
    const [id] = await seed(t, [
      { title: "short", minutes: 0, status: "pending", extraction: "pending" },
    ]);
    const extract = () =>
      t.mutation(internal.articles.updateExtracted, {
        articleId: only(id),
        content: "x",
        contentHtml: "<p>x</p>",
        excerpt: "x",
        wordCount: 500,
        estimatedReadMinutes: 3,
      });
    expect(await extract()).toBe(true);
    expect(await extract()).toBe(false);
  });
});

describe("annotating ahead", () => {
  it("starts only deferred articles, once, and leaves the rest alone", async () => {
    const t = await ownerTest(modules);
    const [deferred, annotated, pending, failed] = await seed(t, [
      { title: "d", minutes: 40, status: "deferred" },
      { title: "a", minutes: 40, status: "annotated" },
      { title: "p", minutes: 40, status: "pending" },
      { title: "f", minutes: 40, status: "failed" },
    ]);
    const ids = [deferred, annotated, pending, failed].map(only);
    expect(
      await t.mutation(api.articles.annotateAhead, { articleIds: ids }),
    ).toBe(1);
    expect(
      await t.mutation(api.articles.annotateAhead, { articleIds: ids }),
    ).toBe(0);
    expect(await jobs(t)).toHaveLength(1);
    expect(await statusOf(t, only(ids[0]))).toBe("pending");
    expect(await statusOf(t, only(ids[1]))).toBe("annotated");
    expect(await statusOf(t, only(ids[3]))).toBe("failed");
  });

  it("does not double-schedule under concurrent calls", async () => {
    const t = await ownerTest(modules);
    const ids = await seed(t, [
      { title: "d", minutes: 40, status: "deferred" },
    ]);
    await Promise.all([
      t.mutation(api.articles.annotateAhead, { articleIds: ids }),
      t.mutation(api.articles.annotateAhead, { articleIds: ids }),
    ]);
    expect(await jobs(t)).toHaveLength(1);
  });

  it("starts at most three per call, ignoring repeats", async () => {
    const t = await ownerTest(modules);
    const ids = await seed(
      t,
      Array.from({ length: 5 }, (_, i) => ({
        title: `d${i}`,
        minutes: 40,
        status: "deferred" as const,
      })),
    );
    const started = await t.mutation(api.articles.annotateAhead, {
      articleIds: [only(ids[0]), ...ids],
    });
    expect(started).toBe(3);
    expect(await jobs(t)).toHaveLength(3);
    expect(await statusOf(t, only(ids[3]))).toBe("deferred");
  });

  it("never starts another reader's article", async () => {
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    const mine = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: "default_user",
        guid: "mine",
        url: "https://example.com/mine",
        title: "owner's",
        extractionStatus: "extracted",
        annotationStatus: "deferred",
        estimatedReadMinutes: 40,
        createdAt: Date.now(),
      }),
    );
    expect(
      await reader.mutation(api.articles.annotateAhead, { articleIds: [mine] }),
    ).toBe(0);
    expect(readerLibraryId).not.toBe("default_user");
    const row = await t.run((ctx) => ctx.db.get(mine));
    expect(row?.annotationStatus).toBe("deferred");
  });

  it("is rate limited per reader, and only when it starts something", async () => {
    const t = await ownerTest(modules);
    const ids = await seed(
      t,
      Array.from({ length: READER_LIMITS.annotateAhead.max + 1 }, (_, i) => ({
        title: `d${i}`,
        minutes: 40,
        status: "deferred" as const,
      })),
    );
    // Calls that find nothing to start spend nothing
    for (let i = 0; i < 5; i++)
      await t.mutation(api.articles.annotateAhead, { articleIds: [] });
    for (const id of ids.slice(0, READER_LIMITS.annotateAhead.max))
      await t.mutation(api.articles.annotateAhead, { articleIds: [id] });
    await expect(
      t.mutation(api.articles.annotateAhead, {
        articleIds: [only(ids.at(-1))],
      }),
    ).rejects.toThrow("paused");
    expect(await statusOf(t, only(ids.at(-1)))).toBe("deferred");
  });
});

describe("offering deferred articles", () => {
  const library = async () => {
    const t = await ownerTest(modules);
    await seed(t, [
      { title: "annotated 25", minutes: 25, status: "annotated" },
      { title: "deferred 28", minutes: 28, status: "deferred" },
      { title: "deferred 22", minutes: 22, status: "deferred" },
      { title: "deferred 90", minutes: 90, status: "deferred" },
      { title: "pending 24", minutes: 24, status: "pending" },
    ]);
    return t;
  };

  it("includes them in forWindow", async () => {
    const t = await library();
    const picks = await t.query(api.suggestions.forWindow, {
      requestedMinutes: 30,
    });
    expect(picks.map((p) => p.title)).toEqual([
      "deferred 28",
      "annotated 25",
      "deferred 22",
    ]);
    expect(picks[0]?.reason).toBe("Fits your 30-minute window");
    // Only the unannotated ones ask the desk for lookahead
    expect(picks.map((p) => p.deferred)).toEqual([true, false, true]);
  });

  it("pages annotated then deferred articles without repeats or gaps", async () => {
    const t = await library();
    for (const numItems of [1, 2, 10]) {
      type Row = { _id: string; title: string };
      const titles: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 20; guard++) {
        const page: PaginationResult<Row> = await t.query(
          api.suggestions.moreForWindow,
          { requestedMinutes: 30, paginationOpts: { numItems, cursor } },
        );
        titles.push(...page.page.map((r) => r.title));
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      expect(titles).toEqual(["annotated 25", "deferred 28", "deferred 22"]);
    }
  });

  it("re-reads a page pinned to the hand-over to the deferred range", async () => {
    const t = await library();
    const first = await t.query(api.suggestions.moreForWindow, {
      requestedMinutes: 30,
      paginationOpts: { numItems: 5, cursor: null },
    });
    expect(first.isDone).toBe(false);
    const again = await t.query(api.suggestions.moreForWindow, {
      requestedMinutes: 30,
      paginationOpts: {
        numItems: 5,
        cursor: null,
        endCursor: first.continueCursor,
      },
    });
    expect(again.page.map((r) => r.title)).toEqual(
      first.page.map((r) => r.title),
    );
  });

  it("offers a deferred article as the shortest when it is the only one", async () => {
    const t = await ownerTest(modules);
    await seed(t, [
      { title: "deferred 50", minutes: 50, status: "deferred" },
      { title: "deferred 30", minutes: 30, status: "deferred" },
    ]);
    expect(await t.query(api.suggestions.shortestUnread, {})).toMatchObject({
      title: "deferred 30",
    });
  });
});

describe("deferred articles in the unread queue", () => {
  const counts = async (t: Awaited<ReturnType<typeof ownerTest>>) => {
    const o = await t.query(api.home.overview, {});
    return { total: o.annotatedTotal, waiting: o.waiting, pending: o.pending };
  };

  it("keeps the counters in step as an article moves deferred, pending, annotated and read", async () => {
    const t = await ownerTest(modules);
    await t.mutation(internal.readingQueue.initialize, {
      userId: "default_user",
    });
    const id = await t.mutation(
      internal.articles.insertExtracted,
      imported(40),
    );
    expect(await statusOf(t, id)).toBe("deferred");
    expect(await counts(t)).toEqual({ total: 1, waiting: 1, pending: 0 });

    await t.mutation(api.articles.annotateAhead, { articleIds: [id] });
    expect(await counts(t)).toEqual({ total: 0, waiting: 0, pending: 1 });

    await t.mutation(internal.articles.updateAnnotationStatus, {
      articleId: id,
      status: "annotated",
    });
    expect(await counts(t)).toEqual({ total: 1, waiting: 1, pending: 0 });

    await t.mutation(api.sessions.recordInteraction, {
      articleId: id,
      action: "finished",
    });
    expect(await counts(t)).toEqual({ total: 1, waiting: 0, pending: 0 });
  });

  it("takes a deferred article out of the waiting count when it is read or archived", async () => {
    const t = await ownerTest(modules);
    await t.mutation(internal.readingQueue.initialize, {
      userId: "default_user",
    });
    const id = await t.mutation(
      internal.articles.insertExtracted,
      imported(40),
    );
    await t.mutation(api.articles.archive, { articleId: id });
    expect(await counts(t)).toEqual({ total: 1, waiting: 0, pending: 0 });
    await t.mutation(api.articles.restore, { articleId: id });
    expect(await counts(t)).toEqual({ total: 1, waiting: 1, pending: 0 });
  });

  it("lists them in Up next and the unread list, newest first, with the 30-minute count", async () => {
    const t = await ownerTest(modules);
    await t.mutation(internal.readingQueue.initialize, {
      userId: "default_user",
    });
    const older = await t.mutation(
      internal.articles.insertExtracted,
      imported(5),
    );
    await t.mutation(internal.articles.updateAnnotationStatus, {
      articleId: older,
      status: "annotated",
    });
    const newer = await t.mutation(
      internal.articles.insertExtracted,
      imported(40),
    );
    const overview = await t.query(api.home.overview, {});
    expect(overview.upNext.map((a) => a._id)).toEqual([newer, older]);
    expect(overview.fits).toMatchObject({ 5: 1, 20: 1, 30: 2 });
    const unread = await t.query(api.articles.listUnread, {});
    expect(unread.map((a) => a._id)).toEqual([newer, older]);
  });
});
