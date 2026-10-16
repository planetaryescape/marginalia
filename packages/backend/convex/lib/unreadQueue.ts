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
