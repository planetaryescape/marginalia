import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { libraryIsActive } from "../access";
import { queuedForReading } from "./readingEligibility";
import { metadataLibraryRetained } from "./shelfCounts";

const zero = {
  annotated: 0,
  waiting: 0,
  pending: 0,
  fits5: 0,
  fits10: 0,
  fits20: 0,
};

function contribution(article: Doc<"articles"> | null) {
  if (!article) return zero;
  const annotated = queuedForReading(article) ? 1 : 0;
  const waiting = annotated && article.finishedAt === undefined ? 1 : 0;
  const minutes = article.estimatedReadMinutes ?? Number.POSITIVE_INFINITY;
  return {
    annotated,
    waiting,
    pending: article.annotationStatus === "pending" ? 1 : 0,
    fits5: waiting && minutes <= 5 ? 1 : 0,
    fits10: waiting && minutes <= 10 ? 1 : 0,
    fits20: waiting && minutes <= 20 ? 1 : 0,
  };
}

function sameCounts(a: typeof zero, b: typeof zero) {
  return (
    a.annotated === b.annotated &&
    a.waiting === b.waiting &&
    a.pending === b.pending &&
    a.fits5 === b.fits5 &&
    a.fits10 === b.fits10 &&
    a.fits20 === b.fits20
  );
}

/** Keep the old counter namespace intact: old and new baselines never mix.
 * Persist the applied contribution, so retrying a migration or a stale writer
 * cannot subtract a newly computed value from a different historical baseline. */
export async function syncReadableQueue(
  ctx: MutationCtx,
  before: Doc<"articles"> | null,
  after: Doc<"articles"> | null,
) {
  if (before && after && before.userId !== after.userId) {
    await syncReadableQueue(ctx, before, null);
    await syncReadableQueue(ctx, null, after);
    return;
  }
  if (before && after && sameCounts(contribution(before), contribution(after)))
    return;
  const article = after ?? before;
  if (!article || !(await metadataLibraryRetained(ctx, article.userId))) return;
  let stats = await ctx.db
    .query("readableQueueStats")
    .withIndex("by_user", (q) => q.eq("userId", article.userId))
    .unique();
  if (!stats) {
    const id = await ctx.db.insert("readableQueueStats", {
      userId: article.userId,
      ...zero,
      generation: 1,
      ready: false,
    });
    stats = await ctx.db.get(id);
  }
  if (!stats) throw new Error("Readable queue counter missing");
  const receipt = await ctx.db
    .query("readableQueueEntries")
    .withIndex("by_articleId", (q) => q.eq("articleId", article._id))
    .unique();
  const next = contribution(after);
  if (
    after &&
    receipt?.generation === stats.generation &&
    sameCounts(receipt, next)
  )
    return;
  const previous = receipt?.generation === stats.generation ? receipt : zero;
  await ctx.db.patch(stats._id, {
    annotated: stats.annotated + next.annotated - previous.annotated,
    waiting: stats.waiting + next.waiting - previous.waiting,
    pending: stats.pending + next.pending - previous.pending,
    fits5: stats.fits5 + next.fits5 - previous.fits5,
    fits10: stats.fits10 + next.fits10 - previous.fits10,
    fits20: stats.fits20 + next.fits20 - previous.fits20,
  });
  if (after) {
    const fields = {
      articleId: after._id,
      userId: after.userId,
      generation: stats.generation,
      ...next,
    };
    if (receipt) await ctx.db.replace(receipt._id, fields);
    else await ctx.db.insert("readableQueueEntries", fields);
  } else if (receipt) await ctx.db.delete(receipt._id);
}

/** The existing per-reader queue cron resumes this bounded scan, including for
 * legacy ready=true libraries. Writes and scan pages share the same receipts. */
export async function initializeReadableQueue(
  ctx: MutationCtx,
  userId: string,
) {
  if (!(await libraryIsActive(ctx, userId))) return;
  let stats = await ctx.db
    .query("readableQueueStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (stats?.ready) return;
  if (!stats) {
    const id = await ctx.db.insert("readableQueueStats", {
      userId,
      ...zero,
      generation: 1,
      ready: false,
    });
    stats = await ctx.db.get(id);
  }
  if (!stats) throw new Error("Readable queue counter missing");
  const page = await ctx.db
    .query("articles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .paginate({
      cursor: stats.cursor ?? null,
      numItems: 4,
      maximumBytesRead: 1_500_000,
    });
  for (const article of page.page) {
    await syncReadableQueue(ctx, null, article);
  }
  await ctx.db.patch(stats._id, {
    cursor: page.continueCursor,
    ready: page.isDone,
  });
  if (!page.isDone)
    await ctx.scheduler.runAfter(0, internal.readingQueue.initialize, {
      userId,
    });
}

/** Approved rollback recovery starts a fresh generation, never edits receipts
 * or guesses at adjustments after a backend without these triggers ran. */
export async function rebuildReadableQueue(ctx: MutationCtx, userId: string) {
  if (!(await libraryIsActive(ctx, userId))) return;
  const stats = await ctx.db
    .query("readableQueueStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (stats)
    await ctx.db.patch(stats._id, {
      ...zero,
      generation: stats.generation + 1,
      ready: false,
      cursor: undefined,
    });
  await ctx.scheduler.runAfter(0, internal.readingQueue.initialize, { userId });
}

/** Only a complete empty source range can skip the independent readable scan. */
export async function completeReadableQueue(ctx: MutationCtx, userId: string) {
  const stats = await ctx.db
    .query("readableQueueStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (stats) await ctx.db.patch(stats._id, { ready: true });
  else
    await ctx.db.insert("readableQueueStats", {
      userId,
      ...zero,
      generation: 1,
      ready: true,
    });
}
