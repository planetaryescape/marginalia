// Ask about the article (D-DES-054): a question about a long article can't
// carry the article. It carries the summary (added by the prompt), the
// opening, the paragraph on screen or cited, and the passages the question
// matches. Passages are runs of whole paragraphs, so ¶ numbers stay real.
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { retrievalQuery } from "./bookAsk";
import {
  type EmbeddingTarget,
  embeddingModel,
  embedText,
  embedTexts,
} from "./embeddings";
import { sha256Hex } from "./tokens";

/** At or under this, the whole article is sent as before (about 3,000 tokens). */
export const ASK_FULL_TEXT_CHARS = 12_000;
/** The most article text a retrieved question carries. */
export const ASK_BUDGET_CHARS = 16_000;
/** About 300 tokens; a paragraph is never split, so a passage can run over. */
export const PASSAGE_TARGET_CHARS = 1_200;
/** Caps what one article stores; a longer one gets bigger passages instead. */
export const MAX_PASSAGES = 200;
/** The most passages a question takes, if the budget has room. */
export const MAX_RETRIEVED_PASSAGES = 10;
/** A longer paragraph is clipped, so one block can't use the whole budget. */
export const MAX_PARAGRAPH_CHARS = 4_000;
/** Without a search: the summary, what is pinned, and this much from the top. */
export const FALLBACK_HEAD_CHARS = 8_000;

const EMBED_BATCH = 64;
const EMBED_INPUT_CHARS = 8_000;

export interface PassageSpan {
  /** Paragraph indices, inclusive, counted from 0. */
  start: number;
  end: number;
}

export interface RankedPassage extends PassageSpan {
  score: number;
}

/** Runs of whole paragraphs of about `PASSAGE_TARGET_CHARS`, in order. */
export function chunkParagraphs(paragraphs: readonly string[]): PassageSpan[] {
  const total = paragraphs.reduce((sum, p) => sum + p.length, 0);
  const target = Math.max(
    PASSAGE_TARGET_CHARS,
    Math.ceil(total / MAX_PASSAGES),
  );
  const spans: PassageSpan[] = [];
  let start = 0;
  let size = 0;
  for (const [i, paragraph] of paragraphs.entries()) {
    if (i > start && size + paragraph.length > target) {
      spans.push({ start, end: i - 1 });
      start = i;
      size = 0;
    }
    size += paragraph.length;
  }
  if (paragraphs.length) spans.push({ start, end: paragraphs.length - 1 });
  return spans;
}

const CITATION = /¶\s*(\d+)(?:\s*[–-]\s*(\d+))?/g;
const MAX_CITED_RANGE = 5;

/** Paragraph indices (from 0) the text cites as ¶N or ¶N–M. */
export function citedParagraphs(text: string, count: number): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(CITATION)) {
    const first = Number(match[1]);
    const last = Math.min(
      match[2] ? Number(match[2]) : first,
      first + MAX_CITED_RANGE - 1,
    );
    for (let n = first; n <= last; n++)
      if (n >= 1 && n <= count) found.push(n - 1);
  }
  return found;
}

export interface BudgetedSelection {
  indices: number[];
  /** The paragraphs, with any over `MAX_PARAGRAPH_CHARS` clipped. */
  paragraphs: string[];
  chars: number;
}

const clip = (text: string) =>
  text.length > MAX_PARAGRAPH_CHARS
    ? `${text.slice(0, MAX_PARAGRAPH_CHARS)}…`
    : text;

/**
 * The paragraphs to send within `budget`: the pinned ones first (up to half
 * the budget), then the ranked passages, best first, each only if it fits.
 * With no ranking, the article from the top fills `headChars`.
 */
export function selectWithinBudget(input: {
  paragraphs: readonly string[];
  pinned: readonly number[];
  ranked: readonly PassageSpan[] | null;
  budget?: number;
  headChars?: number;
}): BudgetedSelection {
  const budget = input.budget ?? ASK_BUDGET_CHARS;
  const texts = input.paragraphs.map(clip);
  const picked = new Set<number>();
  let used = 0;
  const take = (i: number, limit: number) => {
    if (picked.has(i) || i < 0 || i >= texts.length) return true;
    if (used + texts[i].length > limit) return false;
    picked.add(i);
    used += texts[i].length;
    return true;
  };
  for (const i of input.pinned) take(i, budget / 2);

  if (input.ranked) {
    let taken = 0;
    for (const span of input.ranked) {
      if (taken >= MAX_RETRIEVED_PASSAGES) break;
      let size = 0;
      for (let i = span.start; i <= span.end; i++)
        if (!picked.has(i)) size += texts[i].length;
      if (used + size > budget) continue;
      for (let i = span.start; i <= span.end; i++) take(i, budget);
      taken++;
    }
  } else {
    const head = input.headChars ?? FALLBACK_HEAD_CHARS;
    for (let i = 0; i < texts.length && take(i, head); i++);
  }
  return {
    indices: [...picked].sort((a, b) => a - b),
    paragraphs: texts,
    chars: used,
  };
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Passages best-matching first. */
export function rankPassages(
  spans: readonly PassageSpan[],
  vectors: readonly (readonly number[])[],
  query: readonly number[],
): RankedPassage[] {
  return spans
    .map((span, i) => ({ ...span, score: cosine(vectors[i], query) }))
    .sort((a, b) => b.score - a.score || a.start - b.start);
}

/** The paragraphs a question needs whatever it matches. */
export function pinnedParagraphs(input: {
  paragraphCount: number;
  paragraphIndex: number | null;
  question: string;
  history: readonly { role: string; content: string }[];
}): number[] {
  const { paragraphCount: count } = input;
  const recent = input.history.slice(-2).map((turn) => turn.content);
  return [
    ...(count ? [0] : []),
    ...(input.paragraphIndex !== null && input.paragraphIndex < count
      ? [input.paragraphIndex]
      : []),
    ...citedParagraphs(input.question, count),
    ...recent.flatMap((text) => citedParagraphs(text, count)),
  ];
}

export type AskContextMode = "full" | "retrieved" | "fallback";

export interface ArticleAskContext {
  mode: AskContextMode;
  charsBefore: number;
  charsAfter: number;
  /** Null when the whole article goes, as it always has. */
  selection: BudgetedSelection | null;
}

/** What it takes to hold the article's passages: sent text, hash, vectors. */
async function passageVectors(
  ctx: ActionCtx,
  input: {
    userId: string;
    articleId: string;
    paragraphs: readonly string[];
    embedder: EmbeddingTarget;
  },
  spans: readonly PassageSpan[],
): Promise<number[][] | null> {
  const model = embeddingModel(input.embedder.provider);
  const contentHash = await sha256Hex(input.paragraphs.join("\u0000"));
  const cache = await ctx.runQuery(internal.articlePassages.cached, {
    userId: input.userId,
    articleId: input.articleId,
    contentHash,
    model,
  });
  // Not this reader's article: nothing is embedded or stored for it
  if (!cache) return null;
  const same =
    cache.passages.length === spans.length &&
    cache.passages.every(
      (row, i) =>
        row.startParagraph === spans[i].start &&
        row.endParagraph === spans[i].end,
    );
  if (same) return cache.passages.map((row) => row.embedding);

  const texts = spans.map((span) =>
    input.paragraphs
      .slice(span.start, span.end + 1)
      .join("\n\n")
      .slice(0, EMBED_INPUT_CHARS),
  );
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH)
    vectors.push(
      ...(await embedTexts(input.embedder, texts.slice(i, i + EMBED_BATCH))),
    );
  try {
    await ctx.runMutation(internal.articlePassages.replace, {
      userId: input.userId,
      articleId: cache.articleId,
      contentHash,
      model,
      passages: spans.map((span, i) => ({
        startParagraph: span.start,
        endParagraph: span.end,
        embedding: vectors[i],
      })),
    });
  } catch (error) {
    // The question is still answered from these vectors; the next one re-embeds
    console.error("Caching the article's passages failed:", error);
  }
  return vectors;
}

/**
 * What a question about the whole article carries. A short article keeps its
 * whole text. A long one gets the pinned paragraphs and the passages that match
 * the question; if the search can't run (no embedding key, a failing provider,
 * an article that isn't this reader's), the summary, the pinned paragraphs and
 * the top of the article, without any error for the reader.
 */
export async function retrieveArticleContext(
  ctx: ActionCtx,
  input: {
    userId: string;
    articleId: string | undefined;
    paragraphs: readonly string[];
    paragraphIndex: number | null;
    question: string;
    history: readonly { role: "user" | "assistant"; content: string }[];
    embedder: EmbeddingTarget | null;
  },
): Promise<ArticleAskContext> {
  const charsBefore = input.paragraphs.reduce((sum, p) => sum + p.length, 0);
  if (charsBefore <= ASK_FULL_TEXT_CHARS)
    return {
      mode: "full",
      charsBefore,
      charsAfter: charsBefore,
      selection: null,
    };

  const pinned = pinnedParagraphs({
    paragraphCount: input.paragraphs.length,
    paragraphIndex: input.paragraphIndex,
    question: input.question,
    history: input.history,
  });
  let ranked: RankedPassage[] | null = null;
  try {
    if (input.embedder && input.articleId) {
      const spans = chunkParagraphs(input.paragraphs);
      const vectors = await passageVectors(
        ctx,
        { ...input, articleId: input.articleId, embedder: input.embedder },
        spans,
      );
      if (vectors) {
        const query = await embedText(
          input.embedder,
          retrievalQuery(input.question, input.history),
        );
        ranked = rankPassages(spans, vectors, query);
      }
    }
  } catch (error) {
    console.error(
      "Searching the article failed, answering from its summary and opening:",
      error,
    );
  }
  const selection = selectWithinBudget({
    paragraphs: input.paragraphs,
    pinned,
    ranked,
  });
  return {
    mode: ranked ? "retrieved" : "fallback",
    charsBefore,
    charsAfter: selection.chars,
    selection,
  };
}
