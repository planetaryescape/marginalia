import type { Doc } from "../_generated/dataModel";
import { WORDS_PER_MINUTE } from "./constants";

const MAX_STORED_BYTES = 900_000;

/** Remove non-reading payloads before either storage or optional provider work. */
export function slimHtml(html: string): string {
  return html
    .replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(
      /<img\b[^>]*\bsrc\s*=\s*(?:"data:[^"]*"|'data:[^']*'|data:[^\s>]+)[^>]*>/gi,
      "",
    )
    .replace(/\s(style|srcset)=("[^"]*"|'[^']*')/gi, "");
}

export function fitsInStorage(html: string, text: string): boolean {
  const encoder = new TextEncoder();
  return (
    encoder.encode(html).length + encoder.encode(text).length < MAX_STORED_BYTES
  );
}

export function excerptOf(text: string): string {
  return text.slice(0, 300).replace(/[\uD800-\uDBFF]$/, "");
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function prepareImportContent(raw: string) {
  const contentHtml = slimHtml(raw.toWellFormed());
  const content = htmlToPlainText(contentHtml);
  if (!content || !fitsInStorage(contentHtml, content)) return null;
  const wordCount = content.split(/\s+/).length;
  return {
    contentHtml,
    content,
    excerpt: excerptOf(content),
    wordCount,
    estimatedReadMinutes: Math.ceil(wordCount / WORDS_PER_MINUTE),
  };
}

/** Leave headroom for the vector, claims and metadata, not just the two text fields. */
export function articleFitsStorage(value: Partial<Doc<"articles">>) {
  return (
    new TextEncoder().encode(JSON.stringify(value)).length < MAX_STORED_BYTES
  );
}

export function validateArticleSize(value: Partial<Doc<"articles">>) {
  if (!articleFitsStorage(value))
    throw new Error("Article is too large to store");
}
