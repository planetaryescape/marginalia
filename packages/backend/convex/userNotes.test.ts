/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { ownerTest } from "../test/owner";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

describe("note embeddings", () => {
  async function fixture() {
    const t = await ownerTest(modules);
    const noteId = await t.run(async (ctx) => {
      const articleId = await ctx.db.insert("articles", {
        userId: "default_user",
        guid: "test",
        url: "https://example.com/article",
        title: "An article",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
      return ctx.db.insert("userNotes", {
        userId: "default_user",
        articleId,
        selectedText: "A passage",
        content: "<p>Original</p>",
        contentPlain: "Original",
        createdAt: 1,
        updatedAt: 1,
        embedding: [1, 2],
      });
    });
    return { t, noteId };
  }

  it("clears stale vectors on edit and ignores an older embedding job", async () => {
    const { t, noteId } = await fixture();
    await t.mutation(api.userNotes.update, {
      noteId,
      content: "<p>Changed</p>",
      contentPlain: "Changed",
    });
    await t.mutation(internal.userNotes.setEmbedding, {
      noteId,
      contentPlain: "Original",
      embedding: [3, 4],
    });
    expect(await t.query(api.userNotes.getById, { noteId })).toMatchObject({
      contentPlain: "Changed",
    });
    expect(
      (await t.query(api.userNotes.getById, { noteId }))?.embedding,
    ).toBeUndefined();
    await t.mutation(internal.userNotes.setEmbedding, {
      noteId,
      contentPlain: "Changed",
      embedding: [5, 6],
    });
    expect(
      (await t.query(api.userNotes.getById, { noteId }))?.embedding,
    ).toEqual([5, 6]);
  });

  it("lets a delayed embedding finish after its note was deleted", async () => {
    const { t, noteId } = await fixture();
    await t.mutation(api.userNotes.remove, { noteId });
    await t.mutation(internal.userNotes.setEmbedding, {
      noteId,
      contentPlain: "Original",
      embedding: [3, 4],
    });
    expect(await t.query(api.userNotes.getById, { noteId })).toBeNull();
  });
});
