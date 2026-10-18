import { z } from "zod";
import {
  ASK_BUDGET_CHARS,
  type BudgetedSelection,
  type Segment,
} from "./articleAsk";
import { type BookAskContext, formatBookContext } from "./bookAsk";

// Gemini Flash takes far more than this, but a long article plus every
// follow-up adds up quickly; beyond this budget only the paragraphs nearest
// the highlighted passage are sent.
export const MAX_CONTEXT_CHARS = 120_000;

export const companionRequestSchema = z
  .object({
    // "article" questions are about the whole piece and have no passage
    mode: z.enum(["explain", "simplify", "define", "ask", "article"]),
    // Lets the server add the article's summary as background. Optional so an
    // older client keeps working, without the summary.
    articleId: z.string().max(100).optional(),
    // For a book, the part on screen; the paragraphs sent are that part's
    unitIndex: z.number().int().min(0).max(100_000).optional(),
    title: z.string().max(500),
    paragraphs: z.array(z.string().max(300_000)).max(4000),
    // Additive contract: only local tools may send sparse, original indices.
    paragraphIndices: z
      .array(z.number().int().min(0).max(3999))
      .max(4000)
      .optional(),
    selection: z.string().trim().max(4000).default(""),
    paragraphIndex: z.number().int().min(0).nullable(),
    // The last paragraph the selection crosses, from the reader's own range.
    // Older clients omit it and the server works it out from the text.
    paragraphEnd: z.number().int().min(0).optional(),
    // For Define: the sentence the word was selected in, and which match of
    // the word in its paragraph it was, so a repeated word is defined as used.
    sentence: z.string().trim().max(2000).optional(),
    occurrence: z.number().int().min(0).optional(),
    question: z.string().trim().max(2000).optional(),
    length: z.enum(["brief", "standard", "detailed"]).default("standard"),
    level: z.enum(["plain", "balanced", "expert"]).default("balanced"),
    depth: z.enum(["quick", "deep"]).default("quick"),
    web: z.boolean().default(false),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(12_000),
        }),
      )
      .max(30)
      .default([]),
  })
  .refine(
    (r) => (r.mode !== "ask" && r.mode !== "article") || Boolean(r.question),
    {
      message: "Ask needs a question",
      path: ["question"],
    },
  )
  .refine((r) => r.mode === "article" || Boolean(r.selection), {
    message: "Explain, Simplify, Define and Ask need a highlighted passage",
    path: ["selection"],
  })
  .refine(
    (r) =>
      !r.paragraphIndices ||
      (r.mode !== "ask" &&
        r.mode !== "article" &&
        r.paragraphIndices.length === r.paragraphs.length &&
        r.paragraphIndices.every((n, i, all) => i === 0 || n > all[i - 1]) &&
        r.paragraphIndex !== null &&
        r.paragraphIndices.includes(r.paragraphIndex) &&
        (r.mode === "define" ||
          r.paragraphEnd === undefined ||
          r.paragraphIndices.includes(
            Math.min(r.paragraphEnd, r.paragraphIndex + 20),
          ))),
    { message: "Invalid local paragraph context" },
  )
  .transform((r) => {
    if (!r.paragraphIndices) return r;
    const paragraphs = new Array<string>(
      (r.paragraphIndices.at(-1) ?? -1) + 1,
    ).fill("");
    r.paragraphIndices.forEach((index, i) => {
      paragraphs[index] = r.paragraphs[i];
    });
    return { ...r, paragraphs };
  });

export type CompanionRequest = z.infer<typeof companionRequestSchema>;

const SYSTEM_PROMPT = `You are the reading companion inside Marginalia, a reader for thoughtful long-form articles. The reader either has highlighted a passage and wants help with it in the context of the whole article, or is asking about the article as a whole.

The article is given with numbered paragraphs (¶1, ¶2, …). When there is a highlighted passage, it is marked.

How to answer:
- Start with ONE plain sentence that directly answers. Put it alone in the first paragraph.
- Then add only what the reader actually needs, within the length the task gives: how the passage or idea fits the author's argument, what a term or reference means, background the author assumes, or what is easy to miss. Stop when that is done; never pad.
- Ground claims in the article and cite paragraphs inline like ¶12 or ¶4–6. Only cite paragraphs that exist.
- If you draw on knowledge from outside the article, say so briefly. If the article doesn't support an answer, say that instead of guessing.
- Use \`backticks\` for code, identifiers, and commands. Use **bold** sparingly. No headings, no bullet lists, no preamble such as "Great question" or "This passage".`;

const LENGTHS: Record<CompanionRequest["length"], string> = {
  brief:
    "Keep the whole answer under 70 words: the opening sentence plus at most one short paragraph.",
  standard: "Stay under 160 words unless the reader asks for more.",
  detailed:
    "Go deeper when it helps, up to about 320 words, still in short paragraphs.",
};

const LEVELS: Record<CompanionRequest["level"], string> = {
  plain:
    "Write for a curious newcomer: everyday words, define every technical term.",
  balanced:
    "Write for an educated general reader: define specialist terms briefly.",
  expert:
    "Write for someone fluent in the field: skip basic definitions and focus on nuance.",
};

const WEB_GUIDANCE = `
You can search the web. Search only when it would genuinely improve the answer: the passage depends on recent events or facts after your training, the reader asks you to verify a claim or go deeper, or the article references something you don't know well. Don't search for things the article itself or general knowledge already answers.
When you use search results, cite them inline as markdown links named by domain, like [nature.com](https://…), and keep citing the article as ¶N.`;

const BOOK_GUIDANCE = `
The reader is asking about a whole book, which is too long to be given in full. You are given the book's outline with a summary of each part, passages from the book that match the question, and the one part now on screen with numbered paragraphs.
- Cite paragraphs as ¶N only for the part on screen; those numbers exist nowhere else.
- For anything from another part, whether from a passage or the outline, say "Part N" (for example "Part 12") and never ¶.
- Ground the answer in the passages and the on-screen part. Use the outline only to place things. If neither supports an answer, say so instead of guessing.`;

export function buildSystemPrompt(
  request: Pick<CompanionRequest, "length" | "level"> & { web?: boolean },
  book?: BookAskContext | null,
) {
  const base = `${SYSTEM_PROMPT}\n- ${LEVELS[request.level]}\n- ${LENGTHS[request.length]}${book ? `\n${BOOK_GUIDANCE}` : ""}`;
  return request.web ? `${base}\n${WEB_GUIDANCE}` : base;
}

const TASKS: Record<CompanionRequest["mode"], string> = {
  explain:
    "Explain what the highlighted passage means in the context of this article: what the author is saying, why it matters at this point in the piece, and any jargon, reference or background the reader needs. Keep it to one short paragraph.",
  simplify:
    "Rewrite the highlighted passage in plain, everyday language a curious non-expert would follow. The first sentence is the plain-language rewrite itself. Afterwards, briefly note any nuance the simpler version loses, if it matters. Keep it to one short paragraph.",
  define:
    "Define the selected word or phrase, rather than explaining the whole argument. Start with its ordinary dictionary-style meaning and part of speech. Then identify the precise sense in this sentence and article, including technical, idiomatic or figurative usage, citing the surrounding paragraph. If several words are selected, treat an idiom as a unit; otherwise identify the key term and name it explicitly. Briefly give etymology only when you know it reliably and it helps; acknowledge uncertainty rather than inventing an origin. Offer two or three synonyms or short substitute phrases that fit the grammar, tone and meaning of this actual sentence, showing the relevant sentence fragment with each replacement and noting any change in nuance. If no faithful substitute exists, say so. Be brief: answer in a line or two, and leave out any part (etymology, synonyms) that does not earn its place in that space. Prioritize meaning and context.",
  ask: "Answer the reader's question about the highlighted passage. Be as long as the question needs and no longer.",
  article:
    "Answer the reader's question about the article as a whole. Draw on whichever parts of the article bear on it, citing them by ¶. Be as long as the question needs and no longer.",
};

export function selectParagraphWindow(
  paragraphs: string[],
  centre: number | null,
  budget = MAX_CONTEXT_CHARS,
): number[] {
  const total = paragraphs.reduce((sum, p) => sum + p.length, 0);
  if (total <= budget) return paragraphs.map((_, i) => i);

  const start = centre ?? 0;
  const picked = new Set<number>();
  let used = 0;
  for (let step = 0; picked.size < paragraphs.length; step++) {
    const candidates = step === 0 ? [start] : [start - step, start + step];
    let anyInRange = false;
    for (const i of candidates) {
      if (i < 0 || i >= paragraphs.length) continue;
      anyInRange = true;
      if (used + paragraphs[i].length > budget)
        return [...picked].sort((a, b) => a - b);
      picked.add(i);
      used += paragraphs[i].length;
    }
    if (!anyInRange) break;
  }
  return [...picked].sort((a, b) => a - b);
}

export interface ArticleSummary {
  thesis?: string;
  gist: string;
}

/** Paragraphs either side of the passage that Explain and Simplify see. */
const NEIGHBOURS = 1;
/** Asking about a passage reads a little wider, and nothing more (D-DES-054). */
const ASK_NEIGHBOURS = 2;
/** How far past its first paragraph a passage is searched for its last one. */
const MAX_PASSAGE_SPAN = 20;

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** The paragraph the passage starts in, found by text when the client sent no index. */
function passageStart(request: CompanionRequest): number | null {
  const { paragraphs, paragraphIndex, selection } = request;
  if (paragraphIndex !== null && paragraphIndex < paragraphs.length)
    return paragraphIndex;
  const needle = squash(selection);
  if (!needle) return null;
  const found = paragraphs.findIndex((p) => squash(p).includes(needle));
  return found < 0 ? null : found;
}

/** Least text a selection must share with two paragraphs' edges to count as crossing between them. */
const MIN_CROSSING = 12;

/**
 * Where the rest of a selection leaves `paragraph` for `next`: the selection
 * so far ends the paragraph, and what follows is the start of the next one,
 * however little of it. Returns that remainder, or null if it stays inside.
 */
function crossInto(rest: string, paragraph: string, next: string) {
  for (let cut = Math.min(rest.length, paragraph.length); cut > 0; cut--) {
    if (!paragraph.endsWith(rest.slice(0, cut))) continue;
    const remainder = rest.slice(cut).trimStart();
    if (!remainder) return null;
    const shared = Math.min(remainder.length, next.length);
    if (
      shared > 0 &&
      cut + shared >= MIN_CROSSING &&
      next.startsWith(remainder.slice(0, shared))
    )
      return remainder;
  }
  return null;
}

/** The last paragraph of a passage that runs across several. */
function passageEnd(request: CompanionRequest, start: number): number {
  const last = Math.min(
    request.paragraphs.length - 1,
    start + MAX_PASSAGE_SPAN,
  );
  let rest = squash(request.selection);
  let end = start;
  while (end < last) {
    const remainder = crossInto(
      rest,
      squash(request.paragraphs[end]),
      squash(request.paragraphs[end + 1]),
    );
    if (remainder === null) break;
    rest = remainder;
    end++;
  }
  return end;
}

/**
 * The paragraphs each tool gets: only what its question needs (D-DES-054).
 * Define sees the sentence's paragraph; Explain and Simplify see the passage
 * and a paragraph either side; Ask about a passage sees two either side.
 * Asking about the whole article is retrieved in lib/articleAsk.ts; only a
 * short article, or an older client, comes here for its whole text.
 */
export interface ParagraphContext {
  indices: number[];
  marked: Set<number>;
  /** Marked paragraphs too long to send whole, with the excerpt sent instead */
  excerpts?: Map<number, string>;
}

export function selectContext(request: CompanionRequest): ParagraphContext {
  const { paragraphs, mode } = request;
  const start = mode === "article" ? null : passageStart(request);
  if (start === null) {
    // No passage to centre on: either the whole-article tool or a selection
    // that could not be placed. Both keep the legacy window from ¶1, except
    // that a passage Ask never sends more than the retrieval budget.
    return {
      indices: selectParagraphWindow(
        paragraphs,
        request.paragraphIndex,
        mode === "ask" ? ASK_BUDGET_CHARS : MAX_CONTEXT_CHARS,
      ),
      marked: new Set(),
    };
  }
  const end =
    mode === "define"
      ? start
      : request.paragraphEnd === undefined
        ? passageEnd(request, start)
        : Math.min(
            Math.max(request.paragraphEnd, start),
            start + MAX_PASSAGE_SPAN,
            paragraphs.length - 1,
          );
  const reach =
    mode === "define" ? 0 : mode === "ask" ? ASK_NEIGHBOURS : NEIGHBOURS;
  const indices: number[] = [];
  for (
    let i = Math.max(0, start - reach);
    i <= Math.min(paragraphs.length - 1, end + reach);
    i++
  )
    indices.push(i);
  const marked = new Set<number>();
  for (let i = start; i <= end; i++) marked.add(i);
  if (mode !== "ask") return { indices, marked };
  return {
    indices: trimWindow(paragraphs, indices, marked, ASK_BUDGET_CHARS),
    marked,
    excerpts: clipPassage(
      paragraphs,
      marked,
      start,
      request.selection,
      request.occurrence ?? 0,
    ),
  };
}

/**
 * When the passage's own paragraphs are longer than the budget, each is cut to
 * an equal share of it. The first keeps the text around where the selection
 * starts; a selection that crosses into later paragraphs begins them, so those
 * keep their opening.
 */
function clipPassage(
  paragraphs: readonly string[],
  marked: ReadonlySet<number>,
  start: number,
  selection: string,
  occurrence: number,
): Map<number, string> | undefined {
  const total = [...marked].reduce((sum, i) => sum + paragraphs[i].length, 0);
  if (total <= ASK_BUDGET_CHARS) return undefined;
  const share = Math.floor(ASK_BUDGET_CHARS / marked.size);
  const excerpts = new Map<number, string>();
  for (const i of marked) {
    const text = paragraphs[i];
    if (text.length <= share) continue;
    const found =
      i === start
        ? selectionAt(text, selection, marked.size > 1, occurrence)
        : 0;
    // Some text before the selection, so the model sees what it follows
    const from = Math.min(
      Math.max(0, found - Math.floor(share / 4)),
      text.length - share,
    );
    const to = from + share;
    excerpts.set(
      i,
      `${from > 0 ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`,
    );
  }
  return excerpts;
}

/**
 * Drops the outermost unmarked paragraphs, farthest from the passage first,
 * until the window fits the budget. The passage's own paragraphs always stay.
 */
function trimWindow(
  paragraphs: readonly string[],
  indices: readonly number[],
  marked: ReadonlySet<number>,
  budget: number,
): number[] {
  const kept = [...indices];
  let total = kept.reduce((sum, i) => sum + paragraphs[i].length, 0);
  const centre = (Math.min(...marked) + Math.max(...marked)) / 2;
  while (total > budget) {
    const outer = kept
      .filter((i) => !marked.has(i))
      .sort((a, b) => Math.abs(b - centre) - Math.abs(a - centre) || b - a)[0];
    if (outer === undefined) break;
    kept.splice(kept.indexOf(outer), 1);
    total -= paragraphs[outer].length;
  }
  return kept;
}

/**
 * Where the selection starts in its first paragraph. A selection that crosses
 * into the next paragraph begins in this one's closing words, so it starts
 * where the longest opening piece of it ends this paragraph. One that stays
 * inside starts at the occurrence the reader selected.
 */
function selectionAt(
  text: string,
  selection: string,
  crosses: boolean,
  occurrence: number,
) {
  const wanted = selection.trim();
  if (crosses) {
    for (let cut = Math.min(wanted.length, text.length); cut > 0; cut--)
      if (text.endsWith(wanted.slice(0, cut))) return text.length - cut;
    return text.length;
  }
  return occurrenceAt(text, wanted, occurrence);
}

/**
 * Where the chosen occurrence of `needle` starts in `text`, counted as the
 * reader's client counts it: ignoring case, with whitespace runs as one space.
 * Falls back to the last match, then to the start.
 */
function occurrenceAt(text: string, needle: string, occurrence: number) {
  // The squashed text, and where each of its characters sits in `text`
  let squashed = "";
  const rawOf: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (!squashed || squashed.endsWith(" ")) continue;
      squashed += " ";
    } else squashed += text[i];
    rawOf.push(i);
  }
  // Lowercased whole, as the client does, so final sigma and the like agree.
  // A character can lowercase to more than one (İ), so each lowered character
  // is mapped through its source character's lowered length.
  const lowered = squashed.toLowerCase();
  const raw: number[] = [];
  for (let k = 0; k < squashed.length; k++)
    for (let n = squashed[k].toLowerCase().length; n > 0; n--)
      raw.push(rawOf[k]);
  const target = squash(needle).toLowerCase();
  if (!target) return 0;
  let at = -1;
  for (let n = 0; n <= occurrence; n++) {
    const next = lowered.indexOf(target, at + 1);
    if (next < 0) break;
    at = next;
  }
  return at < 0 ? 0 : (raw[at] ?? 0);
}

export function formatArticle(
  title: string,
  paragraphs: string[],
  paragraphIndex: number | null,
  context?: ParagraphContext,
): string {
  const indices =
    context?.indices ?? selectParagraphWindow(paragraphs, paragraphIndex);
  const marked =
    context?.marked ?? new Set(paragraphIndex === null ? [] : [paragraphIndex]);
  const lines: string[] = [];
  let previous = -1;
  for (const i of indices) {
    if (i !== previous + 1) lines.push("[…]");
    const marker = marked.has(i) ? " ← contains the highlighted passage" : "";
    lines.push(
      `¶${i + 1}${marker}\n${context?.excerpts?.get(i) ?? paragraphs[i]}`,
    );
    previous = i;
  }
  if (previous !== paragraphs.length - 1 && paragraphs.length > 0)
    lines.push("[…]");
  return `# ${title || "Untitled"}\n\n${lines.join("\n\n")}`;
}

/** Retrieved stretches of the article, each under its paragraph's real ¶ number. */
export function formatSegments(
  title: string,
  segments: readonly Segment[],
  paragraphCount: number,
): string {
  const lines: string[] = [];
  let previous: Segment | null = null;
  for (const seg of segments) {
    const follows = previous
      ? previous.to === previous.length &&
        seg.from === 0 &&
        seg.index === previous.index + 1
      : seg.index === 0 && seg.from === 0;
    if (!follows) lines.push("[…]");
    lines.push(
      `¶${seg.index + 1}${seg.from > 0 ? " (cont.)" : ""}\n${seg.text}`,
    );
    previous = seg;
  }
  if (
    !previous ||
    previous.to < previous.length ||
    previous.index < paragraphCount - 1
  )
    lines.push("[…]");
  return `# ${title || "Untitled"}\n\n${lines.join("\n\n")}`;
}

function formatSummary(summary: ArticleSummary | null | undefined): string[] {
  if (!summary) return [];
  const body = [summary.thesis, summary.gist].filter(Boolean).join("\n\n");
  return body
    ? [
        "<summary>",
        "Background on the whole piece, for orientation. The ¶ numbers refer only to the excerpt below.",
        body,
        "</summary>",
        "",
      ]
    : [];
}

/** The part on screen is capped well under the legacy window: the rest of the book arrives as passages. */
export const BOOK_PART_CHARS = 30_000;

export function buildCompanionPrompt(
  request: CompanionRequest,
  summary?: ArticleSummary | null,
  book?: BookAskContext | null,
  /** The retrieved paragraphs of a long article; absent sends the whole text. */
  retrieved?: BudgetedSelection | null,
  /** For Ask about a passage: cited or matching text from elsewhere in the article. */
  related?: BudgetedSelection | null,
): {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
} {
  const location =
    request.paragraphIndex === null
      ? ""
      : ` paragraph="¶${request.paragraphIndex + 1}"`;
  const passage =
    request.mode === "article"
      ? []
      : [
          `<highlighted_passage${location}>`,
          request.selection,
          "</highlighted_passage>",
          "",
        ];
  const usage =
    request.mode === "define" && request.sentence
      ? [
          `The selected usage is in this sentence: "${request.sentence}"${
            request.occurrence
              ? ` (occurrence ${request.occurrence + 1} of the selected words in the paragraph)`
              : ""
          }`,
          "",
        ]
      : [];
  const opening = [
    ...formatSummary(summary),
    ...(book ? formatBookContext(book) : []),
    book
      ? `<article part="${book.partNumber} of ${book.partCount}">`
      : "<article>",
    retrieved && !book
      ? formatSegments(
          request.title,
          retrieved.segments,
          request.paragraphs.length,
        )
      : formatArticle(
          book
            ? `${request.title} (part ${book.partNumber} of ${book.partCount}, on screen)`
            : request.title,
          request.paragraphs,
          request.paragraphIndex,
          book
            ? {
                indices: selectParagraphWindow(
                  request.paragraphs,
                  null,
                  BOOK_PART_CHARS,
                ),
                marked: new Set(),
              }
            : selectContext(request),
        ),
    "</article>",
    "",
    // After the passage's own surroundings, so they are never displaced
    ...(related?.segments.length && request.mode === "ask" && !book
      ? [
          "<elsewhere_in_the_article>",
          "Other parts of the article that bear on the question. The ¶ numbers are the article's own.",
          formatSegments(
            request.title,
            related.segments,
            request.paragraphs.length,
          ),
          "</elsewhere_in_the_article>",
          "",
        ]
      : []),
    ...passage,
    ...usage,
    TASKS[request.mode],
    request.question ? `\nReader's question: ${request.question}` : "",
  ].join("\n");

  return {
    system: buildSystemPrompt(request, book),
    messages: [{ role: "user" as const, content: opening }, ...request.history],
  };
}
