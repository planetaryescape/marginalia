import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { ownedArticle, requireArticle } from "./access";
import { mutation, query } from "./functions";
import {
  SHELF_ID_BOUND,
  SHELF_PAGE_ROWS,
  withShelfArticles,
} from "./lib/shelfArticle";
import { nextReviewAt, snoozeReviewAt } from "./lib/spacedRepetition";

export const love = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    await requireArticle(ctx, args.articleId, ctx.readerId);
    const existing = await ctx.db
      .query("lovedArticles")
      .withIndex("by_user_article", (q) =>
        q.eq("userId", ctx.readerId).eq("articleId", args.articleId),
      )
      .first();

    if (existing) return existing._id;

    const now = Date.now();
    return ctx.db.insert("lovedArticles", {
      userId: ctx.readerId,
      articleId: args.articleId,
      lovedAt: now,
      reviewIndex: 0,
      nextReviewAt: nextReviewAt(0, now),
      reviewCount: 0,
    });
  },
});

export const unlove = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("lovedArticles")
      .withIndex("by_user_article", (q) =>
        q.eq("userId", ctx.readerId).eq("articleId", args.articleId),
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const isLoved = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("lovedArticles")
      .withIndex("by_user_article", (q) =>
        q.eq("userId", ctx.readerId).eq("articleId", args.articleId),
      )
      .first();
    return !!existing;
  },
});

// Advance to next interval after user re-reads a loved article
export const advanceReview = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const loved = await ctx.db
      .query("lovedArticles")
      .withIndex("by_user_article", (q) =>
        q.eq("userId", ctx.readerId).eq("articleId", args.articleId),
      )
      .first();

    if (!loved) return;

    const now = Date.now();
    const newIndex = loved.reviewIndex + 1;
    await ctx.db.patch(loved._id, {
      reviewIndex: newIndex,
      nextReviewAt: nextReviewAt(newIndex, now),
      lastReviewedAt: now,
      reviewCount: loved.reviewCount + 1,
    });
  },
});

// Snooze 3 days without advancing interval
export const snooze = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const loved = await ctx.db
      .query("lovedArticles")
      .withIndex("by_user_article", (q) =>
        q.eq("userId", ctx.readerId).eq("articleId", args.articleId),
      )
      .first();

    if (!loved) return;

    await ctx.db.patch(loved._id, {
      nextReviewAt: snoozeReviewAt(Date.now()),
    });
  },
});

// Get articles due for review
export const getDueForReview = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const loved = await ctx.db
      .query("lovedArticles")
      .withIndex("by_user_next_review", (q) =>
        q.eq("userId", ctx.readerId).lte("nextReviewAt", now),
      )
      .take(5);

    const withArticles = await Promise.all(
      loved.map(async (l) => {
        const article = await ownedArticle(ctx, l.articleId, ctx.readerId);
        if (!article) return null;

        const daysSinceLastRead = l.lastReviewedAt
          ? Math.round((now - l.lastReviewedAt) / (24 * 60 * 60 * 1000))
          : Math.round((now - l.lovedAt) / (24 * 60 * 60 * 1000));

        return { ...l, article, daysSinceLastRead };
      }),
    );

    return withArticles.filter(Boolean);
  },
});

/** The Loved shelf a page at a time, newest first, with slim articles. */
export const page = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db
      .query("lovedArticles")
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

/** The Loved tab's count; stops at the bound, which no shelf reaches. */
export const count = query({
  args: {},
  handler: async (ctx) => {
    const loved = await ctx.db
      .query("lovedArticles")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .take(SHELF_ID_BOUND);
    return loved.length;
  },
});

/**
 * @deprecated Use `page`. Kept for browser tabs still running the old client
 * during a deploy; bounded to one page of slim articles.
 */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const loved = await ctx.db
      .query("lovedArticles")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .order("desc")
      .take(SHELF_PAGE_ROWS);
    return withShelfArticles(ctx, loved);
  },
});
