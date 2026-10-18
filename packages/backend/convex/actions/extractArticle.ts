"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { type ActionCtx, internalAction } from "../_generated/server";
import { prepareImportContent } from "../lib/importContent";
import { EXTRACTION_TIMEOUT_MS, retryableImportError } from "../lib/importJobs";
import { interruptible, requestAttempt } from "../lib/requestControl";

export const extractPending = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    if (!(await ctx.runQuery(internal.access.libraryActive, args))) return;
    const pending = await ctx.runQuery(
      internal.articles.listPendingExtractionInternal,
      args,
    );
    for (const article of pending) await extractSingle(ctx, article._id);
    // Every new row and every claim durably schedules its own wake. Legacy
    // pending rows are visited a bounded page at the existing poll cadence.
  },
});

export const extractOne = internalAction({
  args: { articleId: v.id("articles") },
  handler: (ctx, args) => extractSingle(ctx, args.articleId),
});

export const extractClaimed = internalAction({
  args: { articleId: v.id("articles"), userId: v.string(), run: v.number() },
  handler: async (ctx, args) => {
    const article = await ctx.runQuery(
      internal.articleExtraction.getClaim,
      args,
    );
    if (article) await runExtraction(ctx, article, args.run);
  },
});

async function extractSingle(ctx: ActionCtx, articleId: Id<"articles">) {
  const claim = await ctx.runMutation(internal.articleExtraction.claim, {
    articleId,
  });
  if (!claim) return;
  const { article, run } = claim;
  await runExtraction(ctx, article, run);
}

async function runExtraction(
  ctx: ActionCtx,
  article: Doc<"articles">,
  run: number,
) {
  const articleId = article._id;
  const deadlineAt = Date.now() + EXTRACTION_TIMEOUT_MS;
  const attempt = requestAttempt(undefined, EXTRACTION_TIMEOUT_MS);
  try {
    if (!article.url) throw new Error("Missing article URL");
    const { extract } = await import("@extractus/article-extractor");
    // Installed 8.0.20 supports AbortSignal in the THIRD fetchOptions argument.
    const result = await interruptible(
      extract(article.url, {}, { signal: attempt.signal }),
      attempt.signal,
    );
    const content = result?.content && prepareImportContent(result.content);
    // Abort cannot preempt synchronous parser work; reject its late result too.
    if (Date.now() >= deadlineAt)
      throw new DOMException(
        "Article extraction deadline exceeded",
        "TimeoutError",
      );
    if (!content) throw new Error("Invalid or oversized extracted article");
    await ctx.runMutation(internal.articles.updateExtracted, {
      articleId,
      extractionRun: run,
      userId: article.userId,
      ...content,
      imageUrl: (result.image || article.imageUrl)?.toWellFormed(),
      title: (result.title || article.title || article.url).toWellFormed(),
      author: (result.author || article.author)?.toWellFormed(),
    });
  } catch (error) {
    await ctx.runMutation(internal.articleExtraction.fail, {
      articleId,
      userId: article.userId,
      run,
      retryable: retryableImportError(error),
    });
  } finally {
    attempt.abort();
    attempt.dispose();
  }
}
