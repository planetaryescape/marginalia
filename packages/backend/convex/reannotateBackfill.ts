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
import { metadataReady } from "./lib/articleMetadata";
import { WORDS_PER_MINUTE } from "./lib/constants";
import { embeddingProvider } from "./lib/providers";
import { readerProviders } from "./lib/readerAI";

/** Unread articles longer than this wait until they are picked (D-DES-056). */
export const MAX_BACKFILL_MINUTES = 20;
/** Small candidates per scan. A legacy scan reads only one full article. */
const SCAN_ROWS = 20;
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
  if (
    !candidateMayNeedBackfill({
      ...article,
      hasContent: Boolean(article.content),
    })
  )
    return false;
  // Failed means never annotated; preserve the existing retry eligibility.
  if (article.annotationStatus === "failed") return true;
  const protectedNote = await ctx.db
    .query("userNotes")
    .withIndex("by_articleId_and_annotationId", (q) =>
      q.eq("articleId", article._id).gt("annotationId", undefined),
    )
    .first();
  return protectedNote === null;
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
      scanSource: undefined,
      scanAfter: undefined,
      scanCursor: undefined,
      scanDone: undefined,
      pendingIds: undefined,
      batchStartedAt: undefined,
      batchQueued: undefined,
      nextBatchAt: undefined,
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

/** One bounded claim transaction inside the existing paced batch window. */
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

    if (row.nextBatchAt !== undefined && now < row.nextBatchAt) {
      await ctx.scheduler.runAfter(
        row.nextBatchAt - now,
        internal.reannotateBackfill.step,
        args,
      );
      return null;
    }
    let cursor = row.cursor;
    const status = row.phase ?? "annotated";
    const source =
      row.scanSource ??
      ((await metadataReady(ctx, args.userId)) ? "metadata" : "legacy");
    // A running pre-upgrade scan can have a timestamp resume bound. Keep
    // that bound fixed for every page of its new opaque cursor.
    const scanAfter = row.scanSource === undefined ? row.cursor : row.scanAfter;
    let scanCursor = row.scanCursor;
    let scanDone = row.scanDone ?? false;
    let pending = row.pendingIds ?? [];
    let scannedArticle: Doc<"articles"> | undefined;
    if (!pending.length && !scanDone) {
      if (source === "metadata") {
        const page = await ctx.db
          .query("articleMetadata")
          .withIndex("by_user_annotationStatus_finishedAt", (q) => {
            const range = q
              .eq("userId", args.userId)
              .eq("annotationStatus", status)
              .eq("finishedAt", undefined);
            return scanAfter === undefined
              ? range
              : range.gt("sourceCreationTime", scanAfter);
          })
          .paginate({
            cursor: scanCursor ?? null,
            numItems: SCAN_ROWS,
            maximumBytesRead: 1_500_000,
          });
        pending = page.page
          .filter(candidateMayNeedBackfill)
          .map((a) => a.articleId);
        cursor = page.page.at(-1)?.sourceCreationTime ?? cursor;
        scanCursor = page.continueCursor;
        scanDone = page.isDone;
      } else {
        const page = await ctx.db
          .query("articles")
          .withIndex("by_user_annotationStatus_finishedAt", (q) => {
            const range = q
              .eq("userId", args.userId)
              .eq("annotationStatus", status)
              .eq("finishedAt", undefined);
            return scanAfter === undefined
              ? range
              : range.gt("_creationTime", scanAfter);
          })
          .paginate({
            cursor: scanCursor ?? null,
            numItems: 1,
            maximumBytesRead: 1_000_000,
          });
        scannedArticle = page.page[0];
        pending = page.page.map((a) => a._id);
        cursor = scannedArticle?._creationTime ?? cursor;
        scanCursor = page.continueCursor;
        scanDone = page.isDone;
      }
    }
    const [articleId, ...remaining] = pending;
    const article = articleId
      ? (scannedArticle ?? (await ctx.db.get("articles", articleId)))
      : null;
    let batchStartedAt = row.batchStartedAt;
    let batchQueued = row.batchQueued ?? 0;
    let lastScheduledAt = row.lastScheduledAt;
    let queued = 0;
    // At most one rich article + one indexed protection row and one claim
    // patch per transaction, including the trigger's before/after reads.
    if (
      article?.userId === args.userId &&
      article.annotationStatus === status &&
      (await needsBackfill(ctx, article, now))
    ) {
      batchStartedAt ??= Math.max(
        now,
        (lastScheduledAt ?? now - JOB_STAGGER_MS) + JOB_STAGGER_MS,
      );
      // Delayed continuations must not bunch overdue provider jobs at zero.
      const due = Math.max(
        now,
        batchStartedAt + batchQueued * JOB_STAGGER_MS,
        (lastScheduledAt ?? now - JOB_STAGGER_MS) + JOB_STAGGER_MS,
      );
      // A late claim stretches its window rather than borrowing capacity
      // from the next one. Normal batches still start every 45 seconds.
      batchStartedAt = Math.max(
        batchStartedAt,
        due - batchQueued * JOB_STAGGER_MS,
      );
      lastScheduledAt = due;
      await ctx.db.patch("articles", article._id, { reannotateClaimedAt: now });
      await ctx.scheduler.runAfter(
        Math.max(0, due - now),
        internal.actions.generateAnnotations.generateForArticle,
        { articleId: article._id, claim: now },
      );
      batchQueued++;
      queued = 1;
    }
    const exhausted = scanDone && !remaining.length;
    const closeWindow = batchQueued >= PAGE || (exhausted && batchQueued > 0);
    if (exhausted && !batchQueued && status === "failed") {
      await finish();
      return null;
    }
    if (exhausted && !batchQueued) {
      await ctx.db.patch("reannotateState", row._id, {
        phase: "failed",
        cursor: undefined,
        scanSource: undefined,
        scanAfter: undefined,
        scanCursor: undefined,
        scanDone: undefined,
        pendingIds: undefined,
        batchStartedAt: undefined,
        batchQueued: undefined,
        nextBatchAt: undefined,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.reannotateBackfill.step, args);
      return null;
    }
    await ctx.db.patch("reannotateState", row._id, {
      cursor,
      scanSource: source,
      scanAfter,
      scanCursor,
      scanDone,
      pendingIds: remaining,
      batchStartedAt: closeWindow ? undefined : batchStartedAt,
      batchQueued: closeWindow ? 0 : batchQueued,
      nextBatchAt: closeWindow
        ? (batchStartedAt ?? now) + BATCH_DELAY_MS
        : undefined,
      lastScheduledAt,
      queued: row.queued + queued,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      closeWindow
        ? Math.max(0, (batchStartedAt ?? now) + BATCH_DELAY_MS - now)
        : 0,
      internal.reannotateBackfill.step,
      args,
    );
    return null;
  },
});

type BackfillCandidate = Pick<
  Doc<"articles">,
  | "annotationStatus"
  | "annotationVersion"
  | "estimatedReadMinutes"
  | "wordCount"
  | "finishedAt"
> & { hasContent?: boolean };
function candidateMayNeedBackfill(a: BackfillCandidate) {
  const minutes =
    a.estimatedReadMinutes ??
    (a.wordCount ? Math.ceil(a.wordCount / WORDS_PER_MINUTE) : null);
  return (
    a.finishedAt === undefined &&
    a.hasContent !== false &&
    (a.wordCount ?? 0) >= 100 &&
    minutes !== null &&
    minutes <= MAX_BACKFILL_MINUTES &&
    (a.annotationStatus === "failed" ||
      (a.annotationStatus === "annotated" &&
        (a.annotationVersion ?? 0) < CURRENT_ANNOTATION_VERSION))
  );
}

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
