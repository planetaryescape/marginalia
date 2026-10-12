import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx, mutation } from "./functions";
import {
  type ReadingCheckpoint,
  readingCheckpointSchema,
} from "./lib/readingActivity";
import { updateQueueStats } from "./readingQueue";

const args = {
  articleId: v.string(),
  sessionId: v.optional(v.string()),
  visitId: v.string(),
  day: v.string(),
  startedAt: v.number(),
  updatedAt: v.number(),
  activeTimeMs: v.number(),
  visibleTimeMs: v.number(),
  timeSpentMs: v.number(),
  maxScrollPercent: v.number(),
  annotationsOpened: v.array(v.string()),
  finished: v.optional(v.boolean()),
};

async function saveCheckpoint(
  ctx: MutationCtx,
  input: ReadingCheckpoint,
  userId: string,
) {
  const s = readingCheckpointSchema.parse(input);
  const now = Date.now();
  if (s.updatedAt > now + 60_000 || s.updatedAt < s.startedAt)
    throw new Error("Check your device clock and try again.");
  const articleId = ctx.db.normalizeId("articles", s.articleId);
  const article = articleId ? await ctx.db.get(articleId) : null;
  if (!article || article.userId !== userId)
    throw new Error("Article not found");
  const sessionId = s.sessionId
    ? ctx.db.normalizeId("sessions", s.sessionId)
    : null;
  if (s.sessionId && !sessionId) throw new Error("Invalid session");
  const session = sessionId ? await ctx.db.get(sessionId) : null;
  if (sessionId && (!session || session.userId !== userId))
    throw new Error("Session not found");
  if (session?.articleId && session.articleId !== article._id)
    throw new Error("Session belongs to another article");
  const old = await ctx.db
    .query("readingActivity")
    .withIndex("by_user_visit_day", (q) =>
      q.eq("userId", userId).eq("visitId", s.visitId).eq("day", s.day),
    )
    .unique();
  if (old && (old.articleId !== article._id || old.startedAt !== s.startedAt))
    throw new Error("This reading visit belongs to another article or day.");
  if (!old) {
    const previousDay = await ctx.db
      .query("readingActivity")
      .withIndex("by_user_visit_day", (q) =>
        q.eq("userId", userId).eq("visitId", s.visitId),
      )
      .first();
    if (
      previousDay &&
      (previousDay.articleId !== article._id ||
        previousDay.sessionId !== (sessionId ?? undefined))
    )
      throw new Error(
        "This reading visit belongs to another article or session.",
      );
    if (!previousDay)
      await ctx.db.insert("articleInteractions", {
        userId: userId,
        articleId: article._id,
        sessionId: sessionId ?? undefined,
        visitId: s.visitId,
        action: "opened",
        createdAt: s.startedAt,
      });
  }
  const activeTimeMs = Math.max(old?.activeTimeMs ?? 0, s.activeTimeMs);
  const visibleTimeMs = Math.max(old?.visibleTimeMs ?? 0, s.visibleTimeMs);
  const annotationsOpened = [
    ...new Set([...(old?.annotationsOpened ?? []), ...s.annotationsOpened]),
  ].slice(0, 128);
  const finishing = Boolean(s.finished && !old?.finishedAt);
  const data = {
    userId: userId,
    articleId: article._id,
    sessionId: sessionId ?? undefined,
    visitId: s.visitId,
    day: s.day,
    startedAt: s.startedAt,
    updatedAt: Math.max(old?.updatedAt ?? 0, s.updatedAt),
    activeTimeMs,
    visibleTimeMs,
    timeSpentMs: Math.max(old?.timeSpentMs ?? 0, s.timeSpentMs),
    maxScrollPercent: Math.max(old?.maxScrollPercent ?? 0, s.maxScrollPercent),
    annotationsOpened,
    finishedAt: old?.finishedAt ?? (finishing ? s.updatedAt : undefined),
  };
  if (old) await ctx.db.patch(old._id, data);
  else await ctx.db.insert("readingActivity", data);
  if (session)
    await ctx.db.patch(session._id, {
      timeSpentMs:
        (session.timeSpentMs ?? 0) + activeTimeMs - (old?.activeTimeMs ?? 0),
      scrollPercentage: Math.max(
        session.scrollPercentage ?? 0,
        data.maxScrollPercent,
      ),
      ...(finishing
        ? { readingStatus: "completed" as const, endedAt: now }
        : {}),
    });
  if (finishing) {
    // Keep existing reading history and queue semantics, but exclude these
    // marker-only interactions from measured time in statistics.
    await ctx.db.insert("articleInteractions", {
      userId: userId,
      articleId: article._id,
      sessionId: sessionId ?? undefined,
      action: "finished",
      visitId: s.visitId,
      createdAt: s.updatedAt,
    });
    if (article.finishedAt === undefined) {
      await ctx.db.patch(article._id, { finishedAt: s.updatedAt });
      const after = await ctx.db.get(article._id);
      if (after) await updateQueueStats(ctx, article, after);
      await ctx.scheduler.runAfter(
        0,
        internal.actions.readwiseSync.archiveArticle,
        { userId, articleId: article._id },
      );
    }
  }
  return null;
}

export const checkpoint = mutation({
  args,
  handler: (ctx, input) => saveCheckpoint(ctx, input, ctx.readerId),
});
export const record = internalMutation({
  args: { ...args, userId: v.string() },
  handler: (ctx, { userId, ...input }) => saveCheckpoint(ctx, input, userId),
});
