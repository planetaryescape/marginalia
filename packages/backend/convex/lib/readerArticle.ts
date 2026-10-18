import type { Doc } from "../_generated/dataModel";

/** Additive reader DTO. Saved extraction HTML/text remains authoritative.
 * Deliberately excludes vectors, source payloads, leases and operational state.
 */
export function readerArticle(article: Doc<"articles">) {
  return {
    _id: article._id,
    title: article.title,
    url: article.url,
    author: article.author,
    content: article.content,
    contentHtml: article.contentHtml,
    wordCount: article.wordCount,
    estimatedReadMinutes: article.estimatedReadMinutes,
    annotationStatus: article.annotationStatus,
    extractionStatus: article.extractionStatus,
    uploadedFileName: article.uploadedFileName,
    bookUnitCount: article.bookUnitCount,
    finishedAt: article.finishedAt,
  };
}
