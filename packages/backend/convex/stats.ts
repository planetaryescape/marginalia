import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { ownedArticle } from "./access";
import { query } from "./functions";
import {
  bucketActiveMinutes,
  MIN_READ_MS,
  roomPeriod,
  skipsMostOf,
  splitReads,
} from "./lib/readingRoom";
import { dayKey, statsPeriod } from "./lib/statsPeriod";

const args = {
  timeZone: v.optional(v.string()),
  range: v.optional(
    v.union(v.literal("week"), v.literal("7days"), v.literal("30days")),
  ),
};
const LIMIT = 5000;
type PeriodArgs = { timeZone?: string; range?: "week" | "7days" | "30days" };
const finite = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;

function legacyReadings(events: Doc<"articleInteractions">[]) {
  const sessions = new Map<string, Doc<"articleInteractions">>();
  for (const event of events) {
    if (
      !["finished", "abandoned"].includes(event.action) ||
      (event.activeTimeMs === undefined && event.timeSpentMs === undefined)
    )
      continue;
    const key = event.sessionId
      ? `${event.articleId}:${event.sessionId}`
      : event._id;
    const old = sessions.get(key);
    if (!old) {
      sessions.set(key, event);
      continue;
    }
    const latest = old.createdAt > event.createdAt ? old : event;
    sessions.set(key, {
      ...latest,
      activeTimeMs: Math.max(
        finite(old.activeTimeMs),
        finite(event.activeTimeMs),
      ),
      maxScrollPercent: Math.max(
        finite(old.maxScrollPercent),
        finite(event.maxScrollPercent),
      ),
    });
  }
  return [...sessions.values()];
}

async function dashboard(ctx: QueryCtx, options: PeriodArgs, userId: string) {
  const period = statsPeriod(Date.now(), options.timeZone, options.range);
  const [activity, interactions, notes, reflections] = await Promise.all([
    ctx.db
      .query("readingActivity")
      .withIndex("by_user_started", (q) =>
        q
          .eq("userId", userId)
          .gte("startedAt", period.previousStart)
          .lt("startedAt", period.end),
      )
      .take(LIMIT + 1),
    ctx.db
      .query("articleInteractions")
      .withIndex("by_user_created", (q) =>
        q
          .eq("userId", userId)
          .gte("createdAt", period.previousStart)
          .lt("createdAt", period.end),
      )
      .take(LIMIT + 1),
    ctx.db
      .query("userNotes")
      .withIndex("by_user_created", (q) =>
        q
          .eq("userId", userId)
          .gte("createdAt", period.previousStart)
          .lt("createdAt", period.end),
      )
      .take(LIMIT + 1),
    ctx.db
      .query("reflections")
      .withIndex("by_user_responded", (q) =>
        q
          .eq("userId", userId)
          .gte("respondedAt", period.previousStart)
          .lt("respondedAt", period.end),
      )
      .take(LIMIT + 1),
  ]);
  const partial = [activity, interactions, notes, reflections].some(
    (rows) => rows.length > LIMIT,
  );
  const within = (at: number, start: number, end: number) =>
    at >= start && at < end;
  const legacySessions = legacyReadings(interactions);
  function metrics(start: number, end: number) {
    const measured = activity.filter((s) => within(s.startedAt, start, end));
    const events = interactions.filter((s) => within(s.createdAt, start, end));
    const legacy = legacySessions.filter((s) =>
      within(s.createdAt, start, end),
    );
    const finishes = new Set(
      events.filter((s) => s.action === "finished").map((s) => s.articleId),
    );
    const started = new Set([
      ...measured.filter((s) => s.activeTimeMs > 0).map((s) => s.articleId),
      ...events.filter((s) => s.action === "opened").map((s) => s.articleId),
      ...legacy.map((s) => s.articleId),
    ]);
    const annotationIds = new Set([
      ...measured.flatMap((s) => s.annotationsOpened),
      ...events.flatMap((s) => s.annotationsOpened ?? []),
    ]);
    const totalActiveTimeMs =
      measured.reduce((n, s) => n + s.activeTimeMs, 0) +
      legacy.reduce((n, s) => n + finite(s.activeTimeMs), 0);
    const visibleTimeMs = measured.reduce((n, s) => n + s.visibleTimeMs, 0);
    const measuredActiveTimeMs = measured.reduce(
      (n, s) => n + s.activeTimeMs,
      0,
    );
    const scrolls = measured
      .map((s) => s.maxScrollPercent)
      .concat(
        legacy.flatMap((s) =>
          s.maxScrollPercent === undefined
            ? []
            : [Math.min(100, finite(s.maxScrollPercent))],
        ),
      );
    const days = new Set(
      measured
        .filter((s) => s.activeTimeMs > 0)
        .map((s) => dayKey(s.startedAt, period.timeZone)),
    );
    for (const s of legacy)
      if (finite(s.activeTimeMs) > 0)
        days.add(dayKey(s.createdAt, period.timeZone));
    const periodNotes = notes.filter(
      (n) => within(n.createdAt, start, end) && n.contentPlain.trim(),
    );
    return {
      articlesFinished: finishes.size,
      articlesStarted: started.size,
      totalActiveTimeMs,
      visibleTimeMs,
      totalWallTimeMs: measured.reduce((n, s) => n + s.timeSpentMs, 0),
      avgScrollDepth: scrolls.length
        ? Math.round(scrolls.reduce((a, b) => a + b, 0) / scrolls.length)
        : null,
      annotationsOpenedCount: annotationIds.size,
      focusRatio: visibleTimeMs
        ? Math.round((measuredActiveTimeMs / visibleTimeMs) * 100)
        : null,
      notesTaken: periodNotes.length,
      reflectionsWritten:
        periodNotes.filter((n) => n.annotationId).length +
        reflections.filter(
          (r) =>
            within(r.respondedAt ?? 0, start, end) && r.userResponse?.trim(),
        ).length,
      readingDays: days.size,
      visitsCount: new Set(
        measured.filter((s) => s.activeTimeMs > 0).map((s) => s.visitId),
      ).size,
      skippedCount: events.filter((s) => s.action === "skipped").length,
      untrackedOpens: events.filter(
        (s) =>
          s.action === "opened" &&
          (!s.visitId || !measured.some((m) => m.visitId === s.visitId)),
      ).length,
      legacyReadings: legacy.length,
    };
  }
  const thisWeek = metrics(period.start, period.end);
  const lastWeek = metrics(period.previousStart, period.previousEnd);
  const weekActivity = activity.filter((s) => s.startedAt >= period.start);
  const weekEvents = interactions.filter((s) => s.createdAt >= period.start);
  const detailMap = new Map<
    Id<"articles">,
    {
      readAt: number;
      activeTimeMs: number;
      maxScrollPercent: number | null;
      finished: boolean;
      annotations: Set<string>;
    }
  >();
  function detail(articleId: Id<"articles">, at: number) {
    let d = detailMap.get(articleId);
    if (!d) {
      d = {
        readAt: at,
        activeTimeMs: 0,
        maxScrollPercent: null,
        finished: false,
        annotations: new Set(),
      };
      detailMap.set(articleId, d);
    }
    d.readAt = Math.max(d.readAt, at);
    return d;
  }
  for (const s of weekActivity) {
    const d = detail(s.articleId, s.updatedAt);
    d.activeTimeMs += s.activeTimeMs;
    d.maxScrollPercent = Math.max(d.maxScrollPercent ?? 0, s.maxScrollPercent);
    d.finished ||= s.finishedAt !== undefined;
    for (const id of s.annotationsOpened) d.annotations.add(id);
  }
  for (const s of weekEvents) {
    if (!["opened", "finished", "abandoned"].includes(s.action)) continue;
    const d = detail(s.articleId, s.createdAt);
    d.finished ||= s.action === "finished";
    if (s.maxScrollPercent !== undefined)
      d.maxScrollPercent = Math.max(
        d.maxScrollPercent ?? 0,
        Math.min(100, finite(s.maxScrollPercent)),
      );
    for (const id of s.annotationsOpened ?? []) d.annotations.add(id);
  }
  for (const s of legacySessions.filter((s) => s.createdAt >= period.start))
    detail(s.articleId, s.createdAt).activeTimeMs += finite(s.activeTimeMs);
  const articleDetails = (
    await Promise.all(
      [...detailMap.entries()]
        .sort((a, b) => b[1].readAt - a[1].readAt)
        .slice(0, 25)
        .map(async ([articleId, d]) => {
          const article = await ownedArticle(ctx, articleId, userId);
          if (!article) return null;
          return {
            articleId,
            title: article.title,
            author: article.author,
            readAt: d.readAt,
            activeTimeMs: d.activeTimeMs,
            maxScrollPercent: d.maxScrollPercent,
            finished: d.finished,
            annotationsOpened: d.annotations.size,
            notesCount: notes.filter(
              (n) =>
                n.articleId === articleId &&
                n.createdAt >= period.start &&
                n.contentPlain.trim(),
            ).length,
          };
        }),
    )
  ).filter((a) => a !== null);
  const daily = [];
  const todayKey = dayKey(period.end - 1, period.timeZone);
  const firstKey = dayKey(period.start, period.timeZone);
  for (
    let at = Date.parse(`${firstKey}T12:00:00Z`);
    at <= Date.parse(`${todayKey}T12:00:00Z`);
    at += 86_400_000
  ) {
    const date = new Date(at).toISOString().slice(0, 10);
    daily.push({
      date,
      activeTimeMs:
        weekActivity
          .filter((s) => dayKey(s.startedAt, period.timeZone) === date)
          .reduce((n, s) => n + s.activeTimeMs, 0) +
        legacySessions
          .filter(
            (s) =>
              s.createdAt >= period.start &&
              dayKey(s.createdAt, period.timeZone) === date,
          )
          .reduce((n, s) => n + finite(s.activeTimeMs), 0),
    });
  }
  const recentNotes = await Promise.all(
    notes
      .filter((n) => n.createdAt >= period.start && n.contentPlain.trim())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 3)
      .map(async (n) => ({
        articleId: n.articleId,
        selectedText: n.selectedText,
        contentPlain: n.contentPlain,
        createdAt: n.createdAt,
        articleTitle:
          (await ownedArticle(ctx, n.articleId, userId))?.title ??
          "Unavailable article",
      })),
  );
  return {
    period,
    thisWeek,
    lastWeek,
    daily,
    articles: articleDetails,
    recentNotes,
    partial,
    engagementScore: null,
  };
}

export const getDashboard = query({
  args,
  handler: (ctx, options) => dashboard(ctx, options, ctx.readerId),
});
// Compatibility for already-loaded older clients. New UI uses one coherent query.
export const getDashboardOverview = query({
  args,
  handler: (ctx, options) => dashboard(ctx, options, ctx.readerId),
});
export const getArticleDetails = query({
  args,
  handler: async (ctx, options) =>
    (await dashboard(ctx, options, ctx.readerId)).articles,
});
export const getRecentNotes = query({
  args,
  handler: async (ctx, options) =>
    (await dashboard(ctx, options, ctx.readerId)).recentNotes,
});
export const getReadingPatterns = query({
  args,
  handler: async (ctx, options) => {
    const data = await dashboard(ctx, options, ctx.readerId);
    return {
      daily: data.daily,
      hourlyHeatmap: [],
      sessionDurations: [],
      scrollDepthDistribution: {
        bucket0to20: 0,
        bucket20to40: 0,
        bucket40to60: 0,
        bucket60to80: 0,
        bucket80to100: 0,
      },
      annotationsByType: {},
    };
  },
});
export const getWeeklyStats = query({
  args,
  handler: async (ctx, options) => {
    const { thisWeek: s } = await dashboard(ctx, options, ctx.readerId);
    return {
      articlesReadCount: s.articlesFinished,
      totalActiveTimeMinutes: Math.round(s.totalActiveTimeMs / 60000),
      avgScrollDepth: s.avgScrollDepth,
      annotationsOpenedCount: s.annotationsOpenedCount,
    };
  },
});

const roomArgs = {
  timeZone: v.string(),
  period: v.union(v.literal("month"), v.literal("30days"), v.literal("90days")),
};
// Visits read for the room, newest first. At roughly 1 KB a row this stays
// well under Convex's per-function read limit; past it the room says so.
const ROOM_VISITS = 4000;
// Articles whose length is looked up. Convex reads a whole document, body and
// embedding included, so this is the budget that matters. A copy of
// `estimatedReadMinutes` on each readingActivity row would remove it.
const ROOM_ARTICLES = 120;
const ARTICLE_BATCH = 20;
const ROOM_FEEDS = 200;
const FEEDS_SHOWN = 30;

/**
 * The numbers behind Your reading: when the reader read, how long their reads
 * were, and how each feed served them. Aggregated here so the client never
 * receives visit rows. Hours are the reader's local hours in `timeZone`; a
 * visit counts toward the hour it started in.
 */
export const readingRoom = query({
  args: roomArgs,
  handler: async (ctx, { timeZone, period: periodName }) => {
    const period = roomPeriod(Date.now(), timeZone, periodName);
    const visits = await ctx.db
      .query("readingActivity")
      .withIndex("by_user_started", (q) =>
        q
          .eq("userId", ctx.readerId)
          .gte("startedAt", period.start)
          .lt("startedAt", period.end),
      )
      .order("desc")
      .take(ROOM_VISITS + 1);
    const partial = visits.length > ROOM_VISITS;
    const rows = visits.slice(0, ROOM_VISITS);

    // `day` is the reader's local day as the client recorded it
    const readingDays = new Set(
      rows.filter((r) => r.activeTimeMs > 0).map((r) => r.day),
    ).size;
    const perArticle = new Map<
      Id<"articles">,
      { activeTimeMs: number; startedAt: number }
    >();
    for (const row of rows) {
      const seen = perArticle.get(row.articleId);
      perArticle.set(row.articleId, {
        activeTimeMs: (seen?.activeTimeMs ?? 0) + row.activeTimeMs,
        // Rows are newest first, so the last one seen is the first visit
        startedAt: row.startedAt,
      });
    }
    const reads = [...perArticle.entries()].filter(
      ([, a]) => a.activeTimeMs >= MIN_READ_MS,
    );
    const looked = reads.slice(0, ROOM_ARTICLES);
    const minutes = new Map<Id<"articles">, number | undefined>();
    for (let i = 0; i < looked.length; i += ARTICLE_BATCH)
      await Promise.all(
        looked.slice(i, i + ARTICLE_BATCH).map(async ([id]) => {
          const article = await ownedArticle(ctx, id, ctx.readerId);
          if (article) minutes.set(id, article.estimatedReadMinutes);
        }),
      );
    const split = splitReads(
      looked.map(([id, a]) => ({
        startedAt: a.startedAt,
        estimatedReadMinutes: minutes.get(id),
      })),
      timeZone,
    );

    const counted = await ctx.db
      .query("feedStats")
      .withIndex("by_user_feed", (q) => q.eq("userId", ctx.readerId))
      .take(ROOM_FEEDS);
    const feeds = (
      await Promise.all(
        counted
          .filter((f) => f.offered > 0)
          .sort((a, b) => b.offered - a.offered)
          .slice(0, FEEDS_SHOWN)
          .map(async (f) => {
            const feed = await ctx.db.get("feeds", f.feedId);
            if (feed?.userId !== ctx.readerId) return null;
            return {
              feedId: f.feedId,
              title: feed.title,
              offered: f.offered,
              opened: f.opened,
              finished: f.finished,
              skipsMost: skipsMostOf(f.offered, f.opened),
            };
          }),
      )
    ).filter((f) => f !== null);

    return {
      period,
      partial,
      readsPartial: reads.length > ROOM_ARTICLES,
      activeTimeMs: rows.reduce((n, r) => n + r.activeTimeMs, 0),
      readingDays,
      heat: bucketActiveMinutes(rows, timeZone),
      ...split,
      // Offer counts have no dates, so they cover the feed's whole history
      feeds,
    };
  },
});

/**
 * Topics the reader returns to, by minutes read. Tags arrive with the tags
 * tables (`tags`, `articleTags`); until they exist no article has a topic and
 * the room hides the block. The tags change will fill this from `articleTags`
 * joined to the reader's `readingActivity` for the period, keeping the shape
 * `{ name, minutes, articles }[]`.
 */
export const readingTopics = query({
  args: roomArgs,
  handler: async (): Promise<
    { name: string; minutes: number; articles: number }[]
  > => [],
});
