"use node";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { articleFitsStorage, prepareImportContent } from "./importContent";

export {
  excerptOf,
  fitsInStorage,
  htmlToPlainText,
  slimHtml,
} from "./importContent";

/**
 * Stores an article that already has its HTML (pasted URL, Readwise Reader or
 * another app through the API), and atomically queues indexing/marginalia. The
 * GUID defaults to the URL.
 */
export async function ingestArticle(
  ctx: ActionCtx,
  userId: string,
  article: {
    url: string;
    guid?: string;
    title: string;
    html: string;
    author?: string;
    publishedAt?: number;
    imageUrl?: string;
    readerDocumentId?: string;
    /** Set for a PDF the reader uploaded */
    uploadedFileName?: string;
    pageCount?: number;
    /** The import this article comes from; the write is refused if it is gone. */
    importId?: Id<"documentImports">;
  },
  options: { annotateAfterMs?: number } = {},
): Promise<Id<"articles"> | null> {
  const content = prepareImportContent(article.html);
  if (!content) return null;

  const row = {
    userId,
    guid: (article.guid ?? article.url).toWellFormed(),
    url: article.url.toWellFormed(),
    title: (article.title || article.url).toWellFormed(),
    author: article.author?.toWellFormed(),
    publishedAt: article.publishedAt,
    ...content,
    imageUrl: article.imageUrl?.toWellFormed(),
    readerDocumentId: article.readerDocumentId,
    uploadedFileName: article.uploadedFileName?.toWellFormed(),
    pageCount: article.pageCount,
    annotateAfterMs: options.annotateAfterMs,
  };
  if (!articleFitsStorage(row)) return null;
  // An uploaded PDF is written only while its import is live (documentImports.liveImport)
  const articleId: Id<"articles"> | null = article.importId
    ? await ctx.runMutation(internal.articles.insertImported, {
        ...row,
        importId: article.importId,
      })
    : await ctx.runMutation(internal.articles.insertExtracted, row);

  return articleId;
}
