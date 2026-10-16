/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const EMBEDDING_DIMENSIONS = 1536;

async function fixture() {
  const fx = await secondReaderTest(modules);
  const { t, readerLibraryId } = fx;
  const seeded = await t.run(async (ctx) => {
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
    const ownerArticle = await article(OWNER, "owner-article");
    const readerArticle = await article(readerLibraryId, "reader-article");
    const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
      Math.sin(i),
    );
    const mark = (
      userId: string,
      articleId: Id<"articles">,
      text: string,
      createdAt: number,
      kind: "highlight" | "underline" = "highlight",
    ) =>
      ctx.db.insert("highlights", {
        userId,
        articleId,
        kind,
        text,
        createdAt,
        embedding,
      });
    return {
      ownerArticle,
      readerArticle,
      ownerMark: await mark(OWNER, ownerArticle, "owner mark", 10),
      readerOld: await mark(readerLibraryId, readerArticle, "reader old", 1),
      readerUnder: await mark(
        readerLibraryId,
        readerArticle,
        "reader underline",
        2,
        "underline",
      ),
      readerNew: await mark(readerLibraryId, readerArticle, "reader new", 3),
    };
  });
  return { ...fx, ...seeded };
}

const first = (numItems = 50) => ({ numItems, cursor: null });

describe("highlights.listMine", () => {
  it("returns only the signed-in reader's marks, newest first", async () => {
    const { reader, owner, readerArticle } = await fixture();
    const result = await reader.query(api.highlights.listMine, {
      paginationOpts: first(),
    });
    expect(result.page.map((m) => m.text)).toEqual([
      "reader new",
      "reader underline",
      "reader old",
    ]);
    expect(result.isDone).toBe(true);
    expect(result.page[1]).toEqual({
      _id: expect.any(String),
      articleId: readerArticle,
      kind: "underline",
      text: "reader underline",
      createdAt: 2,
    });
    const ownerResult = await owner.query(api.highlights.listMine, {
      paginationOpts: first(),
    });
    expect(ownerResult.page.map((m) => m.text)).toEqual(["owner mark"]);
  });

  it("never returns the embedding, even for a large page", async () => {
    const { t, reader, readerLibraryId, readerArticle } = await fixture();
    const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.5);
    await t.run(async (ctx) => {
      for (let i = 0; i < 60; i++)
        await ctx.db.insert("highlights", {
          userId: readerLibraryId,
          articleId: readerArticle,
          kind: "highlight",
          text: `bulk ${i}`,
          createdAt: 100 + i,
          embedding,
        });
    });
    const result = await reader.query(api.highlights.listMine, {
      paginationOpts: first(50),
    });
    expect(result.page).toHaveLength(50);
    for (const row of result.page) {
      expect(Object.keys(row).sort()).toEqual(
        ["_id", "articleId", "createdAt", "kind", "text"].sort(),
      );
    }
    // 50 vectors of 1536 numbers would be over 500 KB; the projection is a few KB
    expect(JSON.stringify(result).length).toBeLessThan(20_000);
  });

  it("pages through every mark once, with no repeats or gaps", async () => {
    const { reader, readerLibraryId, readerArticle, t } = await fixture();
    await t.run(async (ctx) => {
      for (let i = 0; i < 7; i++)
        await ctx.db.insert("highlights", {
          userId: readerLibraryId,
          articleId: readerArticle,
          kind: "highlight",
          text: `bulk ${i}`,
          createdAt: 100 + i,
        });
    });
    const seen: string[] = [];
    let page = await reader.query(api.highlights.listMine, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    seen.push(...page.page.map((m) => m.text));
    while (!page.isDone) {
      page = await reader.query(api.highlights.listMine, {
        paginationOpts: { numItems: 2, cursor: page.continueCursor },
      });
      seen.push(...page.page.map((m) => m.text));
    }
    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
  });
});
