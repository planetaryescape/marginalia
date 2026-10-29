import { z } from "zod";
import { BIBLE_BOOKS, type BibleReference } from "./bible";

export const SCRIPTURE_STUDY_SOURCE_POLICY_REVISION = "2026-10-29.1";
export const SCRIPTURE_STUDY_SOURCE_LIMITS = {
  commentaryBytes: 4 * 1024 * 1024,
  variantsBytes: 2 * 1024 * 1024,
  commentaryNotes: 6,
  commentaryExcerptChars: 1800,
  relatedReferencesPerNote: 12,
  variantsPerVerse: 8,
  timeoutMs: 20_000,
} as const;

export const SCRIPTURE_STUDY_SOURCE_NOTICES = {
  aquifer: {
    id: "aquifer-open-study-notes",
    revision: "35183d839b73958deca66fe4060d4dc7d4dc23de",
    title: "Aquifer Open Study Notes (adapted from Tyndale Open Study Notes)",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    attribution:
      "Adapted from Tyndale Open Study Notes © 2023 Tyndale House Publishers by Mission Mutual © 2026; CC BY-SA 4.0.",
    changesNotice:
      "Retrieved by canonical reference, converted from HTML to plain text, and excerpted to 1,800 characters.",
  },
  byzTxt: {
    id: "byztxt-printed-edition-variants",
    revision: "27a45ff1b7be6c17ccbfeac414f3f55732ae8e28",
    title: "ByzTxt Robinson-Pierpont Greek text with printed-edition variants",
    license: "Unlicense",
    licenseUrl:
      "https://raw.githubusercontent.com/byztxt/byzantine-majority-text/27a45ff1b7be6c17ccbfeac414f3f55732ae8e28/LICENSE.txt",
    attribution:
      "ByzTxt / Robinson-Pierpont; source revision pinned in this record.",
  },
} as const;

export interface ScriptureStudySourceRecord {
  sourceId: string;
  title: string;
  revision: string;
  locator: string;
  referenceKey: string;
  excerpt: string;
  sourceUrl: string;
  contentHash: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  capabilities: string[];
  limitations: string[];
  relatedReferences?: string[];
  variant?: {
    printedEdition: string;
    baseReading: string;
    alternateReading: string;
  };
}

export interface ScriptureStudySourceLoad {
  records: ScriptureStudySourceRecord[];
  coverageWarnings: string[];
  policyRevision: typeof SCRIPTURE_STUDY_SOURCE_POLICY_REVISION;
}

export interface ScriptureStudySourceOptions {
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
}

export interface ParsedByzTxtVariant {
  code: string;
  edition: string;
  baseReading: string;
  alternateReading: string;
}

export interface ParsedByzTxtVerse {
  chapter: number;
  verse: number;
  sourceText: string;
  variants: ParsedByzTxtVariant[];
  variantsTruncated: boolean;
  hasUnparsedVariantSyntax: boolean;
}

export const rawAquifer = `https://raw.githubusercontent.com/BibleAquifer/AquiferOpenStudyNotes/${SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.revision}/eng/json/`;
export const rawByzTxt = `https://raw.githubusercontent.com/byztxt/byzantine-majority-text/${SCRIPTURE_STUDY_SOURCE_NOTICES.byzTxt.revision}/csv-unicode/ccat/with-variants/`;

const commentaryItemSchema = z.object({
  content_id: z.string().min(1),
  reference_id: z.number().int(),
  version: z.string().min(1),
  title: z.string().min(1),
  media_type: z.literal("Text"),
  index_reference: z.string().min(1),
  language: z.literal("eng"),
  review_level: z.string(),
  content: z.string(),
  associations: z.object({
    passage: z.array(
      z.object({
        start_ref_usfm: z.string().min(1),
        end_ref_usfm: z.string().min(1),
        start_ref: z.string().regex(/^\d{8}$/),
        end_ref: z.string().regex(/^\d{8}$/),
      }),
    ),
  }),
});

export const commentaryFileSchema = z.array(commentaryItemSchema);
export function referenceKey(bookId: string, chapter: number, verse: number) {
  return `${bookId}.${chapter}.${verse}`;
}

export function referenceRangeKey(
  bookId: string,
  startChapter: number,
  startVerse: number,
  endChapter: number,
  endVerse: number,
) {
  const start = referenceKey(bookId, startChapter, startVerse);
  const end = referenceKey(bookId, endChapter, endVerse);
  return start === end ? start : `${start}-${end}`;
}

export function parseUsfmReference(value: string) {
  const match = /^([1-3]?[A-Z0-9]{2,3})\s+(\d{1,3}):(\d{1,3})$/.exec(
    value.trim(),
  );
  if (!match) return null;
  return {
    book: match[1],
    chapter: Number(match[2]),
    verse: Number(match[3]),
  };
}

function numericReference(bookIndex: number, chapter: number, verse: number) {
  return `${String(bookIndex + 1).padStart(2, "0")}${String(chapter).padStart(3, "0")}${String(verse).padStart(3, "0")}`;
}

export function validPassageAssociation(
  association: z.infer<
    typeof commentaryItemSchema
  >["associations"]["passage"][number],
  bookId: string,
  bookIndex: number,
) {
  const start = parseUsfmReference(association.start_ref_usfm);
  const end = parseUsfmReference(association.end_ref_usfm);
  return Boolean(
    start &&
      end &&
      start.book === bookId &&
      end.book === bookId &&
      start.chapter >= 1 &&
      end.chapter <= BIBLE_BOOKS[bookIndex][2] &&
      start.chapter === end.chapter &&
      start.verse >= 1 &&
      end.verse <= 176 &&
      start.verse <= end.verse &&
      association.start_ref ===
        numericReference(bookIndex, start.chapter, start.verse) &&
      association.end_ref ===
        numericReference(bookIndex, end.chapter, end.verse),
  );
}

export function referenceOverlaps(
  startBook: string,
  startChapter: number,
  startVerse: number,
  endBook: string,
  endChapter: number,
  endVerse: number,
  reference: BibleReference,
) {
  return (
    reference.verse !== undefined &&
    reference.endChapter === reference.chapter &&
    startBook === reference.bookId &&
    endBook === reference.bookId &&
    startChapter === reference.chapter &&
    endChapter === reference.chapter &&
    startVerse <= (reference.endVerse ?? reference.verse) &&
    endVerse >= reference.verse
  );
}

export function relatedReferencesFromHtml(
  html: string,
  reference: BibleReference,
) {
  const candidates = new Set<string>();
  for (const match of html.matchAll(
    /<data\b([^>]*)>(?:[\s\S]*?)<\/data\s*>/gi,
  )) {
    const attributes = new Map<string, string>();
    for (const attribute of match[1].matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g))
      attributes.set(attribute[1].toLowerCase(), attribute[3]);
    if (!attributes.get("class")?.split(/\s+/).includes("bible-ref")) continue;
    const start = parseNumericReference(attributes.get("data-start-ref"));
    const end = parseNumericReference(attributes.get("data-end-ref"));
    if (
      !start ||
      !end ||
      start.book !== end.book ||
      start.chapter !== end.chapter
    )
      continue;
    if (
      referenceOverlaps(
        start.book,
        start.chapter,
        start.verse,
        end.book,
        end.chapter,
        end.verse,
        reference,
      )
    )
      continue;
    candidates.add(
      referenceRangeKey(
        start.book,
        start.chapter,
        start.verse,
        end.chapter,
        end.verse,
      ),
    );
    if (
      candidates.size >= SCRIPTURE_STUDY_SOURCE_LIMITS.relatedReferencesPerNote
    )
      break;
  }
  return [...candidates].sort((a, b) => {
    const contextScore = (key: string) => {
      const match = /^([1-3]?[A-Z]{2,3})\.(\d+)\./.exec(key);
      if (!match) return 0;
      if (
        match[1] === reference.bookId &&
        Number(match[2]) === reference.chapter
      )
        return -100;
      return match[1] === reference.bookId &&
        Math.abs(Number(match[2]) - reference.chapter) <= 1
        ? 2
        : 0;
    };
    return contextScore(b) - contextScore(a);
  });
}

function parseNumericReference(value: string | undefined) {
  if (!value || !/^\d{8}$/.test(value)) return null;
  const bookIndex = Number(value.slice(0, 2)) - 1;
  const book = BIBLE_BOOKS[bookIndex];
  const chapter = Number(value.slice(2, 5));
  const verse = Number(value.slice(5, 8));
  if (!book || chapter < 1 || chapter > book[2] || verse < 1 || verse > 176)
    return null;
  return { book: book[0], chapter, verse };
}

export function plainTextFromHtml(html: string) {
  const withoutNonText = html
    .replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]*>/g, " ");
  return withoutNonText
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity) => {
      const name = entity.slice(1, -1).toLowerCase();
      if (name === "amp") return "&";
      if (name === "lt") return "<";
      if (name === "gt") return ">";
      if (name === "quot") return '"';
      if (name === "apos") return "'";
      if (name === "nbsp") return " ";
      const codePoint = name.startsWith("#x")
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10);
      return Number.isInteger(codePoint) &&
        codePoint > 0 &&
        codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

async function boundedBody(
  response: Response,
  byteLimit: number,
  signal: AbortSignal,
) {
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > byteLimit) {
    await response.body?.cancel();
    throw new Error("Source response exceeds the byte limit.");
  }
  if (!response.body) throw new Error("Source response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abortRead = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  if (signal.aborted) abortRead();
  else signal.addEventListener("abort", abortRead, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (done) break;
      total += value.byteLength;
      if (total > byteLimit) {
        await reader.cancel();
        throw new Error("Source response exceeds the byte limit.");
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function getSourceText(
  url: string,
  byteLimit: number,
  options: ScriptureStudySourceOptions,
) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const signal = options.signal
    ? AbortSignal.any([
        options.signal,
        AbortSignal.timeout(SCRIPTURE_STUDY_SOURCE_LIMITS.timeoutMs),
      ])
    : AbortSignal.timeout(SCRIPTURE_STUDY_SOURCE_LIMITS.timeoutMs);
  const response = await fetcher(url, { redirect: "error", signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Source returned HTTP ${response.status}.`);
  }
  return boundedBody(response, byteLimit, signal);
}

export async function sourceHash(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
