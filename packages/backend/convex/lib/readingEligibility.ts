import type { FilterBuilder } from "convex/server";
import type { DataModel, Doc } from "../_generated/dataModel";

export const UNREAD_STATUSES = ["annotated", "deferred", "skipped"] as const;

/** Annotation skipping is independent of reading: short text is readable too. */
export function queuedForReading(article: Doc<"articles">): boolean {
  return (
    article.extractionStatus === "extracted" &&
    Boolean(article.content) &&
    article.bookUnitCount === undefined &&
    article.bible === undefined &&
    UNREAD_STATUSES.some((status) => status === article.annotationStatus)
  );
}

// Keep predicates on the database range, before take/paginate. Invalid source
// rows must not consume all of a page's returned candidate allowance.
export function readableArticleFilter(q: FilterBuilder<DataModel["articles"]>) {
  return q.and(
    q.eq(q.field("extractionStatus"), "extracted"),
    q.neq(q.field("content"), undefined),
    q.neq(q.field("content"), ""),
    q.eq(q.field("bookUnitCount"), undefined),
    q.eq(q.field("bible"), undefined),
  );
}

export function readableMetadataFilter(
  q: FilterBuilder<DataModel["articleMetadata"]>,
) {
  return q.and(
    q.eq(q.field("extractionStatus"), "extracted"),
    q.eq(q.field("hasContent"), true),
    q.eq(q.field("bookUnitCount"), undefined),
    q.eq(q.field("bible"), undefined),
  );
}
