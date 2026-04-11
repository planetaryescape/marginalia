import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getByArticle = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("reflections")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .first();
  },
});

export const saveResponse = mutation({
  args: {
    reflectionId: v.id("reflections"),
    userResponse: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reflectionId, {
      userResponse: args.userResponse,
    });
  },
});

export const deleteByArticle = internalMutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const reflections = await ctx.db
      .query("reflections")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .collect();
    for (const r of reflections) {
      await ctx.db.delete(r._id);
    }
  },
});

// --- Internal ---

export const insert = internalMutation({
  args: {
    articleId: v.id("articles"),
    userId: v.string(),
    strongestPoint: v.string(),
    weakestAssumption: v.string(),
    credibleCounterview: v.string(),
    questionForYou: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("reflections", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
