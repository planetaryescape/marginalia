import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listByArticle = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("annotations")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .collect();
  },
});

export const markViewed = mutation({
  args: { annotationId: v.id("annotations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.annotationId, { wasViewed: true });
  },
});

export const markDismissed = mutation({
  args: { annotationId: v.id("annotations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.annotationId, { wasDismissed: true });
  },
});

export const deleteByArticle = internalMutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const annotations = await ctx.db
      .query("annotations")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .collect();
    for (const ann of annotations) {
      await ctx.db.delete(ann._id);
    }
  },
});

// --- Internal ---

export const insert = internalMutation({
  args: {
    articleId: v.id("articles"),
    userId: v.string(),
    type: v.union(
      v.literal("cross_reference"),
      v.literal("context"),
      v.literal("tension"),
      v.literal("question"),
    ),
    anchorText: v.string(),
    anchorStartOffset: v.number(),
    anchorEndOffset: v.number(),
    content: v.string(),
    notePath: v.optional(v.string()),
    noteExcerpt: v.optional(v.string()),
    relevanceScore: v.number(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("annotations", {
      ...args,
      wasViewed: false,
      wasDismissed: false,
      createdAt: Date.now(),
    });
  },
});
