import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";
import { nextReviewAt, snoozeReviewAt } from "./lib/spacedRepetition";

export const love = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("lovedArticles")
      .withIndex("by_user_article", (q) =>
        q.eq("userId", DEFAULT_USER_ID).eq("articleId", args.articleId),
      )
      .first();

    if (existing) return existing._id;

    const now = Date.now();
    return ctx.db.insert("lovedArticles", {
      userId: DEFAULT_USER_ID,
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
        q.eq("userId", DEFAULT_USER_ID).eq("articleId", args.articleId),
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
        q.eq("userId", DEFAULT_USER_ID).eq("articleId", args.articleId),
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
        q.eq("userId", DEFAULT_USER_ID).eq("articleId", args.articleId),
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
        q.eq("userId", DEFAULT_USER_ID).eq("articleId", args.articleId),
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
        q.eq("userId", DEFAULT_USER_ID).lte("nextReviewAt", now),
      )
      .take(5);

    const withArticles = await Promise.all(
      loved.map(async (l) => {
        const article = await ctx.db.get(l.articleId);
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

// List all loved articles
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const loved = await ctx.db
      .query("lovedArticles")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .collect();

    const withArticles = await Promise.all(
      loved.map(async (l) => {
        const article = await ctx.db.get(l.articleId);
        return article ? { ...l, article } : null;
      }),
    );

    return withArticles.filter(Boolean);
  },
});
