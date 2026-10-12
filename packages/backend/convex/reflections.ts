import { v } from "convex/values";
import { ownedArticle } from "./access";
import { internalMutation, mutation, query } from "./functions";

export const getByArticle = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId))) return null;
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
    const previous = await ctx.db.get(args.reflectionId);
    if (previous?.userId !== ctx.readerId)
      throw new Error("Reflection not found");
    await ctx.db.patch(args.reflectionId, {
      userResponse: args.userResponse,
      respondedAt: previous.respondedAt ?? Date.now(),
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
