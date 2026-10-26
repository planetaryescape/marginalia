/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";
import { MAX_TITLE_MATCHES } from "./titleSearch";

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
