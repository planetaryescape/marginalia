import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";
import { readwiseConnection } from "./readwise";

const job = v.union(
  v.literal("queue"),
  v.literal("feeds"),
  v.literal("readwise"),
  v.literal("feedStats"),
);
type Job = "queue" | "feeds" | "readwise" | "feedStats";

const PAGE_SIZE = 25;
// Spread each library's work out instead of starting every reader at once
const STAGGER_MS: Record<Job, number> = {
  queue: 500,
  feeds: 10_000,
  readwise: 15_000,
  feedStats: 500,
};

async function scheduleFor(
  ctx: MutationCtx,
  name: Job,
  userId: string,
  delayMs: number,
): Promise<boolean> {
  switch (name) {
    case "queue":
      await ctx.scheduler.runAfter(delayMs, internal.readingQueue.initialize, {
        userId,
      });
      return true;
    case "feedStats":
      await ctx.scheduler.runAfter(delayMs, internal.feedStats.backfill, {
        userId,
      });
      return true;
    case "feeds":
      await ctx.scheduler.runAfter(
        delayMs,
        internal.actions.pollFeeds.pollAllFeeds,
        { userId },
      );
      return true;
    case "readwise":
      // Readers without a Readwise token are skipped silently
      if (!(await readwiseConnection(ctx, userId))) return false;
      await ctx.scheduler.runAfter(
        delayMs,
        internal.actions.readwiseSync.sync,
        { userId },
      );
      return true;
  }
}

/**
 * Cron entry point: schedules one background job for the owner's library and
 * every active reader, a bounded page at a time. Per-library pacing and
 * leases stay with the job itself.
 */
export const fanOut = internalMutation({
  args: {
    job,
    cursor: v.optional(v.string()),
    slot: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let slot = args.slot ?? 0;
    const schedule = async (userId: string) => {
      if (await scheduleFor(ctx, args.job, userId, slot * STAGGER_MS[args.job]))
        slot++;
    };
    if (args.cursor === undefined) await schedule(DEFAULT_USER_ID);
    const page = await ctx.db
      .query("readers")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .paginate({ numItems: PAGE_SIZE, cursor: args.cursor ?? null });
    for (const reader of page.page)
      if (reader.libraryId !== DEFAULT_USER_ID && !reader.deletingAt)
        await schedule(reader.libraryId);
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.background.fanOut, {
        job: args.job,
        cursor: page.continueCursor,
        slot,
      });
    return null;
  },
});
