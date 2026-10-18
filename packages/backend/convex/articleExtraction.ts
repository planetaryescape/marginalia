import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./functions";
import {
  EXTRACTION_LEASE_MS,
  importLibraryActive,
  MAX_IMPORT_ATTEMPTS,
  MAX_IMPORT_CONCURRENCY,
} from "./lib/importJobs";

async function activeExtractions(ctx: MutationCtx, userId: string) {
  return ctx.db
    .query("articles")
    .withIndex("by_userId_and_extractionStatus_and_extractionLeaseUntil", (q) =>
      q
        .eq("userId", userId)
        .eq("extractionStatus", "pending")
        .gt("extractionLeaseUntil", Date.now()),
    )
    .take(MAX_IMPORT_CONCURRENCY);
}

/** Indexed due/non-book/unclaimed rows only; at most two bodies (<2 MiB). */
export async function wakeExtraction(ctx: MutationCtx, userId: string) {
  if (!(await importLibraryActive(ctx, userId))) return;
  const slots =
    MAX_IMPORT_CONCURRENCY - (await activeExtractions(ctx, userId)).length;
  if (!slots) return;
  const ready = await ctx.db
    .query("articles")
    .withIndex("by_extraction_queue", (q) =>
      q
        .eq("userId", userId)
        .eq("extractionStatus", "pending")
        .eq("bookUnitCount", undefined)
        .eq("extractionLeaseUntil", undefined)
        .lte("extractionRetryAt", Date.now()),
    )
    .take(slots);
  for (const row of ready)
    await ctx.scheduler.runAfter(0, internal.articleExtraction.start, {
      articleId: row._id,
      userId,
    });
}

/** The transaction claims the work before the first external fetch. */
export const claim = internalMutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    if (
      !article ||
      article.extractionStatus !== "pending" ||
      article.bookUnitCount !== undefined ||
      !(await importLibraryActive(ctx, article.userId)) ||
      (article.extractionLeaseUntil ?? 0) > Date.now() ||
      (article.extractionRetryAt ?? 0) > Date.now()
    )
      return null;
    const attempts = (article.extractionAttempts ?? 0) + 1;
    if (attempts > MAX_IMPORT_ATTEMPTS) {
      await ctx.db.patch(article._id, {
        extractionStatus: "failed",
        extractionFailure: "exhausted",
        extractionLeaseUntil: undefined,
        extractionRetryAt: undefined,
      });
      await wakeExtraction(ctx, article.userId);
      return null;
    }
    if (article.extractionLeaseUntil !== undefined) {
      // The expired worker is fenced already; a full pool must leave this row
      // selectable when a current worker releases its slot.
      await ctx.db.patch(article._id, { extractionLeaseUntil: undefined });
    }
    if (
      (await activeExtractions(ctx, article.userId)).length ===
      MAX_IMPORT_CONCURRENCY
    )
      return null;
    const run = (article.extractionRun ?? 0) + 1;
    await ctx.db.patch(article._id, {
      extractionRun: run,
      extractionAttempts: attempts,
      extractionLeaseUntil: Date.now() + EXTRACTION_LEASE_MS,
      extractionRetryAt: undefined,
    });
    await ctx.scheduler.runAfter(
      EXTRACTION_LEASE_MS,
      internal.articleExtraction.start,
      { ...args, userId: article.userId },
    );
    return { article, run };
  },
});

export const start = internalMutation({
  args: { articleId: v.id("articles"), userId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const claim: { article: Doc<"articles">; run: number } | null =
      await ctx.runMutation(internal.articleExtraction.claim, {
        articleId: args.articleId,
      });
    if (claim)
      await ctx.scheduler.runAfter(
        0,
        internal.actions.extractArticle.extractClaimed,
        {
          articleId: args.articleId,
          userId: claim.article.userId,
          run: claim.run,
        },
      );
    const userId =
      claim?.article.userId ??
      args.userId ??
      (await ctx.db.get("articles", args.articleId))?.userId;
    if (userId) await wakeExtraction(ctx, userId);
  },
});

export const getClaim = internalQuery({
  args: { articleId: v.id("articles"), userId: v.string(), run: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("articles", args.articleId);
    return row?.userId === args.userId &&
      row.extractionStatus === "pending" &&
      row.extractionRun === args.run &&
      (row.extractionLeaseUntil ?? 0) > Date.now() &&
      (await importLibraryActive(ctx, args.userId))
      ? row
      : null;
  },
});

export const fail = internalMutation({
  args: {
    articleId: v.id("articles"),
    userId: v.string(),
    run: v.number(),
    retryable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    if (
      !article ||
      article.userId !== args.userId ||
      article.extractionStatus !== "pending" ||
      article.extractionRun !== args.run ||
      (article.extractionLeaseUntil ?? 0) <= Date.now() ||
      !(await importLibraryActive(ctx, args.userId))
    ) {
      await wakeExtraction(ctx, args.userId);
      return false;
    }
    const retry =
      args.retryable && (article.extractionAttempts ?? 0) < MAX_IMPORT_ATTEMPTS;
    const delay = 5_000 * (article.extractionAttempts ?? 1);
    await ctx.db.patch(article._id, {
      extractionStatus: retry ? "pending" : "failed",
      extractionFailure: retry
        ? "transient"
        : args.retryable
          ? "exhausted"
          : "invalid",
      extractionLeaseUntil: undefined,
      extractionRetryAt: retry ? Date.now() + delay : undefined,
    });
    if (retry)
      await ctx.scheduler.runAfter(delay, internal.articleExtraction.start, {
        articleId: article._id,
        userId: args.userId,
      });
    await wakeExtraction(ctx, args.userId);
    return true;
  },
});
