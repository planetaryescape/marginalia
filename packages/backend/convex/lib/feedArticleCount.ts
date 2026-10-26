import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Moves a feed's articleCount with an article inserted or deleted. A feed whose
 * count was never set (not yet backfilled) stays unset: adding to nothing would
 * show a wrong number. Reading and patching the feed in the caller's own
 * transaction keeps concurrent inserts from losing an update.
 */
export async function bumpFeedArticleCount(
  ctx: MutationCtx,
  feedId: Id<"feeds"> | undefined,
  userId: string,
  delta: 1 | -1,
): Promise<void> {
  if (!feedId) return;
  const feed = await ctx.db.get("feeds", feedId);
  if (feed?.userId !== userId || feed.articleCount === undefined) return;
  await ctx.db.patch("feeds", feedId, {
    articleCount: Math.max(0, feed.articleCount + delta),
  });
}
