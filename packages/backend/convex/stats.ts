import { query } from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Helper: partition interactions into this week and last week
function partitionByWeek(
  interactions: any[],
  now: number,
) {
  const weekAgo = now - WEEK_MS;
  const twoWeeksAgo = now - 2 * WEEK_MS;
  return {
    thisWeek: interactions.filter((i) => i.createdAt >= weekAgo),
    lastWeek: interactions.filter(
      (i) => i.createdAt >= twoWeeksAgo && i.createdAt < weekAgo,
    ),
  };
}

function computeWeekMetrics(interactions: any[]) {
  const finished = interactions.filter((i) => i.action === "finished");
  const finishedOrAbandoned = interactions.filter(
    (i) => i.action === "finished" || i.action === "abandoned",
  );

  const articlesFinished = new Set(finished.map((i) => i.articleId)).size;

  const totalActiveTimeMs = finishedOrAbandoned.reduce(
    (sum, i) => sum + (i.activeTimeMs ?? i.timeSpentMs ?? 0),
    0,
  );

  const totalWallTimeMs = finishedOrAbandoned.reduce(
    (sum, i) => sum + (i.timeSpentMs ?? i.activeTimeMs ?? 0),
    0,
  );

  const scrollDepths = finishedOrAbandoned
    .filter((i) => i.maxScrollPercent != null)
    .map((i) => i.maxScrollPercent!);
  const avgScrollDepth =
    scrollDepths.length > 0
      ? Math.round(scrollDepths.reduce((a: number, b: number) => a + b, 0) / scrollDepths.length)
      : 0;

  const annotationsOpened = interactions.flatMap(
    (i) => i.annotationsOpened ?? [],
  );

  const focusRatio =
    totalWallTimeMs > 0
      ? Math.round((totalActiveTimeMs / totalWallTimeMs) * 100)
      : 0;

  const skippedCount = interactions.filter((i) => i.action === "skipped").length;

  return {
    articlesFinished,
    totalActiveTimeMs,
    totalWallTimeMs,
    avgScrollDepth,
    annotationsOpenedCount: annotationsOpened.length,
    focusRatio,
    skippedCount,
  };
}

// ─── Query 1: Dashboard Overview ─────────────────────────────

export const getDashboardOverview = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const weekAgo = now - WEEK_MS;

    const allInteractions = await ctx.db
      .query("articleInteractions")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(1000);

    const { thisWeek, lastWeek } = partitionByWeek(allInteractions, now);
    const tw = computeWeekMetrics(thisWeek);
    const lw = computeWeekMetrics(lastWeek);

    // Notes this week
    const allNotes = await ctx.db
      .query("userNotes")
      .withIndex("by_user_recent", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(200);
    const twNotes = allNotes.filter((n) => n.createdAt >= weekAgo).length;
    const lwNotes = allNotes.filter(
      (n) => n.createdAt >= now - 2 * WEEK_MS && n.createdAt < weekAgo,
    ).length;

    // Reflections this week
    const allReflections = await ctx.db
      .query("reflections")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(200);
    const twReflections = allReflections.filter(
      (r) => r.createdAt >= weekAgo && r.userResponse,
    ).length;
    const lwReflections = allReflections.filter(
      (r) =>
        r.createdAt >= now - 2 * WEEK_MS &&
        r.createdAt < weekAgo &&
        r.userResponse,
    ).length;

    // Sessions this week
    const allSessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(200);
    const twSessions = allSessions.filter((s) => s.startedAt >= weekAgo).length;

    // Loved articles total
    const loved = await ctx.db
      .query("lovedArticles")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .collect();

    // Engagement score: weighted composite
    const annotationRate =
      tw.annotationsOpenedCount > 0 ? Math.min(100, tw.annotationsOpenedCount * 10) : 0;
    const engagementScore = Math.round(
      0.4 * tw.avgScrollDepth + 0.3 * tw.focusRatio + 0.3 * annotationRate,
    );

    return {
      thisWeek: {
        ...tw,
        notesTaken: twNotes,
        reflectionsWritten: twReflections,
        sessionsCount: twSessions,
        lovedTotal: loved.length,
      },
      lastWeek: {
        ...lw,
        notesTaken: lwNotes,
        reflectionsWritten: lwReflections,
      },
      engagementScore,
    };
  },
});

// ─── Query 2: Reading Patterns ───────────────────────────────

function getTimeBlock(hour: number): number {
  if (hour >= 6 && hour < 12) return 0; // morning
  if (hour >= 12 && hour < 17) return 1; // afternoon
  if (hour >= 17 && hour < 22) return 2; // evening
  return 3; // night
}

export const getReadingPatterns = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const weekAgo = now - WEEK_MS;

    const allInteractions = await ctx.db
      .query("articleInteractions")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(500);

    const thisWeek = allInteractions.filter((i) => i.createdAt >= weekAgo);

    // Heatmap: day x time block
    const heatmap: Array<{ dayOfWeek: number; timeBlock: number; count: number }> = [];
    const heatmapMap = new Map<string, number>();

    for (const i of thisWeek) {
      if (i.action !== "opened" && i.action !== "finished") continue;
      const d = new Date(i.createdAt);
      const key = `${d.getDay()}-${getTimeBlock(d.getHours())}`;
      heatmapMap.set(key, (heatmapMap.get(key) ?? 0) + 1);
    }

    for (let day = 0; day < 7; day++) {
      for (let block = 0; block < 4; block++) {
        heatmap.push({
          dayOfWeek: day,
          timeBlock: block,
          count: heatmapMap.get(`${day}-${block}`) ?? 0,
        });
      }
    }

    // Session durations
    const allSessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(200);
    const weekSessions = allSessions.filter((s) => s.startedAt >= weekAgo);

    const durationGroups = new Map<number, { count: number; totalActual: number }>();
    for (const s of weekSessions) {
      const req = s.requestedMinutes;
      const group = durationGroups.get(req) ?? { count: 0, totalActual: 0 };
      group.count++;
      if (s.endedAt) {
        group.totalActual += (s.endedAt - s.startedAt) / 60000;
      }
      durationGroups.set(req, group);
    }

    const sessionDurations = [...durationGroups.entries()].map(
      ([requestedMinutes, g]) => ({
        requestedMinutes,
        count: g.count,
        avgActualMinutes: g.count > 0 ? Math.round(g.totalActual / g.count) : 0,
      }),
    );

    // Scroll depth distribution
    const finishedOrAbandoned = thisWeek.filter(
      (i) => i.action === "finished" || i.action === "abandoned",
    );
    const scrollBuckets = [0, 0, 0, 0, 0];
    for (const i of finishedOrAbandoned) {
      const pct = i.maxScrollPercent ?? 0;
      const bucket = Math.min(4, Math.floor(pct / 20));
      scrollBuckets[bucket]++;
    }

    // Annotations by type
    const finishedArticleIds = new Set(
      thisWeek.filter((i) => i.action === "finished").map((i) => i.articleId),
    );
    const annotationsByType: Record<string, { viewed: number; total: number }> = {
      cross_reference: { viewed: 0, total: 0 },
      context: { viewed: 0, total: 0 },
      tension: { viewed: 0, total: 0 },
      question: { viewed: 0, total: 0 },
    };

    for (const articleId of finishedArticleIds) {
      const annotations = await ctx.db
        .query("annotations")
        .withIndex("by_article", (q) => q.eq("articleId", articleId))
        .collect();
      for (const ann of annotations) {
        const t = annotationsByType[ann.type];
        if (t) {
          t.total++;
          if (ann.wasViewed) t.viewed++;
        }
      }
    }

    return {
      hourlyHeatmap: heatmap,
      sessionDurations,
      scrollDepthDistribution: {
        bucket0to20: scrollBuckets[0],
        bucket20to40: scrollBuckets[1],
        bucket40to60: scrollBuckets[2],
        bucket60to80: scrollBuckets[3],
        bucket80to100: scrollBuckets[4],
      },
      annotationsByType,
    };
  },
});

// ─── Query 3: Article Details ────────────────────────────────

export const getArticleDetails = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const weekAgo = now - WEEK_MS;

    const allInteractions = await ctx.db
      .query("articleInteractions")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(500);

    const finished = allInteractions
      .filter((i) => i.action === "finished" && i.createdAt >= weekAgo)
      .slice(0, 15);

    const results = await Promise.all(
      finished.map(async (i) => {
        const article = await ctx.db.get(i.articleId);
        if (!article) return null;

        const annotations = await ctx.db
          .query("annotations")
          .withIndex("by_article", (q) => q.eq("articleId", i.articleId))
          .collect();

        const notes = await ctx.db
          .query("userNotes")
          .withIndex("by_article", (q) => q.eq("articleId", i.articleId))
          .collect();

        const reflection = await ctx.db
          .query("reflections")
          .withIndex("by_article", (q) => q.eq("articleId", i.articleId))
          .first();

        const loved = await ctx.db
          .query("lovedArticles")
          .withIndex("by_user_article", (q) =>
            q.eq("userId", DEFAULT_USER_ID).eq("articleId", i.articleId),
          )
          .first();

        return {
          articleId: i.articleId,
          title: article.title,
          author: article.author,
          estimatedReadMinutes: article.estimatedReadMinutes,
          readAt: i.createdAt,
          activeTimeMs: i.activeTimeMs ?? i.timeSpentMs ?? 0,
          wallTimeMs: i.timeSpentMs ?? i.activeTimeMs ?? 0,
          maxScrollPercent: i.maxScrollPercent ?? 0,
          annotationsOpened: (i.annotationsOpened ?? []).length,
          annotationsTotal: annotations.length,
          tabHiddenCount: i.tabHiddenCount ?? 0,
          notesCount: notes.length,
          hasReflection: !!reflection?.userResponse,
          isLoved: !!loved,
        };
      }),
    );

    return results.filter(Boolean);
  },
});

// ─── Query 4: Recent Notes ──────────────────────────────────

export const getRecentNotes = query({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db
      .query("userNotes")
      .withIndex("by_user_recent", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(3);

    return Promise.all(
      notes.map(async (n) => {
        const article = await ctx.db.get(n.articleId);
        return {
          selectedText: n.selectedText,
          contentPlain: n.contentPlain,
          articleId: n.articleId,
          articleTitle: article?.title ?? "Unknown",
          createdAt: n.createdAt,
        };
      }),
    );
  },
});

// Keep old query for backward compat (can remove later)
export const getWeeklyStats = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const weekAgo = now - WEEK_MS;
    const allInteractions = await ctx.db
      .query("articleInteractions")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(500);
    const weekInteractions = allInteractions.filter((i) => i.createdAt >= weekAgo);
    const tw = computeWeekMetrics(weekInteractions);
    return {
      articlesReadCount: tw.articlesFinished,
      totalActiveTimeMinutes: Math.round(tw.totalActiveTimeMs / 60000),
      avgScrollDepth: tw.avgScrollDepth,
      annotationsOpenedCount: tw.annotationsOpenedCount,
    };
  },
});
