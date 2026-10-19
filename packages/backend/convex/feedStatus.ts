import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./functions";
import {
  feedStatusCounts,
  statusTitle,
  syncFeedStatus,
} from "./lib/feedStatus";
import { metadataLibraryRetained } from "./lib/shelfCounts";

export const status = query({
  args: {},
  handler: async (ctx) => {
    const counts = await feedStatusCounts(ctx, ctx.readerId);
    if (!counts?.ready)
      return {
        ready: false as const,
        total: null,
        failed: null,
        failingTitle: null,
      };
    const failure =
      counts.failed === 1
        ? await ctx.db
            .query("feedStatusEntries")
            .withIndex("by_userId_and_failed", (q) =>
              q.eq("userId", ctx.readerId).eq("failed", true),
            )
            .first()
        : null;
    if (counts.failed === 1 && !failure)
      throw new Error("Source status needs repair");
    return {
      ready: true as const,
      total: counts.total,
      failed: counts.failed,
      failingTitle: failure?.title ?? null,
    };
  },
});

/** Explicit operator-driven migration. One byte/row-bounded page per call;
 * generic writes may interleave, but only missing/changed contributions count.
 * No scheduling, network, guessed empty baseline or frontend-triggered writes. */
export const backfill = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    if (!(await metadataLibraryRetained(ctx, userId)))
      return { complete: false, inactive: true };
    let counts = await feedStatusCounts(ctx, userId);
    if (counts?.ready) return { complete: true, inactive: false };
    if (!counts) {
      const id = await ctx.db.insert("feedStatusCounts", {
        userId,
        total: 0,
        failed: 0,
        ready: false,
        cursor: null,
      });
      counts = await ctx.db.get(id);
    }
    if (!counts) throw new Error("Source status migration state missing");
    const page = await ctx.db
      .query("feeds")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .paginate({
        cursor: counts.cursor,
        numItems: 4,
        maximumBytesRead: 4_000_000,
      });
    for (const feed of page.page) await syncFeedStatus(ctx, null, feed);
    await ctx.db.patch(counts._id, {
      ready: page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
    });
    return { complete: page.isDone, inactive: false };
  },
});

/** Operator-only cutover gate. Compare the complete bounded library in one
 * snapshot; a large/incomplete source page is never reported as exact. */
export const verify = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const counts = await feedStatusCounts(ctx, userId);
    if (!(await metadataLibraryRetained(ctx, userId)) || !counts?.ready)
      return { ready: false, complete: false, matches: false, checked: 0 };
    const page = await ctx.db
      .query("feeds")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .paginate({
        cursor: null,
        numItems: 64,
        maximumBytesRead: 8 * 1024 * 1024,
      });
    if (!page.isDone)
      return {
        ready: true,
        complete: false,
        matches: false,
        checked: page.page.length,
      };
    const entries = await ctx.db
      .query("feedStatusEntries")
      .withIndex("by_userId_and_failed", (q) => q.eq("userId", userId))
      .take(65);
    const byId = new Map(entries.map((entry) => [entry.feedId, entry]));
    const matches =
      entries.length === page.page.length &&
      counts.total === page.page.length &&
      counts.failed ===
        page.page.filter((feed) => Boolean(feed.lastError)).length &&
      page.page.every((feed) => {
        const entry = byId.get(feed._id);
        return (
          entry?.userId === userId &&
          entry.failed === Boolean(feed.lastError) &&
          entry.title === statusTitle(feed.title)
        );
      });
    return { ready: true, complete: true, matches, checked: page.page.length };
  },
});
