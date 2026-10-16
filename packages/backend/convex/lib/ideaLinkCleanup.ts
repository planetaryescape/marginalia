import type { MutationCtx } from "../_generated/server";

const BATCH = 100;

/** Deletes every link the reader drew to or from an idea, in both directions. */
export async function deleteIdeaLinks(
  ctx: MutationCtx,
  userId: string,
  key: string,
) {
  const batches = [
    () =>
      ctx.db
        .query("ideaLinks")
        .withIndex("by_user_from_to", (q) =>
          q.eq("userId", userId).eq("from", key),
        )
        .take(BATCH),
    () =>
      ctx.db
        .query("ideaLinks")
        .withIndex("by_user_to", (q) => q.eq("userId", userId).eq("to", key))
        .take(BATCH),
  ];
  for (const next of batches) {
    for (;;) {
      const rows = await next();
      for (const row of rows) await ctx.db.delete("ideaLinks", row._id);
      if (rows.length < BATCH) break;
    }
  }
}
