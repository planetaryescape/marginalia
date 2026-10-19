import { getDocumentSize, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { ownedArticleCard } from "./access";
import { query } from "./functions";
import { limitLegacyReadBytes } from "./lib/articleMetadata";
import {
  currentReportingReady,
  currentVisitQuery,
} from "./lib/currentReporting";
import { reportingFeedTitles } from "./lib/feedStatus";
import {
  type ReportingNote,
  type ReportingReflection,
  reportingArticleCard,
  reportingNoteSource,
  reportingNotes,
  reportingReflections,
  takeReportingRows,
} from "./lib/legacyReporting";
import {
  bucketActiveMinutes,
  localDayKeyer,
  MIN_READ_MS,
  type RoomPeriod,
  roomPeriod,
  skipsMostOf,
  splitReads,
} from "./lib/readingRoom";
import { reportingTags } from "./lib/reportingTags";
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

type LegacyPeriod = ReturnType<typeof statsPeriod>;

// Keep the previous-period window and the 5,001st row even for small reports:
// changing either would change which records a capped retained client counts.
async function legacyVisits(
  ctx: QueryCtx,
  period: LegacyPeriod,
  userId: string,
) {
  const [activity, interactions] = await Promise.all([
    takeReportingRows(
      ctx,
      ctx.db
        .query("readingActivity")
        .withIndex("by_user_started", (q) =>
          q
            .eq("userId", userId)
            .gte("startedAt", period.previousStart)
            .lt("startedAt", period.end),
        ),
      LIMIT + 1,
    ),
    takeReportingRows(
      ctx,
      ctx.db
        .query("articleInteractions")
        .withIndex("by_user_created", (q) =>
          q
            .eq("userId", userId)
            .gte("createdAt", period.previousStart)
            .lt("createdAt", period.end),
        ),
      LIMIT + 1,
    ),
  ]);
  return {
    activity,
    interactions,
    legacySessions: legacyReadings(interactions),
  };
}

function legacyNotes(ctx: QueryCtx, period: LegacyPeriod, userId: string) {
  return reportingNotes(ctx, period, userId, LIMIT + 1);
}

function legacyReflections(
  ctx: QueryCtx,
  period: LegacyPeriod,
  userId: string,
) {
  return reportingReflections(ctx, period, userId, LIMIT + 1);
}

type LegacyVisits = Awaited<ReturnType<typeof legacyVisits>>;

function legacyReadingTotals(
  measured: Doc<"readingActivity">[],
  events: Doc<"articleInteractions">[],
  legacy: Doc<"articleInteractions">[],
) {
  const finishes = new Set(
    events.filter((s) => s.action === "finished").map((s) => s.articleId),
  );
  const annotationIds = new Set([
    ...measured.flatMap((s) => s.annotationsOpened),
    ...events.flatMap((s) => s.annotationsOpened ?? []),
  ]);
  const scrolls = measured
    .map((s) => s.maxScrollPercent)
    .concat(
      legacy.flatMap((s) =>
        s.maxScrollPercent === undefined
          ? []
          : [Math.min(100, finite(s.maxScrollPercent))],
      ),
    );
  return {
    articlesFinished: finishes.size,
    totalActiveTimeMs:
      measured.reduce((n, s) => n + s.activeTimeMs, 0) +
      legacy.reduce((n, s) => n + finite(s.activeTimeMs), 0),
    avgScrollDepth: scrolls.length
      ? Math.round(scrolls.reduce((a, b) => a + b, 0) / scrolls.length)
      : null,
    annotationsOpenedCount: annotationIds.size,
  };
}

function legacyMetrics(
  { activity, interactions, legacySessions }: LegacyVisits,
  notes: ReportingNote[],
  reflections: ReportingReflection[],
  period: LegacyPeriod,
  start: number,
  end: number,
) {
  const within = (at: number, start: number, end: number) =>
    at >= start && at < end;
  const measured = activity.filter((s) => within(s.startedAt, start, end));
  const measuredVisits = new Set(measured.map((s) => s.visitId));
  const events = interactions.filter((s) => within(s.createdAt, start, end));
  const legacy = legacySessions.filter((s) => within(s.createdAt, start, end));
  const started = new Set([
    ...measured.filter((s) => s.activeTimeMs > 0).map((s) => s.articleId),
    ...events.filter((s) => s.action === "opened").map((s) => s.articleId),
    ...legacy.map((s) => s.articleId),
  ]);
  const visibleTimeMs = measured.reduce((n, s) => n + s.visibleTimeMs, 0);
  const measuredActiveTimeMs = measured.reduce((n, s) => n + s.activeTimeMs, 0);
  const days = new Set(
    measured
      .filter((s) => s.activeTimeMs > 0)
      .map((s) => dayKey(s.startedAt, period.timeZone)),
  );
  for (const s of legacy)
    if (finite(s.activeTimeMs) > 0)
      days.add(dayKey(s.createdAt, period.timeZone));
  const periodNotes = notes.filter(
    (n) => within(n.createdAt, start, end) && n.nonblank,
  );
  return {
    ...legacyReadingTotals(measured, events, legacy),
    articlesStarted: started.size,
    visibleTimeMs,
    totalWallTimeMs: measured.reduce((n, s) => n + s.timeSpentMs, 0),
    focusRatio: visibleTimeMs
      ? Math.round((measuredActiveTimeMs / visibleTimeMs) * 100)
      : null,
    notesTaken: periodNotes.length,
    reflectionsWritten:
      periodNotes.filter((n) => n.annotationId).length +
      reflections.filter(
        (r) => within(r.respondedAt ?? 0, start, end) && r.nonblank,
      ).length,
    readingDays: days.size,
    visitsCount: new Set(
      measured.filter((s) => s.activeTimeMs > 0).map((s) => s.visitId),
    ).size,
    skippedCount: events.filter((s) => s.action === "skipped").length,
    untrackedOpens: events.filter(
      (s) =>
        s.action === "opened" && (!s.visitId || !measuredVisits.has(s.visitId)),
    ).length,
    legacyReadings: legacy.length,
  };
}

async function legacyArticleDetails(
  ctx: QueryCtx,
  { activity, interactions, legacySessions }: LegacyVisits,
  notes: ReportingNote[],
  period: LegacyPeriod,
  userId: string,
) {
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
  const noteCounts = new Map<Id<"articles">, number>();
  for (const note of notes) {
    if (note.createdAt >= period.start && note.nonblank)
      noteCounts.set(note.articleId, (noteCounts.get(note.articleId) ?? 0) + 1);
  }
  return (
    await Promise.all(
      [...detailMap.entries()]
        .sort((a, b) => b[1].readAt - a[1].readAt)
        .slice(0, 25)
        .map(async ([articleId, d]) => {
          const article = await reportingArticleCard(ctx, articleId, userId);
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
            notesCount: noteCounts.get(articleId) ?? 0,
          };
        }),
    )
  ).filter((a) => a !== null);
}

function legacyDaily(
  { activity, legacySessions }: LegacyVisits,
  period: LegacyPeriod,
) {
  const measuredTotals = new Map<string, number>();
  const legacyTotals = new Map<string, number>();
  for (const s of activity) {
    if (s.startedAt < period.start) continue;
    const date = dayKey(s.startedAt, period.timeZone);
    measuredTotals.set(date, (measuredTotals.get(date) ?? 0) + s.activeTimeMs);
  }
  for (const s of legacySessions) {
    if (s.createdAt < period.start) continue;
    const date = dayKey(s.createdAt, period.timeZone);
    legacyTotals.set(
      date,
      (legacyTotals.get(date) ?? 0) + finite(s.activeTimeMs),
    );
  }
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
        (measuredTotals.get(date) ?? 0) + (legacyTotals.get(date) ?? 0),
    });
  }
  return daily;
}

function legacyRecentNotes(
  ctx: QueryCtx,
  notes: ReportingNote[],
  period: LegacyPeriod,
  userId: string,
) {
  return Promise.all(
    notes
      .filter((n) => n.createdAt >= period.start && n.nonblank)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 3)
      .map(async (note) => {
        const n = await reportingNoteSource(ctx, note, userId);
        return {
          articleId: n.articleId,
          selectedText: n.selectedText,
          contentPlain: n.contentPlain,
          createdAt: n.createdAt,
          articleTitle:
            (await reportingArticleCard(ctx, n.articleId, userId))?.title ??
            "Unavailable article",
        };
      }),
  );
}

async function dashboard(ctx: QueryCtx, options: PeriodArgs, userId: string) {
  const period = statsPeriod(Date.now(), options.timeZone, options.range);
  const [visits, notes, reflections] = await Promise.all([
    legacyVisits(ctx, period, userId),
    legacyNotes(ctx, period, userId),
    legacyReflections(ctx, period, userId),
  ]);
  const [articleDetails, recentNotes] = await Promise.all([
    legacyArticleDetails(ctx, visits, notes, period, userId),
    legacyRecentNotes(ctx, notes, period, userId),
  ]);
  return {
    period,
    thisWeek: legacyMetrics(
      visits,
      notes,
      reflections,
      period,
      period.start,
      period.end,
    ),
    lastWeek: legacyMetrics(
      visits,
      notes,
      reflections,
      period,
      period.previousStart,
      period.previousEnd,
    ),
    daily: legacyDaily(visits, period),
    articles: articleDetails,
    recentNotes,
    partial: [visits.activity, visits.interactions, notes, reflections].some(
      (rows) => rows.length > LIMIT,
    ),
    engagementScore: null,
  };
}

export const getDashboard = query({
  args,
  handler: (ctx, options) => dashboard(ctx, options, ctx.readerId),
});
// Compatibility for already-loaded older clients; current Stats uses room queries.
export const getDashboardOverview = query({
  args,
  handler: (ctx, options) => dashboard(ctx, options, ctx.readerId),
});
export const getArticleDetails = query({
  args,
  handler: async (ctx, options) => {
    const period = statsPeriod(Date.now(), options.timeZone, options.range);
    const [visits, notes] = await Promise.all([
      legacyVisits(ctx, period, ctx.readerId),
      legacyNotes(ctx, period, ctx.readerId),
    ]);
    return legacyArticleDetails(ctx, visits, notes, period, ctx.readerId);
  },
});
export const getRecentNotes = query({
  args,
  handler: async (ctx, options) => {
    const period = statsPeriod(Date.now(), options.timeZone, options.range);
    return legacyRecentNotes(
      ctx,
      await legacyNotes(ctx, period, ctx.readerId),
      period,
      ctx.readerId,
    );
  },
});
export const getReadingPatterns = query({
  args,
  handler: async (ctx, options) => {
    const period = statsPeriod(Date.now(), options.timeZone, options.range);
    const visits = await legacyVisits(ctx, period, ctx.readerId);
    return {
      daily: legacyDaily(visits, period),
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
    const period = statsPeriod(Date.now(), options.timeZone, options.range);
    const visits = await legacyVisits(ctx, period, ctx.readerId);
    const s = legacyReadingTotals(
      visits.activity.filter((s) => s.startedAt >= period.start),
      visits.interactions.filter((s) => s.createdAt >= period.start),
      visits.legacySessions.filter((s) => s.createdAt >= period.start),
    );
    return {
      articlesReadCount: s.articlesFinished,
      totalActiveTimeMinutes: Math.round(s.totalActiveTimeMs / 60000),
      avgScrollDepth: s.avgScrollDepth,
      annotationsOpenedCount: s.annotationsOpenedCount,
    };
  },
});

export const roomArgs = {
  timeZone: v.string(),
  // The reader's local date. The server ignores it: a query that reads the
  // clock is not re-run by the clock, so the client changes this at local
  // midnight to make Convex compute the period again. Optional so a client
  // loaded before it existed still works.
  today: v.optional(v.string()),
  period: v.union(v.literal("month"), v.literal("30days"), v.literal("90days")),
};
// Visits read newest first, with a physical 1501st sentinel. Ready per-source
// records omit visitId/annotations; unready libraries keep the canonical read
// and Room's explicit byte-partial contract (valid source IDs can be large).
const ROOM_VISITS = 1500;
// Older visits need an estimated-minutes card. Keep the existing join cap for
// metadata-unready/deferred sources that still require guarded body fallback.
const ARTICLE_FALLBACKS = 8;
const ARTICLE_BATCH = 20;
const ROOM_FEEDS = 200;
const FEEDS_SHOWN = 30;
const ROOM_VISIT_BYTES = 8 * 1024 * 1024;
// Auth, 200 feedStats, 30 bounded status titles and eight bounded article cards
// (including readiness lookups). Kept outside the shared legacy-body allowance.
const ROOM_JOIN_BYTES = 1024 * 1024;

/** Only Your reading has a byte-partial contract. Other periodVisits consumers
 * keep their existing row-only behavior and do not gain a hidden paginator. */
async function readingRoomVisits(
  ctx: QueryCtx,
  userId: string,
  timeZone: string,
  periodName: RoomPeriod,
) {
  const period = roomPeriod(Date.now(), timeZone, periodName);
  // The sole paginate in readingRoom, including for an empty library. There is
  // no post-index filter: every physical visit read is present in page, including
  // the 1501st sentinel and the row crossing maximumBytesRead (<= 1 MiB).
  const compact = await currentReportingReady(ctx, userId, "visits");
  const source = compact
    ? currentVisitQuery(ctx, userId, period)
    : ctx.db
        .query("readingActivity")
        .withIndex("by_user_started", (q) =>
          q
            .eq("userId", userId)
            .gte("startedAt", period.start)
            .lt("startedAt", period.end),
        )
        .order("desc");
  const visits = await source.paginate({
    cursor: null,
    numItems: ROOM_VISITS + 1,
    maximumBytesRead: ROOM_VISIT_BYTES,
  });
  const visitBytes = visits.page.reduce(
    (sum, row) => sum + getDocumentSize(row),
    0,
  );
  // Both legacy article lengths and source titles use this SAME queued ledger.
  // Reserve a full document before dispatch, not a title DTO after a body read.
  limitLegacyReadBytes(ctx, 16 * 1024 * 1024 - visitBytes - ROOM_JOIN_BYTES);
  return {
    period,
    rows: visits.page.slice(0, ROOM_VISITS),
    partial: !visits.isDone || visits.page.length > ROOM_VISITS,
  };
}

/** The reader's newest visits in the period, capped; `partial` when more exist. */
export async function periodVisits(
  ctx: QueryCtx,
  userId: string,
  timeZone: string,
  periodName: RoomPeriod,
) {
  const period = roomPeriod(Date.now(), timeZone, periodName);
  const compact = await currentReportingReady(ctx, userId, "visits");
  const source = compact
    ? currentVisitQuery(ctx, userId, period)
    : ctx.db
        .query("readingActivity")
        .withIndex("by_user_started", (q) =>
          q
            .eq("userId", userId)
            .gte("startedAt", period.start)
            .lt("startedAt", period.end),
        )
        .order("desc");
  const visits = await source.take(ROOM_VISITS + 1);
  return {
    period,
    rows: visits.slice(0, ROOM_VISITS),
    partial: visits.length > ROOM_VISITS,
  };
}

/**
 * The numbers behind Your reading: when the reader read, how long their reads
 * were, and how each feed served them. Aggregated here so the client never
 * receives visit rows. Hours are the reader's local hours in `timeZone`; a
 * visit counts toward the hour it started in.
 */
export const readingRoom = query({
  args: roomArgs,
  handler: async (ctx, { timeZone, period: periodName }) => {
    const { period, rows, partial } = await readingRoomVisits(
      ctx,
      ctx.readerId,
      timeZone,
      periodName,
    );

    // Days in the requested zone, not the `day` the device recorded, so the
    // count agrees with the heatmap when the reader's zone has changed
    const dayOf = localDayKeyer(timeZone);
    const readingDays = new Set(
      rows.filter((r) => r.activeTimeMs > 0).map((r) => dayOf(r.startedAt)),
    ).size;
    const perArticle = new Map<
      Id<"articles">,
      {
        activeTimeMs: number;
        startedAt: number;
        estimatedReadMinutes: number | undefined;
      }
    >();
    for (const row of rows) {
      const seen = perArticle.get(row.articleId);
      perArticle.set(row.articleId, {
        activeTimeMs: (seen?.activeTimeMs ?? 0) + row.activeTimeMs,
        // Rows are newest first, so the last one seen is the first visit
        startedAt: row.startedAt,
        estimatedReadMinutes:
          seen?.estimatedReadMinutes ?? row.estimatedReadMinutes,
      });
    }
    const reads = [...perArticle.entries()].filter(
      ([, a]) => a.activeTimeMs >= MIN_READ_MS,
    );
    let unplaced = 0;
    let fallbacks = 0;
    const lengths = new Map<Id<"articles">, number | undefined>();
    for (const [id, read] of reads) {
      if (read.estimatedReadMinutes !== undefined) continue;
      if (fallbacks >= ARTICLE_FALLBACKS) {
        unplaced++;
        continue;
      }
      fallbacks++;
      lengths.set(
        id,
        (await ownedArticleCard(ctx, id, ctx.readerId))?.estimatedReadMinutes,
      );
    }
    const split = splitReads(
      reads.map(([id, a]) => ({
        startedAt: a.startedAt,
        estimatedReadMinutes: a.estimatedReadMinutes ?? lengths.get(id),
      })),
      timeZone,
    );

    const counted = await ctx.db
      .query("feedStats")
      .withIndex("by_user_feed", (q) => q.eq("userId", ctx.readerId))
      .take(ROOM_FEEDS);
    const titleOf = await reportingFeedTitles(ctx, ctx.readerId);
    const feeds = [];
    for (const f of counted
      .filter((f) => f.offered > 0)
      .sort((a, b) => b.offered - a.offered)
      .slice(0, FEEDS_SHOWN)) {
      const title = await titleOf(f.feedId);
      if (title === null) continue;
      feeds.push({
        feedId: f.feedId,
        title,
        offered: f.offered,
        opened: f.opened,
        finished: f.finished,
        skipsMost: skipsMostOf(f.offered, f.opened),
      });
    }

    return {
      period,
      partial,
      readsPartial: unplaced > 0,
      activeTimeMs: rows.reduce((n, r) => n + r.activeTimeMs, 0),
      readingDays,
      heat: bucketActiveMinutes(rows, timeZone),
      ...split,
      // Offer counts have no dates, so they cover the feed's whole history
      feeds,
    };
  },
});

// Articles whose tags are read, newest read first, and the most tags kept per article
const TOPIC_ARTICLES = 200;
const TAGS_PER_ARTICLE = 20;
// Names are hydrated only for the final ranking, from vector-free metadata
// when ready (otherwise the canonical active-tag query is retained).
const TOPICS_SHOWN = 30;
// Preserve the first 300 active tags in canonical source-creation order,
// independent of metadata node recreation, count and vocabulary-tree ranking.
const ACTIVE_TAGS = 300;
// Bytes of finish and skip rows read per period, newest first, each from its
// own index range so routine browsing events can't crowd them out. Either kind
// can carry 128 annotation ids (about 4.7 KB a row), so the cap is on bytes:
// 1 MB each keeps the query under Convex's 16 MiB read limit beside the visits
// and tags it also reads.
const OUTCOME_BYTES = 1_000_000;
// Articles finished or skipped but not read for a minute that also get their
// tags looked up, so a topic's skips can include things never opened. Each
// lookup reads up to TAGS_PER_ARTICLE small link rows, which keeps the query
// well inside Convex's per-query document limit.
const OUTCOME_ARTICLES = 500;

/**
 * Topics the reader returns to, by minutes read in the period: the active tags
 * on the articles they read, with the active minutes spent and how many
 * distinct articles carried each. Candidate tags are not topics yet. Each
 * topic also says how many of its articles the reader finished and how many
 * they passed over with Another in the period. When a period has more outcomes
 * than the query reads, those counts are lower bounds and `outcomesPartial`
 * says so.
 */
export const readingTopics = query({
  args: roomArgs,
  handler: async (ctx, { timeZone, period: periodName }) => {
    const { rows } = await periodVisits(
      ctx,
      ctx.readerId,
      timeZone,
      periodName,
    );
    const activeMs = new Map<Id<"articles">, number>();
    for (const row of rows)
      activeMs.set(
        row.articleId,
        (activeMs.get(row.articleId) ?? 0) + row.activeTimeMs,
      );
    const read = [...activeMs.entries()]
      .filter(([, ms]) => ms > 0)
      .slice(0, TOPIC_ARTICLES);

    const period = roomPeriod(Date.now(), timeZone, periodName);
    const outcomeRows = async (action: "finished" | "skipped") => {
      const rows: Doc<"articleInteractions">[] = [];
      let bytes = 0;
      for await (const row of ctx.db
        .query("articleInteractions")
        .withIndex("by_user_action_created", (q) =>
          q
            .eq("userId", ctx.readerId)
            .eq("action", action)
            .gte("createdAt", period.start)
            .lt("createdAt", period.end),
        )
        .order("desc")) {
        bytes += getDocumentSize(row);
        // The row that crosses the budget has been read; stopping here keeps
        // the overshoot to one row
        if (bytes > OUTCOME_BYTES) return { rows, complete: false };
        rows.push(row);
      }
      return { rows, complete: true };
    };
    const finishes = await outcomeRows("finished");
    const skips = await outcomeRows("skipped");
    const finished = new Set(finishes.rows.map((row) => row.articleId));
    // A skip only counts once every finish in the period has been read: an
    // article the reader went on to finish was not passed over, and an unread
    // finish could be that one. Leaving skips out keeps the count a lower bound.
    const skipped = new Set(
      finishes.complete
        ? skips.rows
            .map((row) => row.articleId)
            .filter((id) => !finished.has(id))
        : [],
    );
    const readIds = new Set(read.map(([id]) => id));
    const unread = [...finished, ...skipped].filter((id) => !readIds.has(id));
    const outcomeOnly = unread
      .slice(0, OUTCOME_ARTICLES)
      .map((id) => [id, 0] as const);
    const outcomesPartial =
      !finishes.complete || !skips.complete || unread.length > OUTCOME_ARTICLES;

    // Candidates and other readers' tags are dropped before ranking, so they
    // can't use up the places that active topics need
    const tags = await reportingTags(ctx, ctx.readerId);
    const active = await tags.activeIds(ACTIVE_TAGS);
    const perTag = new Map<
      Id<"tags">,
      { ms: number; articles: number; finished: number; skipped: number }
    >();
    const counted = [...read, ...outcomeOnly];
    for (let i = 0; i < counted.length; i += ARTICLE_BATCH)
      await Promise.all(
        counted.slice(i, i + ARTICLE_BATCH).map(async ([articleId, ms]) => {
          const links = await ctx.db
            .query("articleTags")
            .withIndex("by_article", (q) => q.eq("articleId", articleId))
            .take(TAGS_PER_ARTICLE);
          // by_article is not scoped to a reader, so check the owner of each link
          for (const link of links) {
            if (link.userId !== ctx.readerId || !active.has(link.tagId))
              continue;
            const seen = perTag.get(link.tagId) ?? {
              ms: 0,
              articles: 0,
              finished: 0,
              skipped: 0,
            };
            perTag.set(link.tagId, {
              ms: seen.ms + ms,
              articles: seen.articles + (ms > 0 ? 1 : 0),
              finished: seen.finished + (finished.has(articleId) ? 1 : 0),
              skipped: seen.skipped + (skipped.has(articleId) ? 1 : 0),
            });
          }
        }),
      );

    return Promise.all(
      [...perTag.entries()]
        // A topic is one the reader spent time on; outcomes alone don't make one
        .filter(([, total]) => total.articles > 0)
        .sort((a, b) => b[1].ms - a[1].ms || a[0].localeCompare(b[0]))
        .slice(0, TOPICS_SHOWN)
        .map(async ([tagId, total]) => ({
          name: (await tags.name(tagId)) ?? "",
          minutes: Math.round((total.ms / 60_000) * 10) / 10,
          articles: total.articles,
          finished: total.finished,
          skipped: total.skipped,
          outcomesPartial,
        })),
    );
  },
});
