"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { usePaginatedQuery } from "convex/react";

/** Reader-page seam: skip until article classification and book unit resolve.
 * The first page immediately supplies margin text/anchors, not empty markers.
 * Do not treat the loaded lengths as exact counts when `hasMore` is true. */
export function useReaderPreviews(
  articleId: Id<"articles">,
  unitIndex: number | undefined,
  enabled: boolean,
) {
  const args = enabled ? { articleId, unitIndex } : "skip";
  const annotations = usePaginatedQuery(
    api.annotations.listPresentationByArticle,
    args,
    { initialNumItems: 50 },
  );
  const notes = usePaginatedQuery(api.userNotes.listPreviewsByArticle, args, {
    initialNumItems: 25,
  });
  const threads = usePaginatedQuery(
    api.companionThreads.listPreviewsByArticle,
    args,
    { initialNumItems: 25 },
  );
  const marks = usePaginatedQuery(
    api.highlights.listPresentationByArticle,
    args,
    { initialNumItems: 50 },
  );
  const collections = [annotations, notes, threads, marks];
  return {
    annotations:
      annotations.status === "LoadingFirstPage"
        ? undefined
        : annotations.results,
    notes: notes.status === "LoadingFirstPage" ? undefined : notes.results,
    threads:
      threads.status === "LoadingFirstPage" ? undefined : threads.results,
    marks: marks.status === "LoadingFirstPage" ? undefined : marks.results,
    hasMore: collections.some(
      (collection) =>
        collection.status === "CanLoadMore" ||
        collection.status === "LoadingMore",
    ),
    loadingMore: collections.some(
      (collection) => collection.status === "LoadingMore",
    ),
    loadMore: () => {
      for (const collection of collections)
        if (collection.status === "CanLoadMore") collection.loadMore(25);
    },
  };
}
