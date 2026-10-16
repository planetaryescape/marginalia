import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { libraryIsActive } from "./access";
import { setAnnotationStatus } from "./articles";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./functions";
import { needsAnnotationStart } from "./lib/annotationPolicy";
import { readerProviders } from "./lib/readerAI";
import type { TasteSource } from "./lib/taste";
import { CLAIM_TTL_MS } from "./reannotateBackfill";
import { loadTaste, readTasteProfile } from "./taste";

/**
 * Ahead-of-time annotation for the long articles a reader is likely to read
 * (D-DES-056). A daily job scores the deferred articles by taste and starts the
 * marginalia of the best few, within a daily cap. It also logs a control
 * sample it passed over, so the choice can be measured: chosen articles should
 * be opened more often than the control (preAnnotationReport).
 */

/** Most articles started in one 24 hours, chosen or retried. */
export const DAILY_CAP = 5;
const DAY_MS = 24 * 60 * 60_000;
// Deferred articles each carry their full text, so a scan reads few at a time
const SCAN_PAGE = 6;
// Deferred articles looked at in one run, newest first
export const MAX_SCAN = 120;
/** Taste needed to be worth annotating before the reader asks. */
export const MIN_TERM = 0.15;
const STAGGER_MS = 3_000;

const choice = v.object({
  articleId: v.id("articles"),
  term: v.number(),
  source: v.union(v.literal("author"), v.literal("feed"), v.literal("tag")),
});
const control = v.object({ articleId: v.id("articles"), hash: v.number() });
type Choice = { articleId: Id<"articles">; term: number; source: TasteSource };
type Control = { articleId: Id<"articles">; hash: number };

/** Stable per day, so a rerun the same day samples the same articles. */
export function sampleHash(day: string, id: string): number {
  let h = 2166136261;
  for (const ch of `${day}:${id}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** Articles chosen in the last 24 hours. */
async function usedToday(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  now: number,
) {
  const rows = await ctx.db
    .query("preAnnotations")
    .withIndex("by_user_chosenAt", (q) =>
      q.eq("userId", userId).gt("chosenAt", now - DAY_MS),
    )
    .take(DAILY_CAP * 4);
  return rows.filter((r) => r.group === "chosen").length;
}

/** Whether the reader has a key the marginalia could run on. */
async function hasProvider(ctx: Pick<QueryCtx, "db">, userId: string) {
  return (await readerProviders(ctx, userId)).providers.length > 0;
}

/**
 * Starts one reader's daily run. Nothing is read from the articles here: it
 * checks the reader can be spent on, then scans a page at a time.
 */
export const start = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    if (!(await libraryIsActive(ctx, userId))) return null;
    if (!(await hasProvider(ctx, userId))) return null;
    // No taste yet means nothing to choose by
    if (!(await readTasteProfile(ctx, userId))) return null;
    const remaining = DAILY_CAP - (await usedToday(ctx, userId, Date.now()));
    if (remaining <= 0) return null;
    await ctx.scheduler.runAfter(0, internal.preAnnotate.scan, {
      userId,
      remaining,
      scanned: 0,
      best: [],
      controls: [],
    });
    return null;
  },
});

function claimed(article: Doc<"articles">, now: number) {
  return (
    article.reannotateClaimedAt !== undefined &&
    now - article.reannotateClaimedAt < CLAIM_TTL_MS
  );
}

/** Scores the next page of deferred articles, keeping the best and a control sample. */
export const scan = internalMutation({
  args: {
    userId: v.string(),
    remaining: v.number(),
    scanned: v.number(),
    cursor: v.optional(v.string()),
    best: v.array(choice),
    controls: v.array(control),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = args;
    if (!(await libraryIsActive(ctx, userId))) return null;
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const page = await ctx.db
      .query("articles")
      .withIndex("by_user_annotationStatus_finishedAt", (q) =>
        q
          .eq("userId", userId)
          .eq("annotationStatus", "deferred")
          .eq("finishedAt", undefined),
      )
      .order("desc")
      .paginate({ numItems: SCAN_PAGE, cursor: args.cursor ?? null });

    const eligible: Doc<"articles">[] = [];
    for (const article of page.page) {
      if (article.bookUnitCount !== undefined) continue;
      if (!needsAnnotationStart(article) || claimed(article, now)) continue;
      const logged = await ctx.db
        .query("preAnnotations")
        .withIndex("by_user_article", (q) =>
          q.eq("userId", userId).eq("articleId", article._id),
        )
        .first();
      if (!logged) eligible.push(article);
    }
    const taste = await loadTaste({ db: ctx.db, readerId: userId }, eligible);

    const best: Choice[] = [...args.best];
    const controls: Control[] = [...args.controls];
    for (const article of eligible) {
      const t = taste.get(article._id);
      if (t?.because && t.term >= MIN_TERM)
        best.push({
          articleId: article._id,
          term: t.term,
          source: t.because.source,
        });
      controls.push({
        articleId: article._id,
        hash: sampleHash(day, article._id),
      });
    }
    best.sort(
      (a, b) => b.term - a.term || a.articleId.localeCompare(b.articleId),
    );
    controls.sort(
      (a, b) => a.hash - b.hash || a.articleId.localeCompare(b.articleId),
    );

    const scanned = args.scanned + page.page.length;
    if (page.isDone || scanned >= MAX_SCAN) {
      await ctx.scheduler.runAfter(0, internal.preAnnotate.commit, {
        userId,
        best: best.slice(0, args.remaining),
        controls: controls.slice(0, args.remaining * 2),
      });
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.preAnnotate.scan, {
      userId,
      remaining: args.remaining,
      scanned,
      cursor: page.continueCursor,
      best: best.slice(0, args.remaining),
      controls: controls.slice(0, args.remaining * 2),
    });
    return null;
  },
});

async function logRow(
  ctx: MutationCtx,
  userId: string,
  articleId: Id<"articles">,
  row:
    | { group: "chosen"; term: number; source: TasteSource }
    | { group: "control" },
  now: number,
) {
  await ctx.db.insert("preAnnotations", {
    userId,
    articleId,
    chosenAt: now,
    ...(row.group === "chosen"
      ? { group: "chosen", score: row.term, because: row.source }
      : { group: "control" }),
  });
}

/**
 * Starts the marginalia of the chosen articles and logs them with a control
 * sample. Everything is rechecked here, in the one transaction that flips each
 * article to pending and schedules it (as articles.annotateAhead does), so a
 * second run or a reader opening the article cannot start it twice.
 */
export const commit = internalMutation({
  args: {
    userId: v.string(),
    best: v.array(choice),
    controls: v.array(control),
  },
  returns: v.number(),
  handler: async (ctx, { userId, best, controls }) => {
    if (!(await libraryIsActive(ctx, userId))) return 0;
    if (!(await hasProvider(ctx, userId))) return 0;
    const now = Date.now();
    let room = DAILY_CAP - (await usedToday(ctx, userId, now));
    const started = new Set<Id<"articles">>();
    for (const picked of best) {
      if (room <= 0) break;
      const article = await ctx.db.get("articles", picked.articleId);
      if (
        article?.userId !== userId ||
        article.annotationStatus !== "deferred" ||
        article.finishedAt !== undefined ||
        !needsAnnotationStart(article) ||
        claimed(article, now)
      )
        continue;
      const logged = await ctx.db
        .query("preAnnotations")
        .withIndex("by_user_article", (q) =>
          q.eq("userId", userId).eq("articleId", article._id),
        )
        .first();
      if (logged) continue;
      await setAnnotationStatus(ctx, article._id, "pending");
      await ctx.scheduler.runAfter(
        started.size * STAGGER_MS,
        internal.actions.generateAnnotations.generateForArticle,
        { articleId: article._id },
      );
      await logRow(
        ctx,
        userId,
        article._id,
        { group: "chosen", ...picked },
        now,
      );
      started.add(article._id);
      room--;
    }
    // A control for each article started, drawn from what was passed over
    let wanted = started.size;
    for (const c of controls) {
      if (wanted <= 0) break;
      if (started.has(c.articleId)) continue;
      const logged = await ctx.db
        .query("preAnnotations")
        .withIndex("by_user_article", (q) =>
          q.eq("userId", userId).eq("articleId", c.articleId),
        )
        .first();
      if (logged) continue;
      await logRow(ctx, userId, c.articleId, { group: "control" }, now);
      wanted--;
    }
    console.info(
      JSON.stringify({
        job: "preAnnotate",
        started: started.size,
        chosen: best
          .filter((b) => started.has(b.articleId))
          .map((b) => ({
            articleId: b.articleId,
            because: b.source,
            term: b.term,
          })),
      }),
    );
    return started.size;
  },
});

const DAY_LAG_MS = 3 * DAY_MS;
const REPORT_ROWS = 400;

/**
 * Whether the ahead-of-time choices were worth making: the share of chosen
 * articles opened after being chosen, against the control sample passed over
 * on the same days. Only rows at least `minAgeMs` old count, since a recent
 * choice has not had time to be opened.
 *
 *   bunx convex run preAnnotate:preAnnotationReport '{"userId":"default_user"}'
 */
export const preAnnotationReport = internalQuery({
  args: { userId: v.string(), minAgeMs: v.optional(v.number()) },
  handler: async (ctx, { userId, minAgeMs }) => {
    const cutoff = Date.now() - (minAgeMs ?? DAY_LAG_MS);
    const rows = await ctx.db
      .query("preAnnotations")
      .withIndex("by_user_chosenAt", (q) =>
        q.eq("userId", userId).lte("chosenAt", cutoff),
      )
      .order("desc")
      .take(REPORT_ROWS);
    const tally = {
      chosen: { n: 0, opened: 0 },
      control: { n: 0, opened: 0 },
    };
    for (const row of rows) {
      const opened = await Promise.all(
        (["opened", "finished"] as const).map((action) =>
          ctx.db
            .query("articleInteractions")
            .withIndex("by_user_article_action", (q) =>
              q
                .eq("userId", userId)
                .eq("articleId", row.articleId)
                .eq("action", action),
            )
            .order("desc")
            .first(),
        ),
      );
      tally[row.group].n++;
      if (opened.some((i) => i && i.createdAt >= row.chosenAt))
        tally[row.group].opened++;
    }
    const rate = (t: { n: number; opened: number }) =>
      t.n === 0 ? null : t.opened / t.n;
    const chosen = rate(tally.chosen);
    const controlRate = rate(tally.control);
    return {
      chosen: { ...tally.chosen, rate: chosen },
      control: { ...tally.control, rate: controlRate },
      lift:
        chosen !== null && controlRate !== null ? chosen - controlRate : null,
    };
  },
});
