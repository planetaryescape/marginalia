/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";
import { MAX_TEXT_MATCHES, MAX_TITLE_MATCHES } from "./titleSearch";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";

type Fixture = Awaited<ReturnType<typeof secondReaderTest>>["t"];

async function article(
  t: Fixture,
  userId: string,
  title: string,
  extra: {
    slug?: string;
    extractionStatus?: "pending" | "extracted" | "failed";
    content?: string;
  } = {},
) {
  const slug = extra.slug ?? title.toLowerCase().replace(/\W+/g, "-");
  return t.run((ctx) =>
    ctx.db.insert("articles", {
      userId,
      guid: `${userId}-${slug}`,
      url: `https://www.example.com/${userId}/${slug}`,
      title,
      content: extra.content,
      estimatedReadMinutes: 7,
      extractionStatus: extra.extractionStatus ?? "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );
}

describe("title match for the picker", () => {
  it("finds an article by words in its title, in the shape of find", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const id = await article(t, OWNER, "Slow Cheese Making");
    await article(t, OWNER, "Fast wine");
    const hits = await owner.query(api.titleSearch.matchTitles, {
      query: "cheese",
    });
    expect(hits).toEqual([
      {
        articleId: id,
        title: "Slow Cheese Making",
        author: null,
        source: "example.com",
        url: `https://www.example.com/${OWNER}/slow-cheese-making`,
        minutes: 7,
        status: "Up next",
      },
    ]);
  });

  it("never returns another reader's article", async () => {
    const { t, owner, reader, readerLibraryId } =
      await secondReaderTest(modules);
    await article(t, OWNER, "Private cheese");
    await article(t, readerLibraryId, "Other wine");
    expect(
      await reader.query(api.titleSearch.matchTitles, { query: "cheese" }),
    ).toEqual([]);
    expect(
      await owner.query(api.titleSearch.matchTitles, { query: "wine" }),
    ).toEqual([]);
    expect(
      await reader.query(api.titleSearch.matchTitles, { query: "wine" }),
    ).toHaveLength(1);
  });

  it("skips articles that aren't extracted", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await article(t, OWNER, "Pending cheese", { extractionStatus: "pending" });
    await article(t, OWNER, "Failed cheese", { extractionStatus: "failed" });
    expect(
      await owner.query(api.titleSearch.matchTitles, { query: "cheese" }),
    ).toEqual([]);
  });

  it("matches the title only, not the body", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await article(t, OWNER, "Something else", { content: "cheese cheese" });
    expect(
      await owner.query(api.titleSearch.matchTitles, { query: "cheese" }),
    ).toEqual([]);
  });

  it("returns one copy of a page saved twice, and unread before read", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const read = await article(t, OWNER, "Cheese first", { slug: "a" });
    const fresh = await article(t, OWNER, "Cheese second", { slug: "b" });
    await t.run(async (ctx) => {
      await ctx.db.insert("articleInteractions", {
        userId: OWNER,
        articleId: read,
        action: "finished",
        createdAt: 1,
      });
      await ctx.db.insert("articles", {
        userId: OWNER,
        guid: "dup",
        url: "https://www.example.com/default_user/b",
        title: "Cheese second again",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
    });
    const hits = await owner.query(api.titleSearch.matchTitles, {
      query: "cheese",
    });
    expect(hits.map((hit) => [hit.articleId, hit.status])).toEqual([
      [fresh, "Up next"],
      [read, "Finished"],
    ]);
  });

  it("reads at most a handful of candidates and ignores a one-letter query", async () => {
    const { t, owner } = await secondReaderTest(modules);
    for (let i = 0; i < MAX_TITLE_MATCHES + 3; i++)
      await article(t, OWNER, `Cheese ${i}`, { slug: `c${i}` });
    const hits = await owner.query(api.titleSearch.matchTitles, {
      query: "cheese",
    });
    expect(hits).toHaveLength(MAX_TITLE_MATCHES);
    expect(
      await owner.query(api.titleSearch.matchTitles, { query: "c" }),
    ).toEqual([]);
  });
});

describe("text match for the picker", () => {
  const find = (
    owner: Awaited<ReturnType<typeof secondReaderTest>>["owner"],
    query: string,
  ) => owner.query(api.titleSearch.matchText, { query });

  it("returns an article whose text holds every typed word, in find's shape", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const id = await article(t, OWNER, "On patience", {
      content: "Sourdough starters reward patience and warm kitchens.",
    });
    expect(await find(owner, "sourdough kitchens")).toEqual([
      {
        articleId: id,
        title: "On patience",
        author: null,
        source: "example.com",
        url: `https://www.example.com/${OWNER}/on-patience`,
        minutes: 7,
        status: "Up next",
      },
    ]);
  });

  it("drops a hit that shares only some of the typed words", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await article(t, OWNER, "Bread", { content: "sourdough starters" });
    expect(await find(owner, "sourdough rockets")).toEqual([]);
  });

  it("ignores stop words and words under three letters", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await article(t, OWNER, "Bread", { content: "sourdough starters" });
    expect(await find(owner, "how to sourdough with the")).toHaveLength(1);
    expect(await find(owner, "how to the")).toEqual([]);
  });

  it("treats the last word as a prefix but earlier words as whole words", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await article(t, OWNER, "Bread", { content: "sourdough starters" });
    expect(await find(owner, "sourdough start")).toHaveLength(1);
    expect(await find(owner, "sour starters")).toEqual([]);
  });

  it("counts a word in the title or excerpt, not only the text", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const id = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: OWNER,
        guid: "g",
        url: "https://www.example.com/x",
        title: "Lemons",
        excerpt: "a note on zest",
        content: "Citrus fruit grows in groves.",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      }),
    );
    const hits = await find(owner, "lemons zest citrus");
    expect(hits.map((hit) => hit.articleId)).toEqual([id]);
  });

  it("never returns another reader's article", async () => {
    const { t, owner, reader, readerLibraryId } =
      await secondReaderTest(modules);
    await article(t, OWNER, "Private", { content: "sourdough starters" });
    await article(t, readerLibraryId, "Other", { content: "espresso crema" });
    expect(await find(reader, "sourdough")).toEqual([]);
    expect(await find(owner, "espresso")).toEqual([]);
    expect(await find(reader, "espresso")).toHaveLength(1);
  });

  it("skips articles that aren't extracted", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await article(t, OWNER, "Pending", {
      slug: "p",
      extractionStatus: "pending",
      content: "sourdough",
    });
    await article(t, OWNER, "Failed", {
      slug: "f",
      extractionStatus: "failed",
      content: "sourdough",
    });
    expect(await find(owner, "sourdough")).toEqual([]);
  });

  it("returns one copy of a page saved twice, and unread before read", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const read = await article(t, OWNER, "First", {
      slug: "a",
      content: "sourdough one",
    });
    const fresh = await article(t, OWNER, "Second", {
      slug: "b",
      content: "sourdough two",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("articleInteractions", {
        userId: OWNER,
        articleId: read,
        action: "finished",
        createdAt: 1,
      });
      await ctx.db.insert("articles", {
        userId: OWNER,
        guid: "dup",
        url: "https://www.example.com/default_user/b",
        title: "Second again",
        content: "sourdough two",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
    });
    const hits = await find(owner, "sourdough");
    expect(hits.map((hit) => [hit.articleId, hit.status])).toEqual([
      [fresh, "Up next"],
      [read, "Finished"],
    ]);
  });

  it("judges the whole query, not its first 200 characters", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await article(t, OWNER, "Words", { content: "internationalization" });
    const long = `${"internationalization ".repeat(10)}rockets`;
    expect(long.length).toBeGreaterThan(200);
    expect(await find(owner, long)).toEqual([]);
  });

  it("returns nothing for a query of more than 16 qualifying words", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await article(t, OWNER, "Words", { content: "sourdough" });
    expect(await find(owner, "sourdough ".repeat(17))).toEqual([]);
    expect(await find(owner, "sourdough ".repeat(16))).toHaveLength(1);
  });

  it("keeps combining marks inside words", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await article(t, OWNER, "Sumer", { content: "Sumerian history" });
    const decomposed = "re\u0301sume\u0301";
    expect(await find(owner, decomposed)).toEqual([]);
    expect(await find(owner, "Sumerian history")).toHaveLength(1);
    await article(t, OWNER, "CV", { slug: "cv", content: "A good résumé." });
    const composed = await find(owner, "r\u00e9sum\u00e9");
    const split = await find(owner, decomposed);
    expect(composed).toHaveLength(1);
    expect(split).toEqual(composed);
  });

  it("finds an article stored with decomposed accents, whichever form is typed", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await article(t, OWNER, "CV", { content: "A good re\u0301sume\u0301." });
    expect(await find(owner, "re\u0301sume\u0301")).toHaveLength(1);
    expect(await find(owner, "r\u00e9sum\u00e9")).toHaveLength(1);
  });

  it("reads at most a handful of candidates", async () => {
    const { t, owner } = await secondReaderTest(modules);
    for (let i = 0; i < MAX_TEXT_MATCHES + 3; i++)
      await article(t, OWNER, `Piece ${i}`, {
        slug: `c${i}`,
        content: "sourdough",
      });
    expect(await find(owner, "sourdough")).toHaveLength(MAX_TEXT_MATCHES);
    expect(await find(owner, "so")).toEqual([]);
  });
});
