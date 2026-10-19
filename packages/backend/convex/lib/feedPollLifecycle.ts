import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { metadataLibraryRetained } from "./shelfCounts";

// Separate from function registration so the shared trigger registry can import
// this without a functions -> triggers -> functions initialization cycle.
export async function invalidateFeedPoll(
  ctx: MutationCtx,
  before: Doc<"feeds">,
  after: Doc<"feeds"> | null,
) {
  if (
    after &&
    after.url === before.url &&
    after.isActive === before.isActive &&
    after.userId === before.userId
  )
    return;
  const state = await ctx.db
    .query("feedPollStates")
    .withIndex("by_feedId", (q) => q.eq("feedId", before._id))
    .unique();
  // Revoke publication only. A started pool reservation survives this state
  // deletion/generation change until its action settles or its deadline expires.
  if (state && (!after || after.userId !== before.userId))
    await ctx.db.delete(state._id);
  else if (state) {
    const patch: Partial<Doc<"feedPollStates">> = {
      generation: state.generation + 1,
      leaseUntil: undefined,
    };
    if (after?.url !== before.url) {
      patch.etag = undefined;
      patch.modified = undefined;
      patch.representationUrl = undefined;
    }
    await ctx.db.patch(state._id, patch);
  }
  if (after) {
    const patch: Partial<Doc<"feeds">> = { checkingSince: undefined };
    if (after.url !== before.url) {
      patch.lastFetchedAt = undefined;
      patch.importAfter = undefined;
    }
    await ctx.db.patch(after._id, patch);
  }
  await ctx.scheduler.runAfter(0, internal.feedPolling.dispatch, {});
}

/** Return positive after a bounded batch, before another account step can read
 * bodies. Started global reservations must survive until their network settles. */
export async function purgeFeedPolls(
  ctx: MutationCtx,
  userId: string,
): Promise<number> {
  if (await metadataLibraryRetained(ctx, userId))
    throw new Error("Cannot purge feed polls from a retained library");
  const rows = await ctx.db
    .query("feedPollStates")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(25);
  for (const row of rows) await ctx.db.delete(row._id);
  if (rows.length) {
    await ctx.scheduler.runAfter(0, internal.feedPolling.dispatch, {});
    return rows.length;
  }
  const run = await ctx.db
    .query("feedPollRuns")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (run) {
    await ctx.db.delete(run._id);
    await ctx.scheduler.runAfter(0, internal.feedPolling.dispatch, {});
    return 1;
  }
  return 0;
}
