/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

const BODY = "x".repeat(2000);

function article(userId: string, i: number) {
  return {
    userId,
    guid: `${userId}-${i}`,
    url: `https://example.com/${userId}/${i}`,
    title: `${userId} piece ${i}`,
    author: "A. Writer",
    content: BODY,
    contentHtml: `<p>${BODY}</p>`,
    estimatedReadMinutes: 5,
    extractionStatus: "extracted" as const,
    annotationStatus: "annotated" as const,
    createdAt: i,
  };
}

async function seed(
  f: Awaited<ReturnType<typeof secondReaderTest>>,
  userId: string,
  n: number,
) {
  return f.t.run(async (ctx) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
      const articleId = await ctx.db.insert("articles", article(userId, i));
      await ctx.db.insert("savedArticles", { userId, articleId, savedAt: i });
      await ctx.db.insert("lovedArticles", {
        userId,
        articleId,
        lovedAt: i,
        reviewIndex: 0,
        nextReviewAt: i,
        reviewCount: 0,
      });
      ids.push(articleId);
    }
    return ids;
  });
}

type Page = {
  page: { articleId: string; article: Record<string, unknown> }[];
  isDone: boolean;
  continueCursor: string;
};

describe.each([
  ["savedArticles", api.savedArticles.page],
  ["lovedArticles", api.lovedArticles.page],
] as const)("%s.page", (_name, fn) => {
  it("walks the whole shelf newest first with no repeats, capped at 12 a page", async () => {
    const f = await secondReaderTest(modules);
    const ids = await seed(f, "default_user", 30);
    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    for (let guard = 0; guard < 10; guard++) {
      const result: Page = await f.owner.query(fn, {
        paginationOpts: { numItems: 100_000, cursor },
      });
      sizes.push(result.page.length);
      seen.push(...result.page.map((s) => s.articleId));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(Math.max(...sizes)).toBe(12);
    expect(seen).toEqual([...ids].reverse());
  });

  it("returns slim articles without content or HTML", async () => {
    const f = await secondReaderTest(modules);
    await seed(f, "default_user", 1);
    const result: Page = await f.owner.query(fn, {
      paginationOpts: { numItems: 5, cursor: null },
    });
    const shelved = result.page[0].article;
    expect(Object.keys(shelved).sort()).toEqual(
      [
        "_id",
        "annotationStatus",
        "author",
        "estimatedReadMinutes",
        "reading",
        "title",
        "url",
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toContain(BODY);
  });

  it("shows each reader only their own shelf", async () => {
    const f = await secondReaderTest(modules);
    const ownerIds = await seed(f, "default_user", 3);
    const readerIds = await seed(f, f.readerLibraryId, 2);
    const opts = { paginationOpts: { numItems: 20, cursor: null } };
    const mine: Page = await f.reader.query(fn, opts);
    const theirs: Page = await f.owner.query(fn, opts);
    expect(mine.page.map((s) => s.articleId).sort()).toEqual(
      [...readerIds].sort(),
    );
    expect(theirs.page.map((s) => s.articleId).sort()).toEqual(
      [...ownerIds].sort(),
    );
  });
});

describe("saved ids and loved count", () => {
  it("lists only the reader's saved article ids", async () => {
    const f = await secondReaderTest(modules);
    const ownerIds = await seed(f, "default_user", 3);
    const readerIds = await seed(f, f.readerLibraryId, 2);
    expect(
      new Set(await f.owner.query(api.savedArticles.savedIds, {})),
    ).toEqual(new Set(ownerIds));
    expect(
      new Set(await f.reader.query(api.savedArticles.savedIds, {})),
    ).toEqual(new Set(readerIds));
  });

  it("counts the reader's loved articles", async () => {
    const f = await secondReaderTest(modules);
    await seed(f, "default_user", 3);
    await seed(f, f.readerLibraryId, 2);
    expect(await f.owner.query(api.lovedArticles.count, {})).toBe(3);
    expect(await f.reader.query(api.lovedArticles.count, {})).toBe(2);
  });
});

describe("deprecated list and listAll", () => {
  it("return one page of slim articles", async () => {
    const f = await secondReaderTest(modules);
    await seed(f, "default_user", 20);
    const saved = await f.owner.query(api.savedArticles.list, {});
    const loved = await f.owner.query(api.lovedArticles.listAll, {});
    expect(saved).toHaveLength(12);
    expect(loved).toHaveLength(12);
    expect(JSON.stringify([saved, loved])).not.toContain(BODY);
  });
});
