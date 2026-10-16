"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useEffect } from "react";

/**
 * The reader's margin shows "Reading alongside you" only while annotation is
 * pending and the text is ready.
 */
export function marginNotesPending(article: {
  annotationStatus: string;
  extractionStatus: string;
}): boolean {
  return (
    article.annotationStatus === "pending" &&
    article.extractionStatus === "extracted"
  );
}

/**
 * Opening a long article whose marginalia were deferred starts them, whichever
 * way the reader got here. A failure leaves the article readable without notes.
 */
export function useStartAnnotation(
  articleId: Id<"articles">,
  annotationStatus: string | undefined,
) {
  const start = useMutation(api.articles.annotateAhead);
  useEffect(() => {
    if (annotationStatus !== "deferred") return;
    start({ articleIds: [articleId] }).catch(() => {});
  }, [articleId, annotationStatus, start]);
}
