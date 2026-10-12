import { v } from "convex/values";
import { ownedArticle, requireArticle } from "./access";
import { mutation, query } from "./functions";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const saved = await ctx.db
      .query("savedArticles")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .order("desc")
      .take(50);

    const articles = await Promise.all(
      saved.map(async (s) => {
        const article = await ownedArticle(ctx, s.articleId, ctx.readerId);
        return article ? { ...s, article } : null;
      }),
    );

    return articles.filter(Boolean);
  },
});

export const save = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    await requireArticle(ctx, args.articleId, ctx.readerId);
    const existing = await ctx.db
      .query("savedArticles")
      .withIndex("by_user_article", (q) =>
        q.eq("userId", ctx.readerId).eq("articleId", args.articleId),
      )
      .first();

    if (existing) return existing._id;

    return ctx.db.insert("savedArticles", {
      userId: ctx.readerId,
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
        q.eq("userId", ctx.readerId).eq("articleId", args.articleId),
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
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .collect();
    return saved.length;
  },
});
