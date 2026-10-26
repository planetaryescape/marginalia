// Marginalia cost real model time, so only articles the reader will realistically
// read are annotated straight away. Longer ones wait ("deferred") until the desk
// is about to offer them (D-DES-056).
export const ANNOTATE_AT_IMPORT_MAX_MINUTES = 20;

/** How many deferred articles one lookahead call may start. */
export const LOOKAHEAD_COUNT = 3;
/** Retries the desk or reader may start for an article whose annotation failed. */
export const MAX_ANNOTATION_RETRIES = 2;

/** Whether the desk or reader should start this article's marginalia. */
export function needsAnnotationStart(article: {
  annotationStatus: string;
  annotationRetries?: number;
}): boolean {
  if (article.annotationStatus === "deferred") return true;
  return (
    article.annotationStatus === "failed" &&
    (article.annotationRetries ?? 0) < MAX_ANNOTATION_RETRIES
  );
}

/** An article of exactly the limit is annotated at import. */
export function annotatesAtImport(estimatedReadMinutes: number): boolean {
  return estimatedReadMinutes <= ANNOTATE_AT_IMPORT_MAX_MINUTES;
}
