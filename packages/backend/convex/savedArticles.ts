import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { requireArticle } from "./access";
import { mutation, query } from "./functions";
import {
  SHELF_ID_BOUND,
  SHELF_PAGE_ROWS,
  withShelfArticles,
} from "./lib/shelfArticle";

/** The Saved shelf a page at a time, newest first, with slim articles. */
export const page = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db
      .query("savedArticles")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .order("desc")
      .paginate({
        ...paginationOpts,
        numItems: Math.min(paginationOpts.numItems, SHELF_PAGE_ROWS),
        maximumRowsRead: SHELF_PAGE_ROWS,
      });
    return { ...result, page: await withShelfArticles(ctx, result.page) };
  },
});

/** Which articles the reader has saved, for marking rows elsewhere. */
export const savedIds = query({
  args: {},
  handler: async (ctx) => {
    const saved = await ctx.db
      .query("savedArticles")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .order("desc")
      .take(SHELF_ID_BOUND);
    return saved.map((s) => s.articleId);
  },
});

/**
 * @deprecated Use `page`. Kept for browser tabs still running the old client
 * during a deploy; bounded to one page of slim articles.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const saved = await ctx.db
      .query("savedArticles")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .order("desc")
      .take(SHELF_PAGE_ROWS);
    return withShelfArticles(ctx, saved);
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
