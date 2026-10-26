import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./functions";
import {
  articleUseWithoutReflections,
  finishFeedArticleProof,
  removes,
} from "./lib/feedRemoval";
import { resumeFeedRemoval } from "./lib/feedRemovalState";
import { metadataLibraryRetained } from "./lib/shelfCounts";

/** A complete, unchanged scan is authority; a page cutoff is not. Only the
 * transient job is written. Generic reflection writers reset its cursor and
 * increment its revision atomically, including writes behind an old cursor.
 * One byte-bounded pagination per function, even when its page is empty. */
export const prepare = internalMutation({
  args: { jobId: v.id("feedArticleCleanup") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (job?.phase !== "checking") return;
    const run = await ctx.db.get(job.runId);
    if (
      run?.phase !== "feed" ||
      run.currentJobId !== jobId ||
      run.userId !== job.userId ||
      run.feedId !== job.feedId ||
      run.choice !== job.choice
    ) {
      await ctx.db.delete(jobId);
      return;
    }
    const article = await ctx.db.get(job.articleId);
    if (
      article?.userId !== job.userId ||
      article.feedId !== job.feedId ||
      !(await metadataLibraryRetained(ctx, job.userId))
    ) {
      await ctx.db.delete(jobId);
      await resumeFeedRemoval(ctx, job);
      return;
    }
    // These policy reads and the complete-proof consumption are one atomic
    // transaction. A late personal save either protects or sees no parent.
    const use = await articleUseWithoutReflections(ctx, article);
    if (!removes(job.choice, use)) {
      await ctx.db.delete(jobId);
      await resumeFeedRemoval(ctx, job);
      return;
    }
    const page = await ctx.db
      .query("reflections")
      .withIndex("by_article", (q) => q.eq("articleId", job.articleId))
      .paginate({
        cursor: job.cursor ?? null,
        numItems: 64,
        maximumRowsRead: 64,
        maximumBytesRead: 512 * 1024,
      });
    if (page.page.some((row) => row.userResponse !== undefined)) {
      await ctx.db.delete(jobId);
      await resumeFeedRemoval(ctx, job);
      return;
    }
    if (!page.isDone) {
      await ctx.db.patch(jobId, { cursor: page.continueCursor });
      await ctx.scheduler.runAfter(0, internal.feedRemovalCleanup.prepare, {
        jobId,
      });
      return;
    }
    const current = await ctx.db.get(jobId);
    if (current?.phase !== "checking" || current.revision !== job.revision)
      return;
    await finishFeedArticleProof(ctx, job, article);
  },
});

const nextPhase = {
  annotations: "summaries",
  summaries: "reflections",
  reflections: "savedArticles",
  savedArticles: "lovedArticles",
  lovedArticles: "articleTags",
  articleTags: null,
} as const;

/** Only an absent immutable source ID is cleanup authority. No state row can
 * be recreated by an obsolete callback, and no network slot is touched here.
 * One child per transaction reserves room for generic writer amplification,
 * including a near-limit tag and its vocabulary maintenance.
 */
export const discard = internalMutation({
  args: { jobId: v.id("feedArticleCleanup") },
  handler: async (ctx, { jobId }) => {
    const args = await ctx.db.get(jobId);
    if (!args || args.phase === "checking" || args.phase === "feed") return;
    if (await ctx.db.get(args.articleId)) return;
    if (args.phase === "articleTags") {
      const link = await ctx.db
        .query("articleTags")
        .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
        .first();
      if (!link) {
        await ctx.db.delete(jobId);
        return;
      }
      await ctx.db.delete(link._id);
      const tag = await ctx.db.get(link.tagId);
      if (tag)
        await ctx.db.patch(tag._id, { count: Math.max(0, tag.count - 1) });
    } else if (
      args.phase === "savedArticles" ||
      args.phase === "lovedArticles"
    ) {
      const row = await ctx.db
        .query(args.phase)
        .withIndex("by_user_article", (q) =>
          q.eq("userId", args.userId).eq("articleId", args.articleId),
        )
        .first();
      if (row) await ctx.db.delete(row._id);
      else {
        const next = nextPhase[args.phase];
        await ctx.db.patch(jobId, { phase: next });
        await ctx.scheduler.runAfter(0, internal.feedRemovalCleanup.discard, {
          jobId,
        });
        return;
      }
    } else {
      const row = await ctx.db
        .query(args.phase)
        .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
        .first();
      // This cannot arise from accepted saves: saveResponse checks the source
      // in the same transaction, and eligibility checks every answered row.
      // If an out-of-band writer broke that invariant, preserve private prose.
      if (row && "userResponse" in row && row.userResponse !== undefined)
        throw new Error("Cannot discard a reader's reflection response");
      if (row) await ctx.db.delete(row._id);
      else {
        await ctx.db.patch(jobId, { phase: nextPhase[args.phase] });
        await ctx.scheduler.runAfter(0, internal.feedRemovalCleanup.discard, {
          jobId,
        });
        return;
      }
    }
    await ctx.scheduler.runAfter(0, internal.feedRemovalCleanup.discard, {
      jobId,
    });
  },
});
