import type { Doc } from "../_generated/dataModel";
import { sha256Hex } from "./tokens";

// Storage limits are UTF-8 bytes, not JS code units. Kept conversations may
// contain the initial answer plus 30 history turns and the latest response.
export const NOTE_HTML_BYTES = 192_000;
export const NOTE_PLAIN_BYTES = 96_000;
export const TRANSCRIPT_BYTES = 256_000;
export const MAX_STORED_TURNS = 64;
const encoder = new TextEncoder();

export function assertBytes(value: string, max: number, label: string) {
  if (encoder.encode(value).byteLength > max)
    throw new Error(`${label} is too large (maximum ${max} UTF-8 bytes)`);
}

export function validateNote(content: string, plain: string) {
  assertBytes(content, NOTE_HTML_BYTES, "Note HTML");
  assertBytes(plain, NOTE_PLAIN_BYTES, "Note text");
}

export function validateTranscript(turns: { role: string; content: string }[]) {
  if (turns.length > MAX_STORED_TURNS)
    throw new Error(
      `A saved conversation supports at most ${MAX_STORED_TURNS} turns`,
    );
  assertBytes(JSON.stringify(turns), TRANSCRIPT_BYTES, "Conversation");
}

export function validateIndex(value: number | undefined, label: string) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
    throw new Error(`Invalid ${label}`);
}

/** Code-point-safe previews, never HTML fragments or a substitute for a body. */
export function preview(text: string, max = 360) {
  const points = Array.from(text);
  return points.length > max ? `${points.slice(0, max).join("")}…` : text;
}

const unescapeHtml = (text: string) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const plainHtml = (html: string) =>
  unescapeHtml(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

export async function notePreview(row: Doc<"userNotes">) {
  // Preserve the old copy detector without sending HTML or transcript history.
  const match =
    !row.annotationId &&
    /^<h3>([\s\S]*?)<\/h3>((?:<p>[\s\S]*?<\/p>)+)$/.exec(row.content.trim());
  const heading = match ? unescapeHtml(match[1]) : null;
  const legacyCopy =
    match && heading !== null && row.contentPlain.startsWith(`${heading}\n\n`)
      ? await sha256Hex(JSON.stringify([heading, plainHtml(match[2])]))
      : undefined;
  return {
    _id: row._id,
    articleId: row.articleId,
    selectedText: row.selectedText,
    selectedStartOffset: row.selectedStartOffset,
    selectedEndOffset: row.selectedEndOffset,
    unitIndex: row.unitIndex,
    annotationId: row.annotationId,
    prompt: row.prompt,
    contentPlain: preview(row.contentPlain),
    bodyDeferred: true,
    legacyCopy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function threadPreview(row: Doc<"companionThreads">) {
  const heading =
    row.question ??
    {
      explain: "Explain",
      simplify: "Simplify",
      define: "Define",
      ask: "Ask",
      article: "Article",
    }[row.mode];
  const answers = row.turns
    .filter((turn) => turn.role === "assistant")
    .map((turn) => turn.content.trim());
  const legacyCopies = await Promise.all(
    answers
      .slice(0, MAX_STORED_TURNS)
      .map((_, index) =>
        sha256Hex(
          JSON.stringify([
            heading,
            plainHtml(answers.slice(0, index + 1).join("\n\n")),
          ]),
        ),
      ),
  );
  return {
    _id: row._id,
    articleId: row.articleId,
    answerId: row.answerId,
    mode: row.mode,
    selection: row.selection,
    question: row.question,
    paragraphIndex: row.paragraphIndex,
    unitIndex: row.unitIndex,
    preview: preview(
      row.turns.find((turn) => turn.role === "assistant" && turn.content.trim())
        ?.content ?? "",
    ),
    turnCount: row.turns.length,
    questionCount: row.turns.filter((turn) => turn.role === "user").length + 1,
    legacyCopies,
    keptAt: row.keptAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function markPresentation(row: Doc<"highlights">) {
  return {
    _id: row._id,
    articleId: row.articleId,
    kind: row.kind,
    color: row.color,
    text: row.text,
    paragraphIndex: row.paragraphIndex,
    unitIndex: row.unitIndex,
    createdAt: row.createdAt,
  };
}
