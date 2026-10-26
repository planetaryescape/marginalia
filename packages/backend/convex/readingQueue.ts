import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { libraryIsActive } from "./access";

function contribution(article: Doc<"articles"> | null) {
  if (article?.bible) article = null;
  const annotated =
    article?.queueCounted && article.annotationStatus === "annotated" ? 1 : 0;
  const waiting = annotated && article?.finishedAt === undefined ? 1 : 0;
  const minutes = article?.estimatedReadMinutes ?? Number.POSITIVE_INFINITY;
  return {
    annotated,
    waiting,
    pending:
      article?.queueCounted && article.annotationStatus === "pending" ? 1 : 0,
    fits5: waiting && minutes <= 5 ? 1 : 0,
    fits10: waiting && minutes <= 10 ? 1 : 0,
    fits20: waiting && minutes <= 20 ? 1 : 0,
  };
}

/** Runs in the same transaction as every change that affects the reading queue. */
export async function updateQueueStats(
  ctx: MutationCtx,
  before: Doc<"articles"> | null,
  after: Doc<"articles">,
) {
  let finishedAt = after.finishedAt;
  if (!after.queueCounted && finishedAt === undefined) {
    const finished = await ctx.db
      .query("articleInteractions")
      .withIndex("by_user_article_action", (q) =>
        q
          .eq("userId", after.userId)
          .eq("articleId", after._id)
          .eq("action", "finished"),
      )
      .first();
    finishedAt = finished?.createdAt;
  }
  const nextArticle = { ...after, queueCounted: true, finishedAt };
  const previous = contribution(before);
  const next = contribution(nextArticle);
  const stats = await ctx.db
    .query("readingQueueStats")
    .withIndex("by_user", (q) => q.eq("userId", after.userId))
    .unique();
  const counts = {
    annotated: (stats?.annotated ?? 0) + next.annotated - previous.annotated,
    waiting: (stats?.waiting ?? 0) + next.waiting - previous.waiting,
    pending: (stats?.pending ?? 0) + next.pending - previous.pending,
    fits5: (stats?.fits5 ?? 0) + next.fits5 - previous.fits5,
    fits10: (stats?.fits10 ?? 0) + next.fits10 - previous.fits10,
    fits20: (stats?.fits20 ?? 0) + next.fits20 - previous.fits20,
  };
  if (stats) await ctx.db.patch(stats._id, counts);
  else {
    await ctx.db.insert("readingQueueStats", {
      userId: after.userId,
      ...counts,
      ready: false,
    });
    await ctx.scheduler.runAfter(0, internal.readingQueue.initialize, {
      userId: after.userId,
    });
  }
  await ctx.db.patch(after._id, { queueCounted: true, finishedAt });
}

/** Idempotent, small-page initialization of existing articles and historical finishes. */
export const initialize = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    if (!(await libraryIsActive(ctx, args.userId))) return;
    let stats = await ctx.db
      .query("readingQueueStats")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (stats?.ready) return;
    if (!stats) {
      const id = await ctx.db.insert("readingQueueStats", {
        userId: args.userId,
        annotated: 0,
        waiting: 0,
        pending: 0,
        fits5: 0,
        fits10: 0,
        fits20: 0,
        ready: false,
      });
      stats = await ctx.db.get(id);
    }
    if (!stats) return;
    const page = await ctx.db
      .query("articles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .paginate({
        cursor: stats.cursor ?? null,
        numItems: 8,
        maximumBytesRead: 4_000_000,
      });
    for (const article of page.page) {
      if (!article.queueCounted) await updateQueueStats(ctx, null, article);
    }
    await ctx.db.patch(stats._id, {
      cursor: page.continueCursor,
      ready: page.isDone,
    });
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.readingQueue.initialize, {
        userId: args.userId,
      });
  },
});
