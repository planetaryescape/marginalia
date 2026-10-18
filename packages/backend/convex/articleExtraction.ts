import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./functions";
import {
  EXTRACTION_LEASE_MS,
  importLibraryActive,
  MAX_IMPORT_ATTEMPTS,
  MAX_IMPORT_CONCURRENCY,
} from "./lib/importJobs";

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
      });
      return null;
    }
    const running = await ctx.db
      .query("articles")
      .withIndex(
        "by_userId_and_extractionStatus_and_extractionLeaseUntil",
        (q) =>
          q
            .eq("userId", article.userId)
            .eq("extractionStatus", "pending")
            .gt("extractionLeaseUntil", Date.now()),
      )
      .take(MAX_IMPORT_CONCURRENCY);
    if (running.length === MAX_IMPORT_CONCURRENCY) {
      await ctx.scheduler.runAfter(
        Math.max(
          1,
          (running[0].extractionLeaseUntil ?? Date.now()) - Date.now() + 1,
        ),
        internal.articleExtraction.start,
        args,
      );
      return null;
    }
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
      args,
    );
    return { article, run };
  },
});

export const start = internalMutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const claim: { article: Doc<"articles">; run: number } | null =
      await ctx.runMutation(internal.articleExtraction.claim, args);
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
    )
      return false;
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
      });
    return true;
  },
});
