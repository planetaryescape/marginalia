// Ask about this book (D-DES-054, D-DES-055): a question about a whole book
// can't carry the book. It carries the outline of part summaries, the passages
// the question matches inside this book, and the part on screen.
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { type OutlineLine, outlineText } from "./bookIndex";
import { type EmbeddingTarget, embedText } from "./embeddings";

/** Passages searched for, and the least similar one still worth sending. */
export const PASSAGE_HITS = 8;
export const MIN_PASSAGE_SCORE = 0.2;

export interface BookAskContext {
  /** The part on screen, counted from 1, and the number of parts. */
  partNumber: number;
  partCount: number;
  lines: OutlineLine[];
  passages: { partNumber: number; heading: string; text: string }[];
  /** False while the book's passages are still being embedded. */
  searched: boolean;
}

/**
 * What a question about the book needs, or null when the article isn't the
 * reader's book. The search is scoped to this book by its filter and to this
 * reader again when the passages are loaded. Without an embedding key, or if
 * the search fails, the question still gets the outline and the part on screen.
 */
export async function retrieveBookContext(
  ctx: ActionCtx,
  input: {
    userId: string;
    articleId: string;
    unitIndex: number;
    question: string;
    embedder: EmbeddingTarget | null;
  },
): Promise<BookAskContext | null> {
  const book = await ctx.runQuery(internal.bookIndex.askContext, {
    articleId: input.articleId,
    userId: input.userId,
  });
  if (!book) return null;
  const partCount = book.lines.length;
  const context: BookAskContext = {
    partNumber: Math.min(Math.max(input.unitIndex, 0), partCount - 1) + 1,
    partCount,
    lines: book.lines,
    passages: [],
    searched: false,
  };
  if (!input.embedder || !book.hasPassages) return context;
  try {
    const vector = await embedText(
      input.embedder,
      input.question.slice(0, 4000),
    );
    const articleId: Id<"articles"> = book.articleId;
    const hits = await ctx.vectorSearch("bookPassages", "by_embedding", {
      vector,
      limit: PASSAGE_HITS,
      filter: (q) => q.eq("articleId", articleId),
    });
    const wanted = hits.filter((hit) => hit._score >= MIN_PASSAGE_SCORE);
    const passages = wanted.length
      ? await ctx.runQuery(internal.bookIndex.loadPassages, {
          userId: input.userId,
          articleId,
          ids: wanted.map((hit) => hit._id),
        })
      : [];
    context.passages = passages.map((passage) => ({
      partNumber: passage.unitIndex + 1,
      heading: passage.heading,
      text: passage.text,
    }));
    context.searched = true;
  } catch (error) {
    console.error(
      "Searching the book failed, answering from its outline:",
      error,
    );
  }
  return context;
}

/** The outline, then the passages found, as the sections of a prompt. */
export function formatBookContext(book: BookAskContext): string[] {
  const outline = outlineText(book.lines, { around: book.partNumber - 1 });
  return [
    "<book_outline>",
    `The book's ${book.partCount} parts, each with a one-line summary where one has been written.`,
    outline,
    "</book_outline>",
    "",
    ...(book.passages.length
      ? [
          "<book_passages>",
          "Passages from the book that match the question, most similar first.",
          ...book.passages.map(
            (passage) =>
              `[Part ${passage.partNumber}] ${passage.heading}\n${passage.text}`,
          ),
          "</book_passages>",
          "",
        ]
      : [
          book.searched
            ? "No passage of the book matched the question closely."
            : "The book's passages aren't searchable yet; only the outline and the part on screen are given.",
          "",
        ]),
  ];
}
