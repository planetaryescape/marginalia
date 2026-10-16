import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { libraryIsActive, ownedArticle } from "./access";

/** Rows per transaction: each carries a 1536-number vector. */
const DISCARD_BATCH = 64;

/**
 * The passages cached for an article, or null when the article isn't this
 * reader's. The article ID arrives from the browser as text, so it is checked
 * here against the reader. Rows from another version of the text or another
 * embedding model count as no cache.
 */
export const cached = internalQuery({
  args: {
    userId: v.string(),
    articleId: v.string(),
    contentHash: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const articleId = ctx.db.normalizeId("articles", args.articleId);
    if (!articleId || !(await ownedArticle(ctx, articleId, args.userId)))
      return null;
    const rows = await ctx.db
      .query("articlePassages")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", articleId),
      )
      .take(1_000);
    const current = rows.every(
      (row) => row.contentHash === args.contentHash && row.model === args.model,
    );
    return {
      articleId,
      passages: current
        ? rows
            .sort((a, b) => a.startParagraph - b.startParagraph)
            .map((row) => ({
              startParagraph: row.startParagraph,
              endParagraph: row.endParagraph,
              fromOffset: row.fromOffset,
              toOffset: row.toOffset,
              embedding: row.embedding,
            }))
        : [],
    };
  },
});

/** Replaces an article's cached passages with a fresh set. */
export const replace = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    contentHash: v.string(),
    model: v.string(),
    passages: v.array(
      v.object({
        startParagraph: v.number(),
        endParagraph: v.number(),
        fromOffset: v.number(),
        toOffset: v.number(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // A reader being deleted gets nothing new written for them
    if (
      !(await libraryIsActive(ctx, args.userId)) ||
      !(await ownedArticle(ctx, args.articleId, args.userId))
    )
      return;
    const old = await ctx.db
      .query("articlePassages")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", args.articleId),
      )
      .take(1_000);
    for (const row of old) await ctx.db.delete("articlePassages", row._id);
    for (const passage of args.passages)
      await ctx.db.insert("articlePassages", {
        userId: args.userId,
        articleId: args.articleId,
        contentHash: args.contentHash,
        model: args.model,
        ...passage,
      });
  },
});

/** Removes a deleted article's passages, a batch at a time. */
export const discard = internalMutation({
  args: { userId: v.string(), articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("articlePassages")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", args.articleId),
      )
      .take(DISCARD_BATCH);
    for (const row of rows) await ctx.db.delete("articlePassages", row._id);
    if (rows.length === DISCARD_BATCH)
      await ctx.scheduler.runAfter(0, internal.articlePassages.discard, args);
  },
});
