/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";
import { MAX_CITED } from "./citedArticles";

const modules = import.meta.glob("./**/*.ts");

async function article(
  t: Awaited<ReturnType<typeof secondReaderTest>>["t"],
  userId: string,
  title: string,
) {
  return t.run((ctx) =>
    ctx.db.insert("articles", {
      userId,
      guid: `${userId}-${title}`,
      url: `https://www.example.com/${title}`,
      title,
      estimatedReadMinutes: 6,
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );
}

describe("articles cited by the librarian", () => {
  it("returns the reader's own articles in the order cited", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const a = await article(t, "default_user", "A");
    const b = await article(t, "default_user", "B");
    const rows = await owner.query(api.citedArticles.byIds, {
      ids: [b, "not-an-id", a, b],
    });
    expect(rows).toEqual([
      { articleId: b, title: "B", source: "example.com", minutes: 6 },
      { articleId: a, title: "A", source: "example.com", minutes: 6 },
    ]);
  });

  it("never returns another reader's article", async () => {
    const { t, owner, reader, readerLibraryId } =
      await secondReaderTest(modules);
    const mine = await article(t, "default_user", "Mine");
    const theirs = await article(t, readerLibraryId, "Theirs");
    expect(
      await reader.query(api.citedArticles.byIds, { ids: [mine, theirs] }),
    ).toMatchObject([{ articleId: theirs }]);
    expect(
      await owner.query(api.citedArticles.byIds, { ids: [mine, theirs] }),
    ).toMatchObject([{ articleId: mine }]);
  });

  it("reads at most a bounded number", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const ids = [];
    for (let i = 0; i < MAX_CITED + 3; i++)
      ids.push(await article(t, "default_user", `T${i}`));
    const rows = await owner.query(api.citedArticles.byIds, { ids });
    expect(rows).toHaveLength(MAX_CITED);
  });
});
