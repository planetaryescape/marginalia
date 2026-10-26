import { defineTable } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { readLegacyDocument } from "./articleMetadata";
import { metadataLibraryActive, metadataLibraryRetained } from "./shelfCounts";

// Private projections, never feed credentials, descriptions, URLs or errors.
export const feedStatusTables = {
  feedStatusEntries: defineTable({
    feedId: v.id("feeds"),
    userId: v.string(),
    failed: v.boolean(),
    title: v.string(),
  })
    .index("by_feedId", ["feedId"])
    .index("by_userId_and_failed", ["userId", "failed"]),
  feedStatusCounts: defineTable({
    userId: v.string(),
    total: v.number(),
    failed: v.number(),
    ready: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  }).index("by_userId", ["userId"]),
};

export function feedStatusCounts(ctx: Pick<QueryCtx, "db">, userId: string) {
  return ctx.db
    .query("feedStatusCounts")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/** Registration only: prove a retained, active library is physically empty.
 * Existing/unready counters still require the explicit migration. */
export async function initializeEmptyFeedStatus(
  ctx: MutationCtx,
  userId: string,
) {
  if (!(await metadataLibraryActive(ctx, userId))) return false;
  const counts = await feedStatusCounts(ctx, userId);
  if (counts) return counts.ready;
  const source = await ctx.db
    .query("feeds")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (source) return false;
  await ctx.db.insert("feedStatusCounts", {
    userId,
    total: 0,
    failed: 0,
    ready: true,
    cursor: null,
  });
  return true;
}

// At most 2048 Unicode scalars plus an explicit ellipsis (8195 UTF-8 bytes).
// Normal titles are unchanged; never split an astral character in legacy titles.
export function statusTitle(title: string) {
  let prefix = "";
  let length = 0;
  for (const scalar of title) {
    if (++length > 2048) return `${prefix}…`;
    prefix += scalar;
  }
  return prefix;
}

/** Historical headings include paused feeds. Ready projections are authoritative:
 * absence or another owner must never trigger a canonical-body fallback. */
export async function reportingFeedTitles(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
) {
  const ready = (await feedStatusCounts(ctx, userId))?.ready === true;
  return async (feedId: Id<"feeds">) => {
    const entry = await ctx.db
      .query("feedStatusEntries")
      .withIndex("by_feedId", (q) => q.eq("feedId", feedId))
      .unique();
    if (entry) return entry.userId === userId ? entry.title : null;
    if (ready) return null;
    const feed = await readLegacyDocument(ctx, () =>
      ctx.db.get("feeds", feedId),
    );
    return feed?.userId === userId ? statusTitle(feed.title) : null;
  };
}

async function bump(
  ctx: MutationCtx,
  userId: string,
  total: number,
  failed: number,
) {
  if ((!total && !failed) || !(await metadataLibraryRetained(ctx, userId)))
    return;
  const counts = await feedStatusCounts(ctx, userId);
  if (counts) {
    const next = {
      total: counts.total + total,
      failed: counts.failed + failed,
    };
    if (next.total < 0 || next.failed < 0 || next.failed > next.total)
      throw new Error("Invalid source status contribution");
    await ctx.db.patch(counts._id, next);
  } else {
    if (total < 0 || failed < 0)
      throw new Error("Missing source status counts");
    // Counting a new write is NOT proof that historical feeds were enumerated.
    await ctx.db.insert("feedStatusCounts", {
      userId,
      total,
      failed,
      ready: false,
      cursor: null,
    });
  }
}

/** Called with innerDb by the generic feeds trigger and by the explicit backfill.
 * The per-feed entry is the idempotent contribution, including during migration.
 * Never touches poll claims/reservations or patches the source document. */
export async function syncFeedStatus(
  ctx: MutationCtx,
  before: Doc<"feeds"> | null,
  after: Doc<"feeds"> | null,
) {
  const feedId = after?._id ?? before?._id;
  if (!feedId) return;
  const previous = await ctx.db
    .query("feedStatusEntries")
    .withIndex("by_feedId", (q) => q.eq("feedId", feedId))
    .unique();
  const retained = after && (await metadataLibraryRetained(ctx, after.userId));
  const next = retained
    ? {
        feedId,
        userId: after.userId,
        failed: Boolean(after.lastError),
        title: statusTitle(after.title),
      }
    : null;
  if (previous && (!next || previous.userId !== next.userId)) {
    await bump(ctx, previous.userId, -1, -Number(previous.failed));
    await ctx.db.delete(previous._id);
  }
  if (!next) return;
  if (!previous || previous.userId !== next.userId) {
    await bump(ctx, next.userId, 1, Number(next.failed));
    await ctx.db.insert("feedStatusEntries", next);
  } else if (previous.failed !== next.failed || previous.title !== next.title) {
    await bump(
      ctx,
      next.userId,
      0,
      Number(next.failed) - Number(previous.failed),
    );
    await ctx.db.patch(previous._id, next);
  }
}

/** Bounded small-row take, not paginate: safe before account's vault paginator.
 * Positive progress always ends that account transaction. No numeric step shift. */
export async function purgeFeedStatus(ctx: MutationCtx, userId: string) {
  if (await metadataLibraryRetained(ctx, userId))
    throw new Error("Cannot purge source status from a retained library");
  const entries = await ctx.db
    .query("feedStatusEntries")
    .withIndex("by_userId_and_failed", (q) => q.eq("userId", userId))
    .take(32);
  for (const entry of entries) await ctx.db.delete(entry._id);
  if (entries.length) return entries.length;
  const counts = await feedStatusCounts(ctx, userId);
  if (!counts) return 0;
  await ctx.db.delete(counts._id);
  return 1;
}
