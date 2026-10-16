// One-off re-annotation of a library's unread articles of 20 minutes or less,
// so they get the rung 2c margin: the three families, library connections,
// tags and the one point (D-DES-052, D-DES-056). Longer articles get theirs
// when they come up. A second phase retries short unread articles whose first
// annotation failed: a bulk import can fail hundreds at once on provider
// limits, and nothing else retries them before they are opened.
//
// It follows the catch-up's pacing (catchUp.ts): at most PAGE jobs a batch,
// BATCH_DELAY_MS between batches, JOB_STAGGER_MS between the jobs of a batch.
// Resumable and idempotent: an article is done once `annotationVersion`
// reaches CURRENT_ANNOTATION_VERSION, which only a successful annotation sets,
// so a second run skips finished articles and retries failed ones. An old
// margin is replaced in one transaction only after the new one exists.
//
//   bunx convex run reannotateBackfill:start '{"userId":"default_user"}'
//   bunx convex run reannotateBackfill:status '{"userId":"default_user"}'
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { libraryIsActive } from "./access";
import { BATCH_DELAY_MS, JOB_STAGGER_MS, PAGE } from "./catchUp";
import { internalMutation, internalQuery, type QueryCtx } from "./functions";
import { CURRENT_ANNOTATION_VERSION } from "./lib/annotationGate";
import { WORDS_PER_MINUTE } from "./lib/constants";
import { embeddingProvider } from "./lib/providers";
import { readerProviders } from "./lib/readerAI";

/** Unread articles longer than this wait until they are picked (D-DES-056). */
export const MAX_BACKFILL_MINUTES = 20;
/** Articles read per scan; each row carries the article text. */
const SCAN_ROWS = 20;
/** Scans per step when they find nothing to queue. */
const SCAN_PAGES = 5;
/**
 * How long a scheduled article stays claimed: the longest an action may run
 * plus ten minutes. A run that finds a live claim leaves the article alone.
 */
export const CLAIM_TTL_MS = 20 * 60_000;
/** A running backfill whose last step is older than this has lost its schedule. */
export const STALE_MS = 10 * 60_000;

type Db = Pick<QueryCtx, "db">;

function stateRow(ctx: Db, userId: string) {
  return ctx.db
    .query("reannotateState")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

function minutesOf(article: Doc<"articles">): number | null {
  if (article.estimatedReadMinutes !== undefined)
    return article.estimatedReadMinutes;
  return article.wordCount
    ? Math.ceil(article.wordCount / WORDS_PER_MINUTE)
    : null;
}

/**
 * Whether the backfill should annotate this article again: annotated, unread,
 * short enough, written before the current version, and carrying no reflection
 * the reader attached to a note (replacing the notes would orphan it).
 */
export async function needsBackfill(
  ctx: Db,
  article: Doc<"articles">,
  now = Date.now(),
): Promise<boolean> {
  if (
    article.reannotateClaimedAt !== undefined &&
    now - article.reannotateClaimedAt < CLAIM_TTL_MS
  )
    return false;
  if (article.finishedAt !== undefined) return false;
  if (article.annotationStatus === "failed") {
    // Never annotated, so there are no notes a reflection could hang on
    if (!article.content || (article.wordCount ?? 0) < 100) return false;
    const minutes = minutesOf(article);
    return minutes !== null && minutes <= MAX_BACKFILL_MINUTES;
  }
  if (article.annotationStatus !== "annotated") return false;
  if ((article.annotationVersion ?? 0) >= CURRENT_ANNOTATION_VERSION)
    return false;
  if (!article.content || (article.wordCount ?? 0) < 100) return false;
  const minutes = minutesOf(article);
  if (minutes === null || minutes > MAX_BACKFILL_MINUTES) return false;
  const notes = await ctx.db
    .query("userNotes")
    .withIndex("by_article", (q) => q.eq("articleId", article._id))
    .collect();
  return !notes.some((note) => note.annotationId !== undefined);
}

async function canRun(ctx: Db, userId: string) {
  if (!(await libraryIsActive(ctx, userId))) return false;
  const { providers } = await readerProviders(ctx, userId);
  // Without an embedding key the new margin would lack connections and tags
  return providers.length > 0 && embeddingProvider(providers) !== null;
}

/** Starts the backfill, resumes one that lost its schedule, or leaves a live one alone. */
export const start = internalMutation({
  args: { userId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    if (!(await canRun(ctx, args.userId)))
      return "not started: the library needs a text and an embedding key";
    const now = Date.now();
    const row = await stateRow(ctx, args.userId);
    if (row?.running) {
      if (now - row.updatedAt < STALE_MS) return "already running";
      await ctx.db.patch("reannotateState", row._id, { updatedAt: now });
      await ctx.scheduler.runAfter(0, internal.reannotateBackfill.step, {
        userId: args.userId,
        runId: row.runId,
      });
      return "resumed";
    }
    const fields = {
      running: true,
      runId: (row?.runId ?? 0) + 1,
      cursor: undefined,
      phase: undefined,
      queued: 0,
      startedAt: now,
      updatedAt: now,
      finishedAt: undefined,
    };
    if (row) await ctx.db.patch("reannotateState", row._id, fields);
    else
      await ctx.db.insert("reannotateState", {
        userId: args.userId,
        ...fields,
      });
    await ctx.scheduler.runAfter(0, internal.reannotateBackfill.step, {
      userId: args.userId,
      runId: fields.runId,
    });
    return "started";
  },
});

/** Queues one batch, then schedules the next. Only the current run advances. */
export const step = internalMutation({
  args: { userId: v.string(), runId: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await stateRow(ctx, args.userId);
    if (!row?.running || row.runId !== args.runId) return null;
    const now = Date.now();
    const finish = () =>
      ctx.db.patch("reannotateState", row._id, {
        running: false,
        finishedAt: now,
        updatedAt: now,
      });
    // Checked every batch: a key removed mid-run stops the spend
    if (!(await canRun(ctx, args.userId))) {
      await finish();
      return null;
    }

    let cursor = row.cursor;
    const status = row.phase ?? "annotated";
    const batch: Doc<"articles">["_id"][] = [];
    let exhausted = false;
    for (let page = 0; page < SCAN_PAGES && batch.length < PAGE; page++) {
      const rows = await ctx.db
        .query("articles")
        .withIndex("by_user_annotationStatus_finishedAt", (q) => {
          const range = q
            .eq("userId", args.userId)
            .eq("annotationStatus", status)
            .eq("finishedAt", undefined);
          return cursor === undefined
            ? range
            : range.gt("_creationTime", cursor);
        })
        .take(SCAN_ROWS);
      for (const article of rows) {
        cursor = article._creationTime;
        if (batch.length < PAGE && (await needsBackfill(ctx, article, now)))
          batch.push(article._id);
        // The batch is full: leave the cursor on the last article queued
        if (batch.length >= PAGE) break;
      }
      if (rows.length < SCAN_ROWS) {
        exhausted = true;
        break;
      }
    }

    for (const [index, articleId] of batch.entries()) {
      // Claimed in the same transaction that schedules it, so a restart or a
      // second run can't schedule it again while the first call is in flight
      await ctx.db.patch("articles", articleId, { reannotateClaimedAt: now });
      await ctx.scheduler.runAfter(
        index * JOB_STAGGER_MS,
        internal.actions.generateAnnotations.generateForArticle,
        { articleId, claim: now },
      );
    }
    if (exhausted && !batch.length && status === "failed") {
      await finish();
      return null;
    }
    if (exhausted && !batch.length) {
      await ctx.db.patch("reannotateState", row._id, {
        phase: "failed",
        cursor: undefined,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.reannotateBackfill.step, args);
      return null;
    }
    await ctx.db.patch("reannotateState", row._id, {
      cursor,
      queued: row.queued + batch.length,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      batch.length ? BATCH_DELAY_MS : 0,
      internal.reannotateBackfill.step,
      args,
    );
    return null;
  },
});

/**
 * Ends a claim once the generation scheduled under it has finished, however it
 * ended. Only that claim: a newer one belongs to a later run.
 */
export const releaseClaim = internalMutation({
  args: { articleId: v.id("articles"), claim: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    if (article?.reannotateClaimedAt === args.claim)
      await ctx.db.patch("articles", args.articleId, {
        reannotateClaimedAt: undefined,
      });
    return null;
  },
});

/** How far the backfill has got. */
export const status = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const row = await stateRow(ctx, args.userId);
    return row
      ? {
          running: row.running,
          queued: row.queued,
          startedAt: row.startedAt,
          updatedAt: row.updatedAt,
          finishedAt: row.finishedAt,
        }
      : null;
  },
});
