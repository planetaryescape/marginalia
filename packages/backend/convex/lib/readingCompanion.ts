import { z } from "zod";

// Gemini Flash takes far more than this, but a long article plus every
// follow-up adds up quickly; beyond this budget only the paragraphs nearest
// the highlighted passage are sent.
export const MAX_CONTEXT_CHARS = 120_000;

export const companionRequestSchema = z
  .object({
    // "article" questions are about the whole piece and have no passage
    mode: z.enum(["explain", "simplify", "define", "ask", "article"]),
    title: z.string().max(500),
    paragraphs: z.array(z.string().max(20_000)).max(4000),
    selection: z.string().trim().max(4000).default(""),
    paragraphIndex: z.number().int().min(0).nullable(),
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
- Then one or two short paragraphs that add what the reader actually needs: how the passage or idea fits the author's argument, what a term or reference means, background the author assumes, or what is easy to miss.
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
    "Explain what the highlighted passage means in the context of this article: what the author is saying, why it matters at this point in the piece, and any jargon, reference or background the reader needs.",
  simplify:
    "Rewrite the highlighted passage in plain, everyday language a curious non-expert would follow. The first sentence is the plain-language rewrite itself. Afterwards, briefly note any nuance the simpler version loses, if it matters.",
  define:
    "Define the selected word or phrase, rather than explaining the whole argument. Start with its ordinary dictionary-style meaning and part of speech. Then identify the precise sense in this sentence and article, including technical, idiomatic or figurative usage, citing the surrounding paragraph. If several words are selected, treat an idiom as a unit; otherwise identify the key term and name it explicitly. Briefly give etymology only when you know it reliably and it helps; acknowledge uncertainty rather than inventing an origin. Offer two or three synonyms or short substitute phrases that fit the grammar, tone and meaning of this actual sentence, showing the relevant sentence fragment with each replacement and noting any change in nuance. If no faithful substitute exists, say so. Prioritize meaning and context when the answer length is brief.",
  ask: "Answer the reader's question about the highlighted passage.",
  article:
    "Answer the reader's question about the article as a whole. Draw on whichever parts of the article bear on it, citing them by ¶.",
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

export function formatArticle(
  title: string,
  paragraphs: string[],
  paragraphIndex: number | null,
): string {
  const indices = selectParagraphWindow(paragraphs, paragraphIndex);
  const lines: string[] = [];
  let previous = -1;
  for (const i of indices) {
    if (i !== previous + 1) lines.push("[…]");
    const marker =
      i === paragraphIndex ? " ← contains the highlighted passage" : "";
    lines.push(`¶${i + 1}${marker}\n${paragraphs[i]}`);
    previous = i;
  }
  if (previous !== paragraphs.length - 1 && paragraphs.length > 0)
    lines.push("[…]");
  return `# ${title || "Untitled"}\n\n${lines.join("\n\n")}`;
}

export function buildCompanionPrompt(request: CompanionRequest): {
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
    "<article>",
    formatArticle(request.title, request.paragraphs, request.paragraphIndex),
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
