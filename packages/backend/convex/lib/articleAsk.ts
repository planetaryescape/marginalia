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
import { requestAttempt } from "./requestControl";
import { sha256Hex } from "./tokens";

type PassageRunner = Pick<ActionCtx, "runQuery" | "runMutation">;

/** The most article text a retrieved question carries. */
export const ASK_BUDGET_CHARS = 16_000;
/** An article that fits the budget is sent whole, as before. */
export const ASK_FULL_TEXT_CHARS = ASK_BUDGET_CHARS;
/** About 300 tokens; a paragraph is never split, so a passage can run over. */
export const PASSAGE_TARGET_CHARS = 1_200;
/** Caps what one article stores; a longer one gets bigger passages instead. */
export const MAX_PASSAGES = 200;
/** The most passages a question takes, if the budget has room. */
export const MAX_RETRIEVED_PASSAGES = 10;
/** A paragraph longer than this is split into passages of its own. */
export const LONG_PARAGRAPH_CHARS = 4_000;
/** About how long each piece of a split paragraph is. */
const SPLIT_PIECE_CHARS = 2_000;

const EMBED_BATCH = 64;
const EMBED_INPUT_CHARS = 8_000;

export interface PassageSpan {
  /** Paragraph indices, inclusive, counted from 0. */
  start: number;
  end: number;
  /**
   * Where the passage begins in the first paragraph and ends in the last, in
   * characters. Whole paragraphs unless one was too long and was split.
   */
  from: number;
  to: number;
}

export interface RankedPassage extends PassageSpan {
  score: number;
}

/** The text a passage covers. */
export function passageText(
  paragraphs: readonly string[],
  span: PassageSpan,
): string {
  if (span.start === span.end)
    return paragraphs[span.start].slice(span.from, span.to);
  return paragraphs.slice(span.start, span.end + 1).join("\n\n");
}

/** A cut near `limit`, at a sentence or line end if one is in the back half. */
function cutPoint(text: string, from: number, limit: number): number {
  const end = Math.min(text.length, from + limit);
  if (end === text.length) return end;
  const window = text.slice(from + Math.floor(limit / 2), end);
  const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"));
  return cut > 0 ? from + Math.floor(limit / 2) + cut + 1 : end;
}

/**
 * Passages of whole paragraphs of about `PASSAGE_TARGET_CHARS`, in order. A
 * paragraph over `LONG_PARAGRAPH_CHARS` is split into passages of its own,
 * which keep its index so a reader's ¶ reference still finds it.
 */
export function chunkParagraphs(paragraphs: readonly string[]): PassageSpan[] {
  const total = paragraphs.reduce((sum, p) => sum + p.length, 0);
  const target = Math.max(
    PASSAGE_TARGET_CHARS,
    Math.ceil(total / MAX_PASSAGES),
  );
  const piece = Math.max(SPLIT_PIECE_CHARS, target);
  const spans: PassageSpan[] = [];
  let start = 0;
  let size = 0;
  const flush = (end: number) => {
    if (end >= start)
      spans.push({ start, end, from: 0, to: paragraphs[end].length });
  };
  for (const [i, paragraph] of paragraphs.entries()) {
    if (paragraph.length > LONG_PARAGRAPH_CHARS) {
      flush(i - 1);
      for (let from = 0; from < paragraph.length; ) {
        const to = cutPoint(paragraph, from, piece);
        spans.push({ start: i, end: i, from, to });
        from = to;
      }
      start = i + 1;
      size = 0;
      continue;
    }
    if (i > start && size + paragraph.length > target) {
      flush(i - 1);
      start = i;
      size = 0;
    }
    size += paragraph.length;
  }
  flush(paragraphs.length - 1);
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

/** A stretch of one paragraph, as sent. */
export interface Segment {
  index: number;
  from: number;
  to: number;
  /** The whole paragraph's length, to tell a partial stretch from a whole one. */
  length: number;
  text: string;
}

export interface BudgetedSelection {
  segments: Segment[];
  chars: number;
}

type Interval = [from: number, to: number];

/** Per paragraph, the stretches already chosen. */
class Chosen {
  private readonly byParagraph = new Map<number, Interval[]>();
  used = 0;

  constructor(private readonly lengths: readonly number[]) {}

  /** The parts of [from, to) of a paragraph not yet chosen. */
  gaps(index: number, from: number, to: number): Interval[] {
    const gaps: Interval[] = [];
    let at = from;
    for (const [a, b] of this.byParagraph.get(index) ?? []) {
      if (b <= at) continue;
      if (a >= to) break;
      if (a > at) gaps.push([at, a]);
      at = Math.max(at, b);
    }
    if (at < to) gaps.push([at, to]);
    return gaps;
  }

  size(index: number, from: number, to: number): number {
    return this.gaps(index, from, to).reduce((sum, [a, b]) => sum + b - a, 0);
  }

  /** Chooses what of [from, to) fits in `room`; returns false if it was cut short. */
  add(index: number, from: number, to: number, room: number): boolean {
    let whole = true;
    for (const [a, b] of this.gaps(index, from, to)) {
      const end = Math.min(b, a + Math.max(0, room - this.used));
      if (end < b) whole = false;
      if (end <= a) continue;
      const added: Interval = [a, end];
      const merged = [...(this.byParagraph.get(index) ?? []), added]
        .sort((x, y) => x[0] - y[0])
        .reduce<Interval[]>((out, [x, y]) => {
          const last = out.at(-1);
          if (last && x <= last[1]) last[1] = Math.max(last[1], y);
          else out.push([x, y]);
          return out;
        }, []);
      this.byParagraph.set(index, merged);
      this.used += end - a;
    }
    return whole;
  }

  segments(paragraphs: readonly string[]): Segment[] {
    return [...this.byParagraph.entries()]
      .sort(([a], [b]) => a - b)
      .flatMap(([index, intervals]) =>
        intervals.map(([from, to]) => ({
          index,
          from,
          to,
          length: this.lengths[index],
          text: paragraphs[index].slice(from, to),
        })),
      );
  }
}

/**
 * The text to send within `budget`. The pinned paragraphs come first, whole and
 * in the order given (a paragraph that cannot fit is cut where the budget ends);
 * then the ranked passages, best first, each only if it fits. With no ranking,
 * the article from the top fills what is left.
 */
export function selectWithinBudget(input: {
  paragraphs: readonly string[];
  pinned: readonly number[];
  ranked: readonly PassageSpan[] | null;
  budget?: number;
}): BudgetedSelection {
  const budget = input.budget ?? ASK_BUDGET_CHARS;
  const { paragraphs } = input;
  const chosen = new Chosen(paragraphs.map((p) => p.length));
  for (const i of input.pinned)
    if (i >= 0 && i < paragraphs.length)
      chosen.add(i, 0, paragraphs[i].length, budget);

  if (input.ranked) {
    let taken = 0;
    for (const span of input.ranked) {
      if (taken >= MAX_RETRIEVED_PASSAGES) break;
      const parts = Array.from(
        { length: span.end - span.start + 1 },
        (_, k): [number, number, number] => {
          const index = span.start + k;
          return [
            index,
            index === span.start ? span.from : 0,
            index === span.end ? span.to : paragraphs[index].length,
          ];
        },
      );
      const size = parts.reduce(
        (sum, [i, a, b]) => sum + chosen.size(i, a, b),
        0,
      );
      if (chosen.used + size > budget) continue;
      for (const [i, a, b] of parts) chosen.add(i, a, b, budget);
      taken++;
    }
  } else {
    for (const [i, paragraph] of paragraphs.entries())
      if (!chosen.add(i, 0, paragraph.length, budget)) break;
  }
  return { segments: chosen.segments(paragraphs), chars: chosen.used };
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

/** Paragraphs cited in the question and the last two turns, in the order they win the budget. */
function citedInConversation(input: {
  paragraphCount: number;
  question: string;
  history: readonly { role: string; content: string }[];
}): number[] {
  const { paragraphCount: count } = input;
  const recent = input.history.slice(-2).map((turn) => turn.content);
  return [
    ...citedParagraphs(input.question, count),
    ...recent.flatMap((text) => citedParagraphs(text, count)),
  ];
}

/** The paragraphs a question needs whatever it matches. */
export function pinnedParagraphs(input: {
  paragraphCount: number;
  paragraphIndex: number | null;
  question: string;
  history: readonly { role: string; content: string }[];
}): number[] {
  const { paragraphCount: count } = input;
  // In the order they win the budget: what the reader cited, what is on
  // screen, then the opening
  return [
    ...citedInConversation(input),
    ...(input.paragraphIndex !== null && input.paragraphIndex < count
      ? [input.paragraphIndex]
      : []),
    ...(count ? [0] : []),
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

/**
 * The article's passages, best match for the question first, or null when the
 * search can't run (no embedding key, a failing provider, an article that isn't
 * this reader's). The passages' vectors are cached, so a repeat costs one embed.
 */
async function rankForQuestion(
  ctx: PassageRunner,
  input: {
    userId: string;
    articleId: string | undefined;
    paragraphs: readonly string[];
    question: string;
    history: readonly { role: "user" | "assistant"; content: string }[];
    embedder: EmbeddingTarget | null;
  },
): Promise<RankedPassage[] | null> {
  try {
    if (input.embedder && input.articleId) {
      input.embedder.signal?.throwIfAborted();
      const spans = chunkParagraphs(input.paragraphs);
      const cache = await ctx.runMutation(internal.articlePassages.prepare, {
        userId: input.userId,
        articleId: input.articleId,
        contentHash: await sha256Hex(input.paragraphs.join("\u0000")),
        model: embeddingModel(input.embedder.provider),
        total: spans.length,
      });
      input.embedder.signal?.throwIfAborted();
      // Ownership is checked before *any* provider work, including the question.
      if (!cache) return null;
      const work = requestAttempt(input.embedder.signal, 120_000);
      const embedder = { ...input.embedder, signal: work.signal };
      try {
        const question = embedText(
          embedder,
          retrievalQuery(input.question, input.history),
        );
        if (cache.ready) {
          const query = await question;
          const ranked: RankedPassage[] = [];
          let cursor: string | null = null;
          do {
            work.signal.throwIfAborted();
            const page: {
              ranked: RankedPassage[];
              cursor: string | null;
            } | null = await ctx.runQuery(internal.articlePassages.rankPage, {
              userId: input.userId,
              articleId: cache.articleId,
              generation: cache.generation,
              query,
              cursor,
            });
            if (!page) return null;
            ranked.push(...page.ranked);
            cursor = page.cursor;
          } while (cursor !== null);
          return ranked.sort(
            (a, b) => b.score - a.score || a.start - b.start || a.from - b.from,
          );
        }
        const texts = spans.map((span) =>
          passageText(input.paragraphs, span).slice(0, EMBED_INPUT_CHARS),
        );
        const vectors: number[][] = new Array(spans.length);
        let next = 0;
        // Two passage requests plus the question: at most three provider calls.
        const worker = async () => {
          for (;;) {
            work.signal.throwIfAborted();
            const from = next;
            next += EMBED_BATCH;
            if (from >= texts.length) return;
            const batch = await embedTexts(
              embedder,
              texts.slice(from, from + EMBED_BATCH),
            );
            batch.forEach((vector, i) => {
              vectors[from + i] = vector;
            });
          }
        };
        const jobs = [question, worker(), worker()] as const;
        let query: number[];
        try {
          [query] = await Promise.all(jobs);
        } catch (error) {
          work.abort(error);
          await Promise.allSettled(jobs);
          throw error;
        }
        work.signal.throwIfAborted();
        const ranked = rankPassages(spans, vectors, query);
        try {
          for (let offset = 0; offset < spans.length; offset += 32) {
            work.signal.throwIfAborted();
            const accepted = await ctx.runMutation(
              internal.articlePassages.append,
              {
                userId: input.userId,
                articleId: cache.articleId,
                generation: cache.generation,
                offset,
                passages: spans.slice(offset, offset + 32).map((span, i) => ({
                  startParagraph: span.start,
                  endParagraph: span.end,
                  fromOffset: span.from,
                  toOffset: span.to,
                  embedding: vectors[offset + i],
                })),
              },
            );
            if (!accepted) break;
          }
        } catch (error) {
          work.signal.throwIfAborted();
          console.error("Caching the article's passages failed:", error);
        }
        return ranked;
      } finally {
        work.abort();
        work.dispose();
      }
    }
  } catch (error) {
    input.embedder?.signal?.throwIfAborted();
    console.error(
      "Searching the article failed, answering from its summary and opening:",
      error,
    );
  }
  return null;
}

/**
 * What a question about the whole article carries. A short article keeps its
 * whole text. A long one gets the pinned paragraphs and the passages that match
 * the question; if the search can't run (no embedding key, a failing provider,
 * an article that isn't this reader's), the summary, the pinned paragraphs and
 * the top of the article, without any error for the reader.
 */
export async function retrieveArticleContext(
  ctx: PassageRunner,
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
  const ranked = await rankForQuestion(ctx, input);
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

/** The most passages a passage question adds from elsewhere in the article. */
export const MAX_RELATED_PASSAGES = 3;

/**
 * The passages from outside the reader's window that a question reaches for.
 * A question that is best answered by the text around the passage (its best
 * match lies in the window) adds nothing; one whose best match lies elsewhere
 * gets the top few matches that are not in the window.
 */
export function relatedBeyondWindow(
  ranked: readonly RankedPassage[],
  window: ReadonlySet<number>,
): PassageSpan[] {
  const inWindow = (span: PassageSpan) => {
    for (let i = span.start; i <= span.end; i++) if (window.has(i)) return true;
    return false;
  };
  if (!ranked.length) return [];
  // A tie with a passage in the window is not evidence the question reaches out
  if (ranked.some((span) => span.score >= ranked[0].score && inWindow(span)))
    return [];
  return ranked
    .filter((span) => !inWindow(span))
    .slice(0, MAX_RELATED_PASSAGES);
}

export interface PassageAskContext {
  /** The paragraphs the question cites or matches outside the window; null when there are none. */
  related: BudgetedSelection | null;
  searched: boolean;
}

/**
 * What Ask about a passage adds to its window: paragraphs the question cites
 * and, when it reaches beyond the passage, the top matches from the same
 * article. The window's cost is reserved first and it is never repeated; cited
 * paragraphs then win what remains, ahead of retrieved passages.
 */
export async function retrievePassageContext(
  ctx: PassageRunner,
  input: {
    userId: string;
    articleId: string | undefined;
    paragraphs: readonly string[];
    window: readonly number[];
    question: string;
    history: readonly { role: "user" | "assistant"; content: string }[];
    embedder: EmbeddingTarget | null;
  },
): Promise<PassageAskContext> {
  const window = new Set(input.window);
  const beyond = input.paragraphs.length > window.size;
  if (!beyond) return { related: null, searched: false };
  const ranked = await rankForQuestion(ctx, input);
  const cited = citedInConversation({
    paragraphCount: input.paragraphs.length,
    question: input.question,
    history: input.history,
  });
  const selection = selectWithinBudget({
    paragraphs: input.paragraphs,
    // The window is reserved first, so what it costs is never spent twice
    pinned: [...input.window, ...cited],
    ranked: relatedBeyondWindow(ranked ?? [], window),
  });
  const segments = selection.segments.filter((s) => !window.has(s.index));
  return {
    related: segments.length
      ? { segments, chars: segments.reduce((n, s) => n + s.to - s.from, 0) }
      : null,
    searched: ranked !== null,
  };
}
