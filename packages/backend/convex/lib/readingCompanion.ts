import { z } from "zod";

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
    title: z.string().max(500),
    paragraphs: z.array(z.string().max(20_000)).max(4000),
    selection: z.string().trim().max(4000).default(""),
    paragraphIndex: z.number().int().min(0).nullable(),
    // The last paragraph the selection crosses, from the reader's own range.
    // Older clients omit it and the server works it out from the text.
    paragraphEnd: z.number().int().min(0).optional(),
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

export function buildSystemPrompt(
  request: Pick<CompanionRequest, "length" | "level"> & { web?: boolean },
) {
  const base = `${SYSTEM_PROMPT}\n- ${LEVELS[request.level]}\n- ${LENGTHS[request.length]}`;
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

/** Paragraphs either side of the passage that Explain, Simplify and Ask see. */
const NEIGHBOURS = 1;
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
 * Define sees the sentence's paragraph; Explain, Simplify and Ask about a
 * passage see the passage and a paragraph either side. Asking about the whole
 * article keeps today's window until book-scale retrieval (rung 3b).
 */
export interface ParagraphContext {
  indices: number[];
  marked: Set<number>;
}

export function selectContext(request: CompanionRequest): ParagraphContext {
  const { paragraphs, mode } = request;
  const start = mode === "article" ? null : passageStart(request);
  if (start === null) {
    // No passage to centre on: either the whole-article tool or a selection
    // that could not be placed. Both keep the legacy window from ¶1.
    return {
      indices: selectParagraphWindow(paragraphs, request.paragraphIndex),
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
  // Seam for rung 3b: "ask" will add the passages found by searching the
  // document for the question; until then it sees the same window as Explain.
  const reach = mode === "define" ? 0 : NEIGHBOURS;
  const indices: number[] = [];
  for (
    let i = Math.max(0, start - reach);
    i <= Math.min(paragraphs.length - 1, end + reach);
    i++
  )
    indices.push(i);
  const marked = new Set<number>();
  for (let i = start; i <= end; i++) marked.add(i);
  return { indices, marked };
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
    lines.push(`¶${i + 1}${marker}\n${paragraphs[i]}`);
    previous = i;
  }
  if (previous !== paragraphs.length - 1 && paragraphs.length > 0)
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

export function buildCompanionPrompt(
  request: CompanionRequest,
  summary?: ArticleSummary | null,
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
  const opening = [
    ...formatSummary(summary),
    "<article>",
    formatArticle(
      request.title,
      request.paragraphs,
      request.paragraphIndex,
      selectContext(request),
    ),
    "</article>",
    "",
    ...passage,
    TASKS[request.mode],
    request.question ? `\nReader's question: ${request.question}` : "",
  ].join("\n");

  return {
    system: buildSystemPrompt(request),
    messages: [{ role: "user" as const, content: opening }, ...request.history],
  };
}
