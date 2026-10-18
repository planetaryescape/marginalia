import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { ownedArticle, requireArticle } from "./access";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { nodeKey } from "./lib/ideaGraph";
import {
  assertBytes,
  NOTE_HTML_BYTES,
  NOTE_PLAIN_BYTES,
  notePreview,
  validateIndex,
  validateNote,
} from "./lib/readerBodies";

export const create = mutation({
  args: {
    articleId: v.id("articles"),
    selectedText: v.string(),
    selectedStartOffset: v.optional(v.number()),
    selectedEndOffset: v.optional(v.number()),
    unitIndex: v.optional(v.number()),
    annotationId: v.optional(v.id("annotations")),
    prompt: v.optional(v.string()),
    content: v.string(),
    contentPlain: v.string(),
  },
  handler: async (ctx, args) => {
    await requireArticle(ctx, args.articleId, ctx.readerId);
    validateNote(args.content, args.contentPlain);
    assertBytes(args.selectedText, 32_000, "Selection");
    if (args.prompt) assertBytes(args.prompt, 16_000, "Prompt");
    validateIndex(args.unitIndex, "unit");
    let annotationId = args.annotationId;
    if (annotationId) {
      // The annotation may since have been replaced, but never another reader's
      const annotation = await ctx.db.get("annotations", annotationId);
      if (
        annotation &&
        (annotation.userId !== ctx.readerId ||
          annotation.articleId !== args.articleId ||
          annotation.unitIndex !== args.unitIndex)
      )
        throw new Error("Annotation not found");
      // Replaced while the reader was writing: keep the note as their own,
      // anchored by its passage, so it still sits beside its line
      if (!annotation) annotationId = undefined;
    }
    const now = Date.now();
    const noteId = await ctx.db.insert("userNotes", {
      userId: ctx.readerId,
      articleId: args.articleId,
      selectedText: args.selectedText,
      selectedStartOffset: args.selectedStartOffset,
      selectedEndOffset: args.selectedEndOffset,
      unitIndex: args.unitIndex,
      annotationId,
      prompt: args.prompt,
      content: args.content,
      contentPlain: args.contentPlain,
      createdAt: now,
      updatedAt: now,
    });
    // Schedule embedding
    await ctx.scheduler.runAfter(0, internal.actions.embedUserNote.embed, {
      noteId,
    });
    return noteId;
  },
});

export const update = mutation({
  args: {
    noteId: v.id("userNotes"),
    content: v.string(),
    contentPlain: v.string(),
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get("userNotes", args.noteId);
    if (note?.userId !== ctx.readerId) throw new Error("Note not found");
    validateNote(args.content, args.contentPlain);
    await ctx.db.patch(args.noteId, {
      content: args.content,
      contentPlain: args.contentPlain,
      updatedAt: Date.now(),
      embedding: undefined,
      embeddedAt: Date.now(),
    });
    // Notes autosave while you type, so keep the embedding in step with the text
    await ctx.scheduler.runAfter(0, internal.actions.embedUserNote.embed, {
      noteId: args.noteId,
    });
  },
});

export const remove = mutation({
  args: { noteId: v.id("userNotes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get("userNotes", args.noteId);
    if (note?.userId !== ctx.readerId) throw new Error("Note not found");
    await ctx.db.delete(args.noteId);
    // Its links go in small batches of their own, so a heavily linked note
    // can't push this delete over a transaction limit
    await ctx.scheduler.runAfter(0, internal.ideaLinks.sweep, {
      userId: ctx.readerId,
      key: nodeKey("note", args.noteId),
    });
  },
});

export const listByArticle = query({
  args: {
    articleId: v.id("articles"),
    // For a book: only the notes written in this part
    unitIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId))) return [];
    const unitIndex = args.unitIndex;
    return unitIndex === undefined
      ? ctx.db
          .query("userNotes")
          .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
          .order("desc")
          .collect()
      : ctx.db
          .query("userNotes")
          .withIndex("by_article_and_unitIndex", (q) =>
            q.eq("articleId", args.articleId).eq("unitIndex", unitIndex),
          )
          .order("desc")
          .collect();
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("userNotes")
      .withIndex("by_user_recent", (q) => q.eq("userId", ctx.readerId))
      .order("desc")
      .take(100);
  },
});

export const getById = query({
  args: { noteId: v.id("userNotes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    return note?.userId === ctx.readerId ? note : null;
  },
});

/** Additive lean contract. Full HTML and vectors never enter a collection DTO.
 * Pagination bounds whole-document database reads, not just wire bytes. */
export const listPreviewsByArticle = query({
  args: {
    articleId: v.id("articles"),
    unitIndex: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId)))
      return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db
      .query("userNotes")
      .withIndex("by_article_and_unitIndex", (q) =>
        q.eq("articleId", args.articleId).eq("unitIndex", args.unitIndex),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.max(1, Math.min(25, args.paginationOpts.numItems)),
        maximumBytesRead: 2_000_000,
      });
    return {
      ...page,
      page: await Promise.all(
        page.page.filter((row) => row.userId === ctx.readerId).map(notePreview),
      ),
    };
  },
});

export const listPreviews = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("userNotes")
      .withIndex("by_user_recent", (q) => q.eq("userId", ctx.readerId))
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.max(1, Math.min(25, args.paginationOpts.numItems)),
        maximumBytesRead: 2_000_000,
      });
    return { ...page, page: await Promise.all(page.page.map(notePreview)) };
  },
});

export const getPreviewById = query({
  args: { noteId: v.id("userNotes") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.noteId);
    return row?.userId === ctx.readerId ? notePreview(row) : null;
  },
});

/** Old oversized notes are returned whole only here, on explicit open. Never
 * return truncated rich HTML that an editor could overwrite as a full note. */
export const getBody = query({
  args: { noteId: v.id("userNotes") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.noteId);
    if (row?.userId !== ctx.readerId) return null;
    return {
      _id: row._id,
      content: row.content,
      contentPlain: row.contentPlain,
      legacyOversized:
        new TextEncoder().encode(row.content).byteLength > NOTE_HTML_BYTES ||
        new TextEncoder().encode(row.contentPlain).byteLength >
          NOTE_PLAIN_BYTES,
    };
  },
});

// --- Internal ---

export const listByArticleInternal = internalQuery({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) =>
    ctx.db
      .query("userNotes")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .order("desc")
      .take(500),
});

export const getByIdInternal = internalQuery({
  args: { noteId: v.id("userNotes") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.noteId);
  },
});

export const setEmbedding = internalMutation({
  args: {
    noteId: v.id("userNotes"),
    embedding: v.array(v.float64()),
    contentPlain: v.string(),
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    // A slow embedding must not replace one for newer text, or resurrect a deleted note.
    if (!note || note.contentPlain !== args.contentPlain) return;
    await ctx.db.patch(args.noteId, {
      embedding: args.embedding,
      embeddedAt: Date.now(),
    });
  },
});
