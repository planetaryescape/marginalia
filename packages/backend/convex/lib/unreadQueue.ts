import type { Doc } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";

/**
 * The reader's unread, queued articles, newest first: annotated ones and the
 * long ones whose marginalia are deferred until the desk offers them. Both are
 * waiting to be read, so both belong in every list and count of the queue.
 */
export async function unreadQueue(
  ctx: { db: DatabaseReader; readerId: string },
  limit: number,
): Promise<Doc<"articles">[]> {
  const lists = await Promise.all(
    (["annotated", "deferred"] as const).map((status) =>
      ctx.db
        .query("articles")
        .withIndex("by_user_annotationStatus_finishedAt", (q) =>
          q
            .eq("userId", ctx.readerId)
            .eq("annotationStatus", status)
            .eq("finishedAt", undefined),
        )
        .order("desc")
        .take(limit),
    ),
  );
  // Each list is newest first; the id breaks a creation-time tie
  return lists
    .flat()
    .sort(
      (a, b) => b._creationTime - a._creationTime || (a._id < b._id ? -1 : 1),
    )
    .slice(0, limit);
}

/** The most rows one page of the queue may read per status, whatever the client asks. */
export const QUEUE_PAGE_MAX = 100;

/**
 * One page of the same queue, newest first. The two statuses live in separate
 * index ranges, so Convex's own cursor can't walk both; the cursor here is the
 * creation time of the last row shown (exclusive). `through` is the creation
 * time of a page's last row, which keeps a page that is already on screen the
 * same size when newer articles arrive above it.
 */
export async function unreadQueuePage(
  ctx: { db: DatabaseReader; readerId: string },
  {
    after,
    through,
    numItems,
  }: { after: number | null; through: number | null; numItems: number },
): Promise<{ rows: Doc<"articles">[]; isDone: boolean }> {
  // A page already on screen keeps every row down to its last one, even when
  // newer articles have pushed it past the size it was asked for
  const limit =
    through !== null
      ? QUEUE_PAGE_MAX
      : Math.min(Math.max(1, Math.floor(numItems)), QUEUE_PAGE_MAX);
  const lists = await Promise.all(
    (["annotated", "deferred"] as const).map((status) =>
      ctx.db
        .query("articles")
        .withIndex("by_user_annotationStatus_finishedAt", (q) => {
          const range = q
            .eq("userId", ctx.readerId)
            .eq("annotationStatus", status)
            .eq("finishedAt", undefined);
          if (after !== null && through !== null)
            return range
              .gte("_creationTime", through)
              .lt("_creationTime", after);
          if (after !== null) return range.lt("_creationTime", after);
          if (through !== null) return range.gte("_creationTime", through);
          return range;
        })
        .order("desc")
        // One extra row says whether anything follows this page
        .take(limit + 1),
    ),
  );
  const rows = lists
    .flat()
    .sort(
      (a, b) => b._creationTime - a._creationTime || (a._id < b._id ? -1 : 1),
    );
  return { rows: rows.slice(0, limit), isDone: rows.length <= limit };
}
