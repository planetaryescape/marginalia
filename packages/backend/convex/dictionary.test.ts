/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { readerTest, secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";

async function seed(t: Awaited<ReturnType<typeof secondReaderTest>>["t"]) {
  return t.run(async (ctx) => {
    const articleId = await ctx.db.insert("articles", {
      userId: OWNER,
      guid: "kept",
      url: "https://example.com/kept",
      title: "On boring infrastructure",
      content: "A very long body that must not travel to the client.",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    });
    const deletedId = await ctx.db.insert("articles", {
      userId: OWNER,
      guid: "gone",
      url: "https://example.com/gone",
      title: "Soon deleted",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    });
    await ctx.db.delete(deletedId);
    const lookup = (n: number, articleId: typeof deletedId, word: string) =>
      ctx.db.insert("lookups", {
        userId: OWNER,
        articleId,
        word,
        wordKey: word.toLowerCase(),
        sentence: `Sentence ${n}.`,
        paragraphIndex: n,
        sense: "adj. A fixture sense.",
        createdAt: 1000 + n,
      });
    await lookup(1, articleId, "Elastic");
    await lookup(2, deletedId, "Épistémique");
    await lookup(3, articleId, "ergodic");
  });
}

const first = { numItems: 10, cursor: null };

describe("dictionary.page", () => {
  it("returns the reader's lookups newest first with the article title, null when the article is gone", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await seed(t);
    const result = await owner.query(api.dictionary.page, {
      paginationOpts: first,
    });
    expect(result.page.map((r) => r.wordKey)).toEqual([
      "ergodic",
      "épistémique",
      "elastic",
    ]);
    expect(result.page.map((r) => r.articleTitle)).toEqual([
      "On boring infrastructure",
      null,
      "On boring infrastructure",
    ]);
    // No article body or other storage field is returned
    expect(Object.keys(result.page[0]).sort()).toEqual(
      [
        "_id",
        "articleId",
        "articleTitle",
        "createdAt",
        "paragraphIndex",
        "sense",
        "sentence",
        "word",
        "wordKey",
      ].sort(),
    );
  });

  it("caps a page at 40 whatever the client asks for", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      const articleId = await ctx.db.insert("articles", {
        userId: OWNER,
        guid: "many",
        url: "https://example.com/many",
        title: "Many",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
      for (let i = 0; i < 45; i++)
        await ctx.db.insert("lookups", {
          userId: OWNER,
          articleId,
          word: `w${i}`,
          wordKey: `w${i}`,
          sentence: "s",
          sense: "n. x",
          createdAt: i,
        });
    });
    const result = await owner.query(api.dictionary.page, {
      paginationOpts: { numItems: 1000, cursor: null },
    });
    expect(result.page).toHaveLength(40);
    expect(result.isDone).toBe(false);
  });

  it("is empty for another reader and rejects a caller who isn't signed in", async () => {
    const { t, reader } = await secondReaderTest(modules);
    await seed(t);
    const result = await reader.query(api.dictionary.page, {
      paginationOpts: first,
    });
    expect(result.page).toEqual([]);
    await expect(
      readerTest(modules).query(api.dictionary.page, { paginationOpts: first }),
    ).rejects.toThrow();
  });
});
