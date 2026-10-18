import { v } from "convex/values";
import { internal } from "./_generated/api";
import { ownedArticle, requireArticle } from "./access";
import { internalMutation, internalQuery, mutation, query } from "./functions";

export const RATING_LABELS = [
  "Not for me",
  "Meh",
  "Fine",
  "Good",
  "Loved it",
] as const;

export const getByArticle = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId))) return null;
    return ctx.db
      .query("impressions")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .first();
  },
});

/** Creates or updates the impression; only the fields passed change. */
export const save = mutation({
  args: {
    articleId: v.id("articles"),
    rating: v.optional(v.union(v.number(), v.null())),
    tags: v.optional(v.array(v.string())),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.rating != null && (args.rating < 1 || args.rating > 5)) {
      throw new Error("Rating must be between 1 and 5");
    }
    await requireArticle(ctx, args.articleId, ctx.readerId);
    const existing = await ctx.db
      .query("impressions")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .first();
    const now = Date.now();
    const patch = {
      ...(args.rating !== undefined
        ? { rating: args.rating ?? undefined }
        : {}),
      ...(args.tags !== undefined ? { tags: args.tags.slice(0, 12) } : {}),
      ...(args.note !== undefined
        ? { note: args.note.trim() || undefined }
        : {}),
      updatedAt: now,
    };
    let impressionId = existing?._id;
    if (existing) {
      await ctx.db.patch("impressions", existing._id, patch);
    } else {
      impressionId = await ctx.db.insert("impressions", {
        userId: ctx.readerId,
        articleId: args.articleId,
        tags: [],
        createdAt: now,
        ...patch,
      });
    }
    if (impressionId) {
      // Short delay so a burst of edits (typing the note) embeds once it settles
      await ctx.scheduler.runAfter(
        3_000,
        internal.actions.embedReaderActivity.embedImpression,
        {
          impressionId,
          updatedAt: now,
        },
      );
    }
    return impressionId;
  },
});

/** Same bounded eligibility as listRecent, without fetching any articles. */
export const recentCount = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("impressions")
      .withIndex("by_user_updated", (q) => q.eq("userId", ctx.readerId))
      .order("desc")
      .take(100);
    return rows.filter((row) => row.rating || row.tags.length || row.note)
      .length;
  },
});

/** Your rated and described reads, newest first, with their titles. */
export const listRecent = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("impressions")
      .withIndex("by_user_updated", (q) => q.eq("userId", ctx.readerId))
      .order("desc")
      .take(100);
    // A cleared impression (no rating, tags or note) isn't shown
    const kept = rows.filter(
      (row) => row.rating || row.tags.length || row.note,
    );
    return Promise.all(
      kept.map(async (row) => {
        const article = await ownedArticle(ctx, row.articleId, ctx.readerId);
        return {
          _id: row._id,
          articleId: row.articleId,
          title: article?.title ?? "Removed article",
          author: article?.author,
          rating: row.rating,
          tags: row.tags,
          note: row.note,
          updatedAt: row.updatedAt,
        };
      }),
    );
  },
});

export const getByIdInternal = internalQuery({
  args: { impressionId: v.id("impressions") },
  handler: async (ctx, args) => ctx.db.get("impressions", args.impressionId),
});

export const setEmbedding = internalMutation({
  args: { impressionId: v.id("impressions"), embedding: v.array(v.float64()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("impressions", args.impressionId);
    if (row)
      await ctx.db.patch("impressions", args.impressionId, {
        embedding: args.embedding,
      });
  },
});
