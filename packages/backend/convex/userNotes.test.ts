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

  it("clears stale vectors and rejects tokenless legacy completions, even for matching plain text", async () => {
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
    ).toBeUndefined();
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

describe("a reflection on a replaced margin note", () => {
  it("keeps the reader's note, anchored by its passage, when the annotation is gone", async () => {
    const t = await ownerTest(modules);
    const { articleId, annotationId } = await t.run(async (ctx) => {
      const articleId = await ctx.db.insert("articles", {
        userId: "default_user",
        guid: "replaced",
        url: "https://example.com/replaced",
        title: "An article",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
      const annotationId = await ctx.db.insert("annotations", {
        articleId,
        userId: "default_user",
        type: "question",
        anchorText: "A passage",
        anchorStartOffset: 0,
        anchorEndOffset: 9,
        content: "What would change your mind?",
        relevanceScore: 0.8,
        wasViewed: false,
        wasDismissed: false,
        createdAt: 1,
      });
      // Re-annotation replaced the margin before the reader's save arrived
      await ctx.db.delete("annotations", annotationId);
      return { articleId, annotationId };
    });
    const noteId = await t.mutation(api.userNotes.create, {
      articleId,
      selectedText: "A passage",
      annotationId,
      prompt: "What would change your mind?",
      content: "<p>Evidence from a second team</p>",
      contentPlain: "Evidence from a second team",
    });
    const note = await t.query(api.userNotes.getById, { noteId });
    expect(note?.annotationId).toBeUndefined();
    expect(note).toMatchObject({
      selectedText: "A passage",
      prompt: "What would change your mind?",
    });
  });
});
