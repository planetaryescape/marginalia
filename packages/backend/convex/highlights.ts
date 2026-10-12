import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { DEFAULT_USER_ID } from "./lib/constants";

export const listByArticle = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("highlights")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .take(500);
  },
});

export const listByArticleInternal = internalQuery({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) =>
    ctx.db
      .query("highlights")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .take(500),
});

export const create = mutation({
  args: {
    articleId: v.id("articles"),
    kind: v.union(v.literal("highlight"), v.literal("underline")),
    text: v.string(),
    paragraphIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const highlightId = await ctx.db.insert("highlights", {
      ...args,
      userId: DEFAULT_USER_ID,
      source: "marginalia",
      createdAt: Date.now(),
    });
    // Mirrors the mark to Readwise Reader when the article came from there
    await ctx.scheduler.runAfter(
      0,
      internal.actions.readwiseSync.pushHighlight,
      {
        highlightId,
      },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.actions.embedReaderActivity.embedHighlight,
      {
        highlightId,
      },
    );
    return highlightId;
  },
});

export const remove = mutation({
  args: { highlightId: v.id("highlights") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("highlights", args.highlightId);
    await ctx.db.delete("highlights", args.highlightId);
    // Only marks that started in Marginalia are removed from Reader; deleting an
    // imported Reader highlight here never deletes it there
    if (row?.readerHighlightId && row.source !== "reader") {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.readwiseSync.deleteHighlight,
        {
          readerHighlightId: row.readerHighlightId,
        },
      );
    }
  },
});

export const getByIdInternal = internalQuery({
  args: { highlightId: v.id("highlights") },
  handler: async (ctx, args) => ctx.db.get("highlights", args.highlightId),
});

export const setEmbedding = internalMutation({
  args: { highlightId: v.id("highlights"), embedding: v.array(v.float64()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("highlights", args.highlightId);
    if (row)
      await ctx.db.patch("highlights", args.highlightId, {
        embedding: args.embedding,
      });
  },
});

export const listUnembedded = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("highlights").take(500);
    return rows.filter((r) => !r.embedding).map((r) => r._id);
  },
});
