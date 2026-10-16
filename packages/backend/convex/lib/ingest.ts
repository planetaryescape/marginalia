"use node";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { WORDS_PER_MINUTE } from "./constants";
import { embedForLibrary } from "./router";

// Convex documents max out at 1 MiB, and the article stores both HTML and text
const MAX_STORED_BYTES = 900_000;

/** Drops the heavy, non-reading parts of saved HTML: inline images, SVG, scripts, styles. */
export function slimHtml(html: string): string {
  return html
    .replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<img[^>]+src=["']data:[^"']*["'][^>]*>/gi, "")
    .replace(/\s(style|srcset)=("[^"]*"|'[^']*')/gi, "");
}

export function fitsInStorage(html: string, text: string): boolean {
  return Buffer.byteLength(html) + Buffer.byteLength(text) < MAX_STORED_BYTES;
}

/**
 * The first 300 characters, without a half emoji at the cut. Convex rejects
 * strings holding an unpaired surrogate with "Invalid arguments provided".
 */
export function excerptOf(plainText: string): string {
  return plainText.slice(0, 300).replace(/[\uD800-\uDBFF]$/, "");
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stores an article that already has its HTML (pasted URL, Readwise Reader or
 * another app through the API), embeds it, and queues its marginalia. The
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
  // Saved pages can carry broken emoji, which Convex refuses to store
  const html = slimHtml(article.html.toWellFormed());
  const plainText = htmlToPlainText(html);
  if (!fitsInStorage(html, plainText)) {
    console.warn(
      `Skipped "${article.title}": too large to store even after slimming`,
    );
    return null;
  }
  const wordCount = plainText.split(/\s+/).length;

  let embedding: number[] | undefined;
  try {
    // Left unembedded (for a later backfill) when the library has no embedding key
    embedding = (
      await embedForLibrary(ctx, userId, [plainText.slice(0, 8000)])
    )?.[0];
  } catch (error) {
    console.error("Embedding failed, continuing without:", error);
  }

  const row = {
    userId,
    guid: article.guid ?? article.url,
    url: article.url.toWellFormed(),
    title: (article.title || article.url).toWellFormed(),
    author: article.author?.toWellFormed(),
    publishedAt: article.publishedAt,
    content: plainText,
    contentHtml: html,
    excerpt: excerptOf(plainText),
    wordCount,
    estimatedReadMinutes: Math.ceil(wordCount / WORDS_PER_MINUTE),
    imageUrl: article.imageUrl?.toWellFormed(),
    embedding,
    readerDocumentId: article.readerDocumentId,
    uploadedFileName: article.uploadedFileName?.toWellFormed(),
    pageCount: article.pageCount,
    annotateAfterMs: options.annotateAfterMs,
  };
  // An uploaded PDF is written only while its import is live (documentImports.liveImport)
  const articleId: Id<"articles"> | null = article.importId
    ? await ctx.runMutation(internal.articles.insertImported, {
        ...row,
        importId: article.importId,
      })
    : await ctx.runMutation(internal.articles.insertExtracted, row);

  return articleId;
}
