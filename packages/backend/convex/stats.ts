import { query } from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const getWeeklyStats = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const weekAgo = now - WEEK_MS;

    // Get this week's interactions
    const allInteractions = await ctx.db
      .query("articleInteractions")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(500);

    const weekInteractions = allInteractions.filter(
      (i) => i.createdAt >= weekAgo,
    );

    // Articles read (finished)
    const finishedIds = new Set(
      weekInteractions
        .filter((i) => i.action === "finished")
        .map((i) => i.articleId),
    );

    const articlesRead = await Promise.all(
      [...finishedIds].map(async (id) => {
        const article = await ctx.db.get(id);
        return article
          ? { title: article.title, author: article.author, readMinutes: article.estimatedReadMinutes }
          : null;
      }),
    );

    // Total active reading time
    const totalActiveTimeMs = weekInteractions
      .filter((i) => i.action === "finished" || i.action === "abandoned")
      .reduce((sum, i) => sum + (i.activeTimeMs ?? i.timeSpentMs ?? 0), 0);

    // Average scroll depth
    const scrollDepths = weekInteractions
      .filter(
        (i) =>
          (i.action === "finished" || i.action === "abandoned") &&
          i.maxScrollPercent != null,
      )
      .map((i) => i.maxScrollPercent!);
    const avgScrollDepth =
      scrollDepths.length > 0
        ? Math.round(
            scrollDepths.reduce((a, b) => a + b, 0) / scrollDepths.length,
          )
        : 0;

    // Annotations opened
    const allAnnotationsOpened = weekInteractions.flatMap(
      (i) => i.annotationsOpened ?? [],
    );

    // Articles skipped
    const skippedCount = weekInteractions.filter(
      (i) => i.action === "skipped",
    ).length;

    // Notes taken this week
    const allNotes = await ctx.db
      .query("userNotes")
      .withIndex("by_user_recent", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(100);
    const weekNotes = allNotes.filter((n) => n.createdAt >= weekAgo);

    // Reflections responded to
    const allReflections = await ctx.db
      .query("reflections")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(100);
    const weekReflections = allReflections.filter(
      (r) => r.createdAt >= weekAgo && r.userResponse,
    );

    // Preferred read time (from sessions)
    const allSessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(100);
    const weekSessions = allSessions.filter((s) => s.startedAt >= weekAgo);
    const requestedMinutes = weekSessions.map((s) => s.requestedMinutes);
    const preferredTime =
      requestedMinutes.length > 0
        ? Math.round(
            requestedMinutes.reduce((a, b) => a + b, 0) /
              requestedMinutes.length,
          )
        : null;

    return {
      articlesReadCount: finishedIds.size,
      articlesRead: articlesRead.filter(Boolean),
      totalActiveTimeMinutes: Math.round(totalActiveTimeMs / 60000),
      avgScrollDepth,
      annotationsOpenedCount: allAnnotationsOpened.length,
      articlesSkipped: skippedCount,
      notesTaken: weekNotes.length,
      reflectionsResponded: weekReflections.length,
      sessionsStarted: weekSessions.length,
      preferredReadTime: preferredTime,
    };
  },
});
