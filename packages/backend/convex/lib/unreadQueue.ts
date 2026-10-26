import type { Doc } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { readableArticleFilter, UNREAD_STATUSES } from "./readingEligibility";

/** Readable unfinished articles, newest first, independent of marginalia. */
export async function unreadQueue(
  ctx: { db: DatabaseReader; readerId: string },
  limit: number,
): Promise<Doc<"articles">[]> {
  const lists = await Promise.all(
    UNREAD_STATUSES.map((status) =>
      ctx.db
        .query("articles")
        .withIndex("by_user_annotationStatus_finishedAt", (q) =>
          q
            .eq("userId", ctx.readerId)
            .eq("annotationStatus", status)
            .eq("finishedAt", undefined),
        )
        .order("desc")
        .filter(readableArticleFilter)
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
