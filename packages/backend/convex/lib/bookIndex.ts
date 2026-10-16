// How a book is indexed (D-DES-054, D-DES-055): a short summary per reading
// unit, the book's one point written from those summaries, and about
// 300-token passages embedded for search. Pure helpers; the queue is in
// bookIndex.ts and the model calls in actions/indexBook.ts.
import { z } from "zod";
import { estimateTokens, splitText } from "./pdf/sections";

/** Units indexed per book. Anything past it still reads; it just isn't searched. */
export const INDEX_UNIT_CAP = 1_500;
/** Jobs queued per batch, as the catch-up paces them (catchUp.ts). */
export const BATCH_JOBS = 5;
/** Tries for one unit's job, and for the book's one point. */
export const MAX_ATTEMPTS = 3;
/** A pending job older than this has lost its action (an action runs at most 10 minutes). */
export const CLAIM_TTL_MS = 20 * 60_000;
/** A running index whose last step is older than this has lost its schedule. */
export const STALE_MS = 10 * 60_000;

/** A unit shorter than this has nothing worth a summary (a title page, a divider). */
export const MIN_SUMMARY_WORDS = 60;
/** The model reads this much of one unit at most; units are usually 1,500–4,000 tokens. */
export const SUMMARY_INPUT_CHARS = 24_000;

/** About 300 tokens (1,200 characters at four a token), the size S8 settled on. */
export const PASSAGE_TOKENS = 300;
const PASSAGE_CHARS = PASSAGE_TOKENS * 4;
/** Texts per embeddings request. */
export const EMBED_BATCH = 64;
/** Passages written per mutation, about 14 KB each with their vectors. */
export const WRITE_BATCH = 40;
/** The most passages one unit makes: 400 KB of text is about 335. */
export const MAX_PASSAGES_PER_UNIT = 400;

/** Characters of one unit's summary sent as background, and of the whole outline. */
const OUTLINE_SUMMARY_CHARS = 320;
export const OUTLINE_CHARS = 14_000;

export const unitSummarySchema = z.object({
  summary: z
    .string()
    .describe(
      "One or two plain sentences, under 45 words: what this part of the book covers and the point it makes.",
    ),
});

export const bookOverviewSchema = z.object({
  thesis: z
    .string()
    .describe("The book's main point in one sentence, under 25 words."),
  gist: z
    .string()
    .describe(
      "Two or three sentences, under 70 words: what the book argues or covers and why it matters.",
    ),
});

export const SUMMARY_SYSTEM = `You summarise one part of a longer book for a reader's outline. You are given the book's title and the text of a single part. Write one or two plain sentences saying what this part covers and the point it makes. Describe only this part; do not guess at the rest of the book. No preamble, no "this chapter".`;

export const OVERVIEW_SYSTEM = `You write the main point of a book from the short summaries of its parts. You are given the book's title and its parts in order, each with a summary. Give the book's one point in a sentence, and a short gist of what it argues or covers. Use only what the summaries say.`;

export function summaryPrompt(input: {
  bookTitle: string;
  unitTitle: string;
  chapter?: string;
  unitNumber: number;
  unitCount: number;
  text: string;
}): string {
  const where = input.chapter
    ? `${input.chapter} › ${input.unitTitle}`
    : input.unitTitle;
  return [
    `Book: ${input.bookTitle}`,
    `Part ${input.unitNumber} of ${input.unitCount}: ${where}`,
    "",
    "<part>",
    input.text.slice(0, SUMMARY_INPUT_CHARS),
    "</part>",
  ].join("\n");
}

export interface OutlineLine {
  title: string;
  summary?: string | null;
}

/**
 * The outline any call can carry cheaply: one line per part, its title and
 * summary where there is one. Cut to a budget by dropping summaries from the
 * far end first, so a long book keeps every title and the nearest summaries.
 */
export function outlineText(
  lines: readonly OutlineLine[],
  options: { around?: number; budget?: number } = {},
): string {
  const budget = options.budget ?? OUTLINE_CHARS;
  const around = options.around ?? 0;
  const render = (withSummary: (index: number) => boolean) =>
    lines
      .map((line, index) => {
        const head = `Part ${index + 1}: ${line.title}`;
        const summary = line.summary?.trim();
        return summary && withSummary(index)
          ? `${head}. ${summary.slice(0, OUTLINE_SUMMARY_CHARS)}`
          : head;
      })
      .join("\n");
  let text = render(() => true);
  if (text.length <= budget) return text;
  // Summaries nearest the part on screen survive longest: the most that fit
  const byDistance = lines
    .map((_, index) => index)
    .sort((a, b) => Math.abs(a - around) - Math.abs(b - around));
  const renderKeeping = (count: number) => {
    const keep = new Set(byDistance.slice(0, count));
    return render((index) => keep.has(index));
  };
  let low = 0;
  let high = byDistance.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (renderKeeping(mid).length <= budget) low = mid;
    else high = mid - 1;
  }
  text = renderKeeping(low);
  return text.slice(0, budget);
}

export function overviewPrompt(
  bookTitle: string,
  lines: readonly OutlineLine[],
): string {
  return [
    `Book: ${bookTitle}`,
    "",
    "<parts>",
    outlineText(lines),
    "</parts>",
  ].join("\n");
}

export interface Passage {
  heading: string;
  text: string;
}

/**
 * Cuts a unit's text into passages of about 300 tokens at paragraph breaks,
 * each carrying the unit's heading. A paragraph over the size is split at
 * sentences. The heading is stored with the passage and embedded with it, so a
 * match knows which part it came from.
 */
export function chunkPassages(
  heading: string,
  content: string,
  maxChars = PASSAGE_CHARS,
): Passage[] {
  const passages: Passage[] = [];
  let current = "";
  const close = () => {
    const text = current.trim();
    if (text) passages.push({ heading, text });
    current = "";
  };
  for (const paragraph of content.split(/\n{2,}/)) {
    const text = paragraph.replace(/\s+/g, " ").trim();
    if (!text) continue;
    for (const piece of text.length > maxChars
      ? splitText(text, maxChars)
      : [text]) {
      if (current && current.length + piece.length + 2 > maxChars) close();
      current += current ? `\n\n${piece}` : piece;
    }
  }
  close();
  return passages.slice(0, MAX_PASSAGES_PER_UNIT);
}

/** What a passage is embedded as: its heading, then its words. */
export const passageEmbedText = (passage: Passage) =>
  `${passage.heading}\n\n${passage.text}`;

export function inBatches<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let at = 0; at < items.length; at += size)
    batches.push(items.slice(at, at + size));
  return batches;
}

/** Tokens a unit's passages come to, for cost notes and tests. */
export const passageTokens = (passages: readonly Passage[]) =>
  passages.reduce((sum, p) => sum + estimateTokens(passageEmbedText(p)), 0);

/** The heading a unit's passages are filed under. */
export const unitHeading = (
  bookTitle: string,
  unit: { title: string; chapter?: string },
) => [bookTitle, unit.chapter, unit.title].filter(Boolean).join(" › ");
