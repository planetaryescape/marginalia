import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DEFAULT_USER_ID } from "./constants";

export type Shelf = "savedArticles" | "lovedArticles";

// Kept independent of access/functions registration to avoid an import cycle.
export async function metadataLibraryActive(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
) {
  if (userId === DEFAULT_USER_ID) return true;
  const reader = await ctx.db
    .query("readers")
    .withIndex("by_libraryId", (q) => q.eq("libraryId", userId))
    .first();
  return reader?.status === "active" && reader.deletingAt === undefined;
}

/** Disabled readers still own retained source data. Mirror already-authorized
 * writes so enabling one again cannot reveal stale/missing cards or counts. */
export async function metadataLibraryRetained(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
) {
  if (userId === DEFAULT_USER_ID) return true;
  const reader = await ctx.db
    .query("readers")
    .withIndex("by_libraryId", (q) => q.eq("libraryId", userId))
    .first();
  return reader !== null && reader.deletingAt === undefined;
}

export async function shelfCounts(ctx: Pick<QueryCtx, "db">, userId: string) {
  return ctx.db
    .query("shelfCounts")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

async function bump(
  ctx: MutationCtx,
  userId: string,
  shelf: Shelf,
  delta: number,
) {
  const row = await shelfCounts(ctx, userId);
  const key = shelf === "savedArticles" ? "saved" : "loved";
  if (row) await ctx.db.patch(row._id, { [key]: row[key] + delta });
  else if (delta > 0 && (await metadataLibraryRetained(ctx, userId)))
    await ctx.db.insert("shelfCounts", {
      userId,
      saved: key === "saved" ? delta : 0,
      loved: key === "loved" ? delta : 0,
      ready: false,
    });
}

export async function countMembership(
  ctx: MutationCtx,
  shelf: Shelf,
  row: Doc<Shelf>,
) {
  if (row.shelfCounted || !(await metadataLibraryRetained(ctx, row.userId)))
    return;
  await bump(ctx, row.userId, shelf, 1);
  // Caller supplies innerDb: this marker is part of the same transaction, not
  // a second membership change (nor a deduplication of historical rows).
  await ctx.db.patch(row._id, { shelfCounted: true });
}

export async function membershipChanged(
  ctx: MutationCtx,
  shelf: Shelf,
  before: Doc<Shelf> | null,
  after: Doc<Shelf> | null,
) {
  if (before?.shelfCounted && (!after || after.userId !== before.userId))
    await bump(ctx, before.userId, shelf, -1);
  if (after && (!before || before.userId !== after.userId)) {
    await countMembership(ctx, shelf, { ...after, shelfCounted: false });
  }
}

export async function exactShelfCount(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  shelf: Shelf,
) {
  const row = await shelfCounts(ctx, userId);
  if (row?.ready) return shelf === "savedArticles" ? row.saved : row.loved;
  // Compatibility for already-open clients. Never return a truncated number.
  let n = 0;
  for await (const _ of ctx.db
    .query(shelf)
    .withIndex("by_user", (q) => q.eq("userId", userId))) {
    if (++n > 4096)
      throw new Error("Shelf counts are updating. Please try again shortly.");
  }
  return n;
}
