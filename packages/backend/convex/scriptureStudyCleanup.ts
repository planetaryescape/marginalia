import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { STUDY_LIMITS } from "./lib/scriptureStudy";

async function discardRun(ctx: MutationCtx, runId: Id<"scriptureStudyRuns">) {
  const answers = await ctx.db
    .query("scriptureStudyFollowUps")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .take(STUDY_LIMITS.cleanupBatch);
  for (const row of answers) await ctx.db.delete(row._id);
  if (answers.length === STUDY_LIMITS.cleanupBatch) return;
  const requests = await ctx.db
    .query("scriptureStudyRequests")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .take(STUDY_LIMITS.cleanupBatch);
  for (const row of requests) await ctx.db.delete(row._id);
  if (requests.length === STUDY_LIMITS.cleanupBatch) return;
  const findings = await ctx.db
    .query("scriptureStudyFindings")
    .withIndex("by_runId_and_order", (q) => q.eq("runId", runId))
    .take(STUDY_LIMITS.findings);
  for (const row of findings) await ctx.db.delete(row._id);
  const run = await ctx.db.get(runId);
  if (run) await ctx.db.delete(runId);
}
export const study = internalMutation({
  args: { studyId: v.id("scriptureStudies"), userId: v.string() },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.studyId)) return;
    const runs = await ctx.db
      .query("scriptureStudyRuns")
      .withIndex("by_studyId", (q) => q.eq("studyId", args.studyId))
      .take(1);
    for (const run of runs)
      if (run.userId === args.userId) await discardRun(ctx, run._id);
    if (runs.length)
      await ctx.scheduler.runAfter(
        0,
        internal.scriptureStudyCleanup.study,
        args,
      );
  },
});
export async function purgeStudyReader(ctx: MutationCtx, userId: string) {
  // One bounded run/result per transaction; deletion never multiplies large bodies.
  const runs = await ctx.db
    .query("scriptureStudyRuns")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(1);
  if (runs.length) {
    await discardRun(ctx, runs[0]._id);
    return 1;
  }
  const findings = await ctx.db
    .query("scriptureStudyFindings")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(STUDY_LIMITS.cleanupBatch);
  for (const row of findings) await ctx.db.delete(row._id);
  if (findings.length) return findings.length;
  const answers = await ctx.db
    .query("scriptureStudyFollowUps")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(STUDY_LIMITS.cleanupBatch);
  for (const row of answers) await ctx.db.delete(row._id);
  if (answers.length) return answers.length;
  const requests = await ctx.db
    .query("scriptureStudyRequests")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(STUDY_LIMITS.cleanupBatch);
  for (const row of requests) await ctx.db.delete(row._id);
  if (requests.length) return requests.length;
  const studies = await ctx.db
    .query("scriptureStudies")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(STUDY_LIMITS.cleanupBatch);
  for (const row of studies) await ctx.db.delete(row._id);
  if (studies.length) return studies.length;
  const budgets = await ctx.db
    .query("scriptureStudyBudgets")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(1);
  for (const row of budgets) await ctx.db.delete(row._id);
  return budgets.length;
}
export async function purgeStudyArticle(
  ctx: MutationCtx,
  userId: string,
  articleId: Id<"articles">,
) {
  const runs = await ctx.db
    .query("scriptureStudyRuns")
    .withIndex("by_userId_and_articleId", (q) =>
      q.eq("userId", userId).eq("articleId", articleId),
    )
    .take(1);
  if (runs.length) {
    await discardRun(ctx, runs[0]._id);
    return true;
  }
  const studies = await ctx.db
    .query("scriptureStudies")
    .withIndex("by_userId_and_articleId", (q) =>
      q.eq("userId", userId).eq("articleId", articleId),
    )
    .take(STUDY_LIMITS.cleanupBatch);
  for (const row of studies) await ctx.db.delete(row._id);
  return studies.length > 0;
}
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db
      .query("scriptureStudyRuns")
      .withIndex("by_purgeAt", (q) =>
        q.gt("purgeAt", 0).lte("purgeAt", Date.now()),
      )
      .take(1);
    for (const run of runs) {
      const study = await ctx.db.get(run.studyId);
      if (study?.publishedRunId === run._id) {
        await ctx.db.patch(run._id, { purgeAt: undefined });
        continue;
      }
      if (study?.activeRunId === run._id)
        await ctx.db.patch(study._id, { activeRunId: undefined });
      await discardRun(ctx, run._id);
      if (!(await ctx.db.get(run._id))) {
        const remaining = await ctx.db.get(run.studyId);
        if (remaining && !remaining.activeRunId && !remaining.publishedRunId) {
          const siblings = await ctx.db
            .query("scriptureStudyRuns")
            .withIndex("by_studyId", (q) => q.eq("studyId", run.studyId))
            .take(1);
          if (!siblings.length) await ctx.db.delete(remaining._id);
        }
      }
    }
    if (runs.length)
      await ctx.scheduler.runAfter(0, internal.scriptureStudyCleanup.sweep, {});
  },
});
