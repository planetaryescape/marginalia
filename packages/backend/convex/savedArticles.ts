import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const saved = await ctx.db
      .query("savedArticles")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(50);

    const articles = await Promise.all(
      saved.map(async (s) => {
        const article = await ctx.db.get(s.articleId);
        return article ? { ...s, article } : null;
      }),
    );

    return articles.filter(Boolean);
  },
});

export const save = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("savedArticles")
      .withIndex("by_user_article", (q) =>
        q.eq("userId", DEFAULT_USER_ID).eq("articleId", args.articleId),
      )
      .first();

    if (existing) return existing._id;

    return ctx.db.insert("savedArticles", {
      userId: DEFAULT_USER_ID,
      articleId: args.articleId,
      savedAt: Date.now(),
    });
  },
});

export const unsave = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("savedArticles")
      .withIndex("by_user_article", (q) =>
        q.eq("userId", DEFAULT_USER_ID).eq("articleId", args.articleId),
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const count = query({
  args: {},
  handler: async (ctx) => {
    const saved = await ctx.db
      .query("savedArticles")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .collect();
    return saved.length;
  },
});
