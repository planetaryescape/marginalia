import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

export const STEP_DELAY_MS = 60_000;
const LEASE_MS = 15 * 60_000;
const OVERLAP_MS = 2 * 60_000;

/** A transaction owns the lease: cron, continuation and manual sync cannot overlap. */
export const claim = internalMutation({
  args: { userId: v.string(), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    const now = Date.now();
    let state = await ctx.db
      .query("readwiseSyncState")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (state && (state.leaseUntil > now || state.nextRunAt > now)) return null;
    if (!state?.active) {
      const settings = await ctx.db
        .query("userSettings")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      // A legacy watermark does not prove the old 100-item import was complete.
      const updatedAfter =
        state?.backfilledAt && settings?.readwiseSyncedAt
          ? new Date(settings.readwiseSyncedAt - OVERLAP_MS).toISOString()
          : undefined;
      const fields = {
        userId,
        active: true,
        startedAt: now,
        updatedAfter,
        phase: 0,
        pageCursor: undefined,
        pageProcessedIds: [],
        token,
        leaseUntil: now + LEASE_MS,
        nextRunAt: now,
        scanned: 0,
        imported: 0,
        linked: 0,
        skipped: 0,
        highlights: 0,
        error: undefined,
        updatedAt: now,
      };
      if (state) await ctx.db.patch(state._id, fields);
      else {
        const id = await ctx.db.insert("readwiseSyncState", fields);
        state = await ctx.db.get(id);
      }
    } else {
      await ctx.db.patch(state._id, {
        token,
        leaseUntil: now + LEASE_MS,
        error: undefined,
        updatedAt: now,
      });
    }
    return state ? ctx.db.get(state._id) : null;
  },
});

export const recordDocument = internalMutation({
  args: {
    userId: v.string(),
    token: v.string(),
    documentId: v.string(),
    outcome: v.union(
      v.literal("imported"),
      v.literal("linked"),
      v.literal("existing"),
      v.literal("skipped"),
      v.literal("highlight"),
      v.literal("ignored"),
    ),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("readwiseSyncState")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (
      !state ||
      state.token !== args.token ||
      state.pageProcessedIds.includes(args.documentId)
    )
      return;
    if (state.pageProcessedIds.length >= 20)
      throw new Error("Reader page exceeds checkpoint limit");
    await ctx.db.patch(state._id, {
      pageProcessedIds: [...state.pageProcessedIds, args.documentId],
      scanned: state.scanned + (state.phase < 3 ? 1 : 0),
      imported: state.imported + (args.outcome === "imported" ? 1 : 0),
      linked: state.linked + (args.outcome === "linked" ? 1 : 0),
      skipped: state.skipped + (args.outcome === "skipped" ? 1 : 0),
      highlights: state.highlights + (args.outcome === "highlight" ? 1 : 0),
      updatedAt: Date.now(),
    });
  },
});

export const completePage = internalMutation({
  args: {
    userId: v.string(),
    token: v.string(),
    nextPageCursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("readwiseSyncState")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (!state || state.token !== args.token) return;
    const now = Date.now();
    const phase = args.nextPageCursor ? state.phase : state.phase + 1;
    const done = phase === 4;
    await ctx.db.patch(state._id, {
      phase,
      pageCursor: args.nextPageCursor ?? undefined,
      pageProcessedIds: [],
      active: !done,
      token: undefined,
      leaseUntil: 0,
      nextRunAt: now + STEP_DELAY_MS,
      updatedAt: now,
      error: undefined,
      ...(done && !state.updatedAfter ? { backfilledAt: now } : {}),
    });
    if (done) {
      await ctx.runMutation(internal.readwise.recordSync, {
        userId: args.userId,
        syncedAt: state.startedAt,
      });
    } else {
      // Cursor and successor are committed together; closing the browser is harmless.
      await ctx.scheduler.runAfter(
        STEP_DELAY_MS,
        internal.actions.readwiseSync.sync,
        { userId: args.userId },
      );
    }
  },
});

export const fail = internalMutation({
  args: {
    userId: v.string(),
    token: v.string(),
    error: v.string(),
    retryAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("readwiseSyncState")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (!state || state.token !== args.token) return;
    await ctx.db.patch(state._id, {
      token: undefined,
      leaseUntil: 0,
      error: args.error,
      updatedAt: Date.now(),
      nextRunAt: Date.now() + Math.max(STEP_DELAY_MS, args.retryAfterMs ?? 0),
    });
    // Leave cursor and watermark untouched. Manual sync or the cron resumes this page.
    await ctx.runMutation(internal.readwise.recordSync, {
      userId: args.userId,
      error: args.error,
    });
  },
});
