import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { ownedArticle } from "./access";
import { query } from "./functions";
import {
  bucketActiveMinutes,
  localDayKeyer,
  MIN_READ_MS,
  type RoomPeriod,
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

export const roomArgs = {
  timeZone: v.string(),
  // The reader's local date. The server ignores it: a query that reads the
  // clock is not re-run by the clock, so the client changes this at local
  // midnight to make Convex compute the period again. Optional so a client
  // loaded before it existed still works.
  today: v.optional(v.string()),
  period: v.union(v.literal("month"), v.literal("30days"), v.literal("90days")),
};
// Visits read for the room, newest first. A row can carry up to 128
// annotation ids: 4,001 such rows measured 18.9 MB, about 4.7 KB each. At 1,500
// the worst case is 1,500 x 4.7 KB = 7.1 MB, leaving room under Convex's 16 MiB
// read limit for the articles, tags and feeds the same query reads. Past it the
// room says it is partial.
const ROOM_VISITS = 1500;
// Rows written before `estimatedReadMinutes` was copied onto them fall back to
// reading the article, whose document can be close to a megabyte. This many
// such reads per query; the backfill removes the need.
const ARTICLE_FALLBACKS = 8;
const ARTICLE_BATCH = 20;
const ROOM_FEEDS = 200;
const FEEDS_SHOWN = 30;

/** The reader's newest visits in the period, capped; `partial` when more exist. */
export async function periodVisits(
  ctx: QueryCtx,
  userId: string,
  timeZone: string,
  periodName: RoomPeriod,
) {
  const period = roomPeriod(Date.now(), timeZone, periodName);
  const visits = await ctx.db
    .query("readingActivity")
    .withIndex("by_user_started", (q) =>
      q
        .eq("userId", userId)
        .gte("startedAt", period.start)
        .lt("startedAt", period.end),
    )
    .order("desc")
    .take(ROOM_VISITS + 1);
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
    const { period, rows, partial } = await periodVisits(
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
        (await ownedArticle(ctx, id, ctx.readerId))?.estimatedReadMinutes,
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
// Tag documents carry an embedding, so they are fetched in small batches and
// only as far down the minutes ranking as 30 active topics need
const TOPICS_SHOWN = 30;
// Active tags loaded to rank against. A tag document is about 15 KB with its
// embedding, so 300 is about 4.5 MB. Tag counts stay far below that because
// new tags are resisted: a name is matched onto an existing tag or alias
// before one is created (D-DES-059).
const ACTIVE_TAGS = 300;
// Interaction rows read for the finish and skip counts, newest first. A finish
// row can carry 128 annotation ids (about 4.7 KB), so 600 rows add under 3 MB
// to the visits the query already reads.
const OUTCOME_EVENTS = 600;
// Articles finished or skipped but not read for a minute that also get their
// tags looked up, so a topic's skips can include things never opened
const OUTCOME_ARTICLES = 100;

/**
 * Topics the reader returns to, by minutes read in the period: the active tags
 * on the articles they read, with the active minutes spent and how many
 * distinct articles carried each. Candidate tags are not topics yet. Each
 * topic also says how many of its articles the reader finished and how many
 * they passed over with Another in the period, from the newest interactions.
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
    const events = await ctx.db
      .query("articleInteractions")
      .withIndex("by_user_created", (q) =>
        q
          .eq("userId", ctx.readerId)
          .gte("createdAt", period.start)
          .lt("createdAt", period.end),
      )
      .order("desc")
      .take(OUTCOME_EVENTS);
    const finished = new Set<Id<"articles">>();
    const skipped = new Set<Id<"articles">>();
    for (const event of events) {
      if (event.action === "finished") finished.add(event.articleId);
      else if (event.action === "skipped") skipped.add(event.articleId);
    }
    // An article the reader went on to finish was not passed over
    for (const id of finished) skipped.delete(id);
    const readIds = new Set(read.map(([id]) => id));
    const outcomeOnly = [...finished, ...skipped]
      .filter((id) => !readIds.has(id))
      .slice(0, OUTCOME_ARTICLES)
      .map((id) => [id, 0] as const);

    // Candidates and other readers' tags are dropped before ranking, so they
    // can't use up the places that active topics need
    const active = new Map(
      (
        await ctx.db
          .query("tags")
          .withIndex("by_user_status", (q) =>
            q.eq("userId", ctx.readerId).eq("status", "active"),
          )
          .take(ACTIVE_TAGS)
      ).map((tag) => [tag._id, tag.name]),
    );
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

    return (
      [...perTag.entries()]
        // A topic is one the reader spent time on; outcomes alone don't make one
        .filter(([, total]) => total.articles > 0)
        .sort((a, b) => b[1].ms - a[1].ms || a[0].localeCompare(b[0]))
        .slice(0, TOPICS_SHOWN)
        .map(([tagId, total]) => ({
          name: active.get(tagId) ?? "",
          minutes: Math.round((total.ms / 60_000) * 10) / 10,
          articles: total.articles,
          finished: total.finished,
          skipped: total.skipped,
        }))
    );
  },
});
