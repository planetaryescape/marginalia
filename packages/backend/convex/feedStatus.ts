import { v } from "convex/values";
import { internalMutation, query } from "./functions";
import { feedStatusCounts, syncFeedStatus } from "./lib/feedStatus";
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
