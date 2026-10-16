/// <reference types="vite/client" />
import type { PaginationResult } from "convex/server";
import { describe, expect, it } from "vitest";
import { ownerTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function library(
  articles: { title: string; minutes?: number; finished?: boolean }[],
) {
  const t = await ownerTest(modules);
  await t.run(async (ctx) => {
    for (const [i, a] of articles.entries())
      await ctx.db.insert("articles", {
        userId: "default_user",
        guid: `guid-${i}`,
        url: `https://example.com/${i}`,
        title: a.title,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        estimatedReadMinutes: a.minutes,
        finishedAt: a.finished ? Date.now() : undefined,
        createdAt: Date.now(),
      });
  });
  return t;
}

const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe("time-window suggestions", () => {
  it("offers the unread articles closest to the window", async () => {
    const t = await library([
      { title: "two", minutes: 2 },
      { title: "nine", minutes: 9 },
      { title: "ten", minutes: 10 },
      { title: "twelve", minutes: 12 },
      { title: "forty", minutes: 40 },
      { title: "ten, read", minutes: 10, finished: true },
    ]);
    const picks = await t.query(api.suggestions.forWindow, {
      requestedMinutes: 10,
    });
    expect(titles(picks)).toEqual(["ten", "nine", "twelve"]);
    expect(picks[0]).toMatchObject({
      estimatedReadMinutes: 10,
      reason: "Fits your 10-minute window",
    });
  });

  it("still offers articles that have no read-time estimate", async () => {
    const t = await library([{ title: "unknown length" }]);
    expect(
      titles(
        await t.query(api.suggestions.forWindow, { requestedMinutes: 20 }),
      ),
    ).toEqual(["unknown length"]);
  });

  it("looks past a crowd of short pieces to a long window's neighbours", async () => {
    const t = await library([
      ...Array.from({ length: 30 }, (_, i) => ({
        title: `short ${i}`,
        minutes: 3,
      })),
      { title: "half hour", minutes: 30 },
    ]);
    const picks = await t.query(api.suggestions.forWindow, {
      requestedMinutes: 30,
    });
    expect(picks[0]?.title).toBe("half hour");
  });

  it("rejects a window outside 1–180 minutes", async () => {
    const t = await library([]);
    await expect(
      t.query(api.suggestions.forWindow, { requestedMinutes: 0 }),
    ).rejects.toThrow("between 1 and 180");
  });

  it("rejects a window outside 1–180 minutes for the paged list too", async () => {
    const t = await library([]);
    await expect(
      t.query(api.suggestions.moreForWindow, {
        requestedMinutes: 181,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("between 1 and 180");
  });
});

async function pageAll(
  t: Awaited<ReturnType<typeof library>>,
  requestedMinutes: number,
  numItems: number,
) {
  type Row = { _id: string; title: string; estimatedReadMinutes: number };
  const all: Row[] = [];
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const page: PaginationResult<Row> = await t.query(
      api.suggestions.moreForWindow,
      { requestedMinutes, paginationOpts: { numItems, cursor } },
    );
    all.push(...page.page);
    pages += 1;
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return { all, pages };
}

describe("paged time-window suggestions", () => {
  it("pages through every unread article that fits, closest length first", async () => {
    const t = await library([
      ...Array.from({ length: 25 }, (_, i) => ({
        title: `fits ${i}`,
        minutes: 1 + (i % 10),
      })),
      { title: "too long", minutes: 11 },
      { title: "way too long", minutes: 90 },
      { title: "finished", minutes: 4, finished: true },
      { title: "no estimate" },
    ]);
    const { all, pages } = await pageAll(t, 10, 7);
    expect(pages).toBeGreaterThan(3);
    const ids = all.map((a) => a._id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(all).toHaveLength(26);
    expect(titles(all)).not.toContain("too long");
    expect(titles(all)).not.toContain("way too long");
    expect(titles(all)).not.toContain("finished");
    expect(all[0]).toMatchObject({
      estimatedReadMinutes: 10,
      reason: "Fits your 10-minute window",
    });
    const minutes = all.map((a) => a.estimatedReadMinutes);
    expect(minutes).toEqual([...minutes].sort((a, b) => b - a));
    expect(titles(all).at(-1)).toBe("no estimate");
  });

  it("keeps paging exact when many articles share a length", async () => {
    const t = await library(
      Array.from({ length: 12 }, (_, i) => ({
        title: `same ${i}`,
        minutes: 5,
      })),
    );
    const { all } = await pageAll(t, 5, 5);
    expect(all).toHaveLength(12);
    expect(new Set(all.map((a) => a._id)).size).toBe(12);
  });

  it("never returns another reader's articles", async () => {
    const t = await library([{ title: "mine", minutes: 5 }]);
    await t.run(async (ctx) => {
      await ctx.db.insert("articles", {
        userId: "someone_else",
        guid: "theirs",
        url: "https://example.com/theirs",
        title: "theirs",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        estimatedReadMinutes: 5,
        createdAt: Date.now(),
      });
    });
    const { all } = await pageAll(t, 5, 10);
    expect(titles(all)).toEqual(["mine"]);
  });

  it("includes the 180-minute window's upper bound", async () => {
    const t = await library([{ title: "epic", minutes: 180 }]);
    const { all } = await pageAll(t, 180, 10);
    expect(titles(all)).toEqual(["epic"]);
  });

  it("returns nothing when no unread article fits the window", async () => {
    const t = await library([{ title: "long", minutes: 40 }]);
    const { all, pages } = await pageAll(t, 5, 10);
    expect(all).toEqual([]);
    expect(pages).toBe(1);
  });
});

describe("shortest unread article", () => {
  it("offers the shortest unread article, ignoring finished and other readers' articles", async () => {
    const t = await library([
      { title: "finished short", minutes: 1, finished: true },
      { title: "seven", minutes: 7 },
      { title: "three", minutes: 3 },
    ]);
    await t.run(async (ctx) => {
      await ctx.db.insert("articles", {
        userId: "someone_else",
        guid: "theirs-short",
        url: "https://example.com/theirs-short",
        title: "theirs short",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        estimatedReadMinutes: 1,
        createdAt: Date.now(),
      });
    });
    expect(await t.query(api.suggestions.shortestUnread, {})).toMatchObject({
      title: "three",
      estimatedReadMinutes: 3,
    });
  });

  it("returns null when the reader has nothing unread", async () => {
    const t = await library([{ title: "done", minutes: 3, finished: true }]);
    expect(await t.query(api.suggestions.shortestUnread, {})).toBeNull();
  });

  it("measures an unestimated article by word count, the same way the deck does", async () => {
    const t = await library([{ title: "twenty", minutes: 20 }]);
    await insertUnestimated(t, "long read", 2200);
    expect(await t.query(api.suggestions.shortestUnread, {})).toMatchObject({
      title: "long read",
      estimatedReadMinutes: 10,
    });
  });

  it("does not call a 20-minute estimate the shortest when a 10-minute unestimated article exists", async () => {
    const t = await library([{ title: "twenty", minutes: 20 }]);
    await insertUnestimated(t, "long read", 2200);
    const picked = await t.query(api.suggestions.shortestUnread, {});
    expect(picked?.title).not.toBe("twenty");
  });

  async function insertUnestimated(
    t: Awaited<ReturnType<typeof library>>,
    title: string,
    wordCount: number,
  ) {
    await t.run(async (ctx) => {
      await ctx.db.insert("articles", {
        userId: "default_user",
        guid: `guid-${title}`,
        url: `https://example.com/${title}`,
        title,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        wordCount,
        createdAt: Date.now(),
      });
    });
  }

  describe("length filter on paged suggestions", () => {
    it("drops a page's article whose word-count length is over the window, and keeps paging", async () => {
      const t = await library([{ title: "five", minutes: 5 }]);
      for (let i = 0; i < 4; i++) await insertUnestimated(t, `long ${i}`, 2200);
      const pageSizes: number[] = [];
      let cursor: string | null = null;
      const titlesSeen: string[] = [];
      for (;;) {
        const page: PaginationResult<{
          title: string;
          estimatedReadMinutes: number;
        }> = await t.query(api.suggestions.moreForWindow, {
          requestedMinutes: 5,
          paginationOpts: { numItems: 2, cursor },
        });
        pageSizes.push(page.page.length);
        titlesSeen.push(...page.page.map((a) => a.title));
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      expect(titlesSeen).toEqual(["five"]);
      // An unestimated article at 10 minutes sits in the 5-minute index range; the
      // page it lands on comes back empty, but paging continues past it.
      expect(pageSizes).toContain(0);
      expect(pageSizes.at(-1)).toBe(0);
    });

    it("returns an empty, finished page when only over-long articles remain", async () => {
      const t = await library([]);
      await insertUnestimated(t, "long", 2200);
      const page = await t.query(api.suggestions.moreForWindow, {
        requestedMinutes: 5,
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(page.page).toEqual([]);
      expect(page.isDone).toBe(true);
    });
  });
});
