import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export const feedRemovalPhase = v.union(
  v.literal("annotations"),
  v.literal("summaries"),
  v.literal("reflections"),
  v.literal("savedArticles"),
  v.literal("lovedArticles"),
  v.literal("articleTags"),
);

export const feedRemovalJob = v.union(
  v.object({
    userId: v.string(),
    articleId: v.id("articles"),
    phase: v.literal("checking"),
    runId: v.id("feedArticleCleanup"),
    feedId: v.id("feeds"),
    choice: v.union(v.literal("unread"), v.literal("all")),
    revision: v.number(),
    cursor: v.optional(v.string()),
    resumeCursor: v.string(),
    sourceDone: v.boolean(),
    readerDeletes: v.number(),
  }),
  v.object({
    userId: v.string(),
    articleId: v.id("articles"),
    phase: feedRemovalPhase,
  }),
  v.object({
    userId: v.string(),
    feedId: v.id("feeds"),
    choice: v.union(v.literal("unread"), v.literal("all")),
    phase: v.literal("feed"),
    cursor: v.optional(v.string()),
    readerDeletes: v.number(),
    currentJobId: v.optional(v.id("feedArticleCleanup")),
  }),
);

export type CheckingRemoval = Extract<
  Doc<"feedArticleCleanup">,
  { phase: "checking" }
>;
export const READER_DELETE_SPACING_MS = 3_500;
export type FeedRemovalRun = Extract<
  Doc<"feedArticleCleanup">,
  { phase: "feed" }
>;

/** One transient checkpoint per actual removal, not a stable library version.
 * Old argument payloads join its current cursor/count instead of replaying an
 * obsolete Reader count. It is removed when the owned source scan completes. */
export async function advanceFeedRemovalRun(
  ctx: MutationCtx,
  run: FeedRemovalRun,
  cursor: string,
  sourceDone: boolean,
  readerDeletes = run.readerDeletes,
) {
  if (sourceDone) {
    await ctx.db.delete(run._id);
    return;
  }
  await ctx.db.patch(run._id, {
    cursor,
    readerDeletes,
    currentJobId: undefined,
  });
  await ctx.scheduler.runAfter(0, internal.feeds.removeArticles, {
    userId: run.userId,
    feedId: run.feedId,
    choice: run.choice,
    cursor,
    readerDeletes,
  });
}

export async function resumeFeedRemoval(
  ctx: MutationCtx,
  job: CheckingRemoval,
  readerDeletes = job.readerDeletes,
) {
  const run = await ctx.db.get(job.runId);
  if (run?.phase !== "feed" || run.currentJobId !== job._id) return;
  await advanceFeedRemovalRun(
    ctx,
    run,
    job.resumeCursor,
    job.sourceDone,
    readerDeletes,
  );
}

/** Only source identity/lifetime changes cancel the pre-delete proof. The
 * deletion helper transitions to cleanup BEFORE deleting its parent, so this
 * hook cannot erase the just-created post-delete publication fence. */
export async function cancelFeedArticleProof(
  ctx: MutationCtx,
  before: Doc<"articles"> | null,
  after: Doc<"articles"> | null,
) {
  if (
    !before ||
    (after?.userId === before.userId && after.feedId === before.feedId)
  )
    return;
  const job = await ctx.db
    .query("feedArticleCleanup")
    .withIndex("by_articleId", (q) => q.eq("articleId", before._id))
    .unique();
  if (job?.phase !== "checking") return;
  await ctx.db.delete(job._id);
  await resumeFeedRemoval(ctx, job);
}

/** Compact rows only: safe before the existing vault pagination in the same
 * account metadata step. Never inserts or revives a cleanup claim. */
export async function purgeFeedArticleCleanup(
  ctx: MutationCtx,
  userId: string,
) {
  const jobs = await ctx.db
    .query("feedArticleCleanup")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(100);
  for (const job of jobs) await ctx.db.delete(job._id);
  return jobs.length;
}
