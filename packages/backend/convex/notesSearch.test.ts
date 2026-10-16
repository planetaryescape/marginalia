/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";
import { MAX_NOTE_HITS } from "./notesSearch";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";

async function seed(
  t: Awaited<ReturnType<typeof secondReaderTest>>["t"],
  userId: string,
  word: string,
  count = 1,
) {
  return t.run(async (ctx) => {
    const articleId = await ctx.db.insert("articles", {
      userId,
      guid: `${userId}-${word}`,
      url: `https://example.com/${userId}-${word}`,
      title: `${userId} article`,
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    });
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("userNotes", {
        userId,
        articleId,
        selectedText: "A passage",
        content: `<p>${word} ${i}</p>`,
        contentPlain: `${word} ${i}`,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("highlights", {
        userId,
        articleId,
        kind: "highlight",
        text: `${word} mark ${i}`,
        paragraphIndex: 2,
        createdAt: 1,
      });
    }
    return articleId;
  });
}

describe("notes search for the picker", () => {
  it("finds a note and a highlight with where to open them", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const articleId = await seed(t, OWNER, "cheese");
    const hits = await owner.query(api.notesSearch.find, { query: "cheese" });
    expect(hits.map((h) => h.kind)).toEqual(["note", "highlight"]);
    expect(hits[1]).toMatchObject({ articleId, paragraphIndex: 2 });
  });

  it("returns at most five", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await seed(t, OWNER, "cheese", 8);
    const hits = await owner.query(api.notesSearch.find, { query: "cheese" });
    expect(hits).toHaveLength(MAX_NOTE_HITS);
  });

  it("never shows one reader another's notes", async () => {
    const { t, owner, reader, readerLibraryId } =
      await secondReaderTest(modules);
    await seed(t, OWNER, "cheese");
    await seed(t, readerLibraryId, "wine");
    expect(
      await reader.query(api.notesSearch.find, { query: "cheese" }),
    ).toEqual([]);
    expect(await owner.query(api.notesSearch.find, { query: "wine" })).toEqual(
      [],
    );
    const own = await reader.query(api.notesSearch.find, { query: "wine" });
    expect(own).toHaveLength(2);
  });

  it("ignores a one-letter query", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await seed(t, OWNER, "cheese");
    expect(await owner.query(api.notesSearch.find, { query: "c" })).toEqual([]);
  });
});
