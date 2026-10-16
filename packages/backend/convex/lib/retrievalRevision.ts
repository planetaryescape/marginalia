import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * One counter per reader, bumped whenever something becomes (or stops being)
 * findable by the vector searches the margin draws on: a note, highlight,
 * thread, vault chunk or library article gaining or losing an embedding.
 * Those changes land after the row itself (embedding is a second write), and
 * a library article carries no edit time, so no timestamp in the fingerprint
 * would otherwise move for them.
 */
export async function retrievalRevision(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
): Promise<number> {
  const row = await ctx.db
    .query("retrievalRevisions")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  return row?.revision ?? 0;
}

export async function bumpRetrievalRevision(
  ctx: Pick<MutationCtx, "db">,
  userId: string,
): Promise<void> {
  const row = await ctx.db
    .query("retrievalRevisions")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (row)
    await ctx.db.patch("retrievalRevisions", row._id, {
      revision: row.revision + 1,
    });
  else await ctx.db.insert("retrievalRevisions", { userId, revision: 1 });
}
