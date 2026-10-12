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

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stores an article that already has its HTML (pasted URL or Readwise Reader),
 * embeds it, and queues its marginalia.
 */
export async function ingestArticle(
  ctx: ActionCtx,
  userId: string,
  article: {
    url: string;
    title: string;
    html: string;
    author?: string;
    publishedAt?: number;
    imageUrl?: string;
    readerDocumentId?: string;
  },
  options: { annotateAfterMs?: number } = {},
): Promise<Id<"articles"> | null> {
  const html = slimHtml(article.html);
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

  const articleId: Id<"articles"> = await ctx.runMutation(
    internal.articles.insertExtracted,
    {
      userId,
      guid: article.url,
      url: article.url,
      title: article.title || article.url,
      author: article.author,
      publishedAt: article.publishedAt,
      content: plainText,
      contentHtml: html,
      excerpt: plainText.slice(0, 300),
      wordCount,
      estimatedReadMinutes: Math.ceil(wordCount / WORDS_PER_MINUTE),
      imageUrl: article.imageUrl,
      embedding,
      readerDocumentId: article.readerDocumentId,
      annotateAfterMs: options.annotateAfterMs,
    },
  );

  return articleId;
}
