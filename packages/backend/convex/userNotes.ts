import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";

export const create = mutation({
  args: {
    articleId: v.id("articles"),
    selectedText: v.string(),
    selectedStartOffset: v.optional(v.number()),
    selectedEndOffset: v.optional(v.number()),
    annotationId: v.optional(v.id("annotations")),
    prompt: v.optional(v.string()),
    content: v.string(),
    contentPlain: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const noteId = await ctx.db.insert("userNotes", {
      userId: DEFAULT_USER_ID,
      articleId: args.articleId,
      selectedText: args.selectedText,
      selectedStartOffset: args.selectedStartOffset,
      selectedEndOffset: args.selectedEndOffset,
      annotationId: args.annotationId,
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
    await ctx.db.patch(args.noteId, {
      content: args.content,
      contentPlain: args.contentPlain,
      updatedAt: Date.now(),
      embedding: undefined,
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
    await ctx.db.delete(args.noteId);
  },
});

export const listByArticle = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("userNotes")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .order("desc")
      .collect();
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("userNotes")
      .withIndex("by_user_recent", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(100);
  },
});

export const getById = query({
  args: { noteId: v.id("userNotes") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.noteId);
  },
});

// --- Internal ---

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
    await ctx.db.patch(args.noteId, { embedding: args.embedding });
  },
});
