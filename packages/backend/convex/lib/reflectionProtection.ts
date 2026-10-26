import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Only a pending, article-local removal proof is invalidated. Stable sources
 * incur no metadata write; the canonical reflection never grows. The same
 * transaction resets the scan for inserts/patches/replaces/deletes and moves,
 * including a new answered row inserted behind an established cursor. */
export async function invalidateReflectionProof(
  ctx: MutationCtx,
  before: Doc<"reflections"> | null,
  after: Doc<"reflections"> | null,
) {
  const articleIds = new Set([before?.articleId, after?.articleId]);
  for (const articleId of articleIds) {
    if (!articleId) continue;
    const job = await ctx.db
      .query("feedArticleCleanup")
      .withIndex("by_articleId", (q) => q.eq("articleId", articleId))
      .unique();
    if (job?.phase === "checking")
      await ctx.db.patch(job._id, {
        revision: job.revision + 1,
        cursor: undefined,
      });
  }
}
