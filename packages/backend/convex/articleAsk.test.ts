/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveTestCredential, secondReaderTest } from "../test/owner";
import { internal } from "./_generated/api";
import {
  ASK_BUDGET_CHARS,
  ASK_FULL_TEXT_CHARS,
  chunkParagraphs,
  citedParagraphs,
  LONG_PARAGRAPH_CHARS,
  passageText,
  retrievePassageContext,
} from "./lib/articleAsk";
import {
  buildCompanionPrompt,
  type CompanionRequest,
  companionRequestSchema,
  selectContext,
} from "./lib/readingCompanion";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const OWNER_KEY = "sk-or-owner-openrouter-fixture-0001";
const READER_KEY = "sk-or-reader-openrouter-fixture-0002";

beforeEach(() => {
  vi.stubEnv(
    "PROVIDER_KEYS_ENCRYPTION_KEY",
    btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1))),
  );
  vi.stubEnv("OPENROUTER_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Texts about the zebra point along axis 0; everything else along axis 1. */
function vectorFor(text: string) {
  const vector = new Array<number>(1536).fill(0);
  vector[text.toLowerCase().includes("zebra") ? 0 : 1] = 1;
  return vector;
}

function mockProviders() {
  const prompts: string[] = [];
  const embedInputs: string[][] = [];
  let embeddingsDown = false;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const request: {
        input?: string[];
        messages?: { role: string; content: string }[];
      } = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.endsWith("/embeddings")) {
        if (embeddingsDown) return new Response("down", { status: 500 });
        const texts = request.input ?? [];
        embedInputs.push(texts);
        return Response.json({
          data: texts.map((text, index) => ({
            index,
            embedding: vectorFor(text),
          })),
        });
      }
      const messages = request.messages ?? [];
      prompts.push(messages.filter((m) => m.role === "user")[0].content);
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Answer." } }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  );
  return {
    prompts,
    embedInputs,
    breakEmbeddings: () => {
      embeddingsDown = true;
    },
  };
}

/** `count` paragraphs of about 1,000 characters; the answer sits in the one numbered `answerAt`. */
function article(count: number, answerAt?: number) {
  return Array.from({ length: count }, (_, i) => {
    const lead =
      i === answerAt
        ? `PARA${i + 1} The zebra stripes evolved to deter biting flies. `
        : `PARA${i + 1} Filler about the weather and the tides. `;
    return lead + "Words worth reading slowly. ".repeat(40);
  })
    .slice(0, count)
    .map((p) => p.slice(0, 1_000));
}

/** `count` paragraphs of exactly `length` characters, each opening with its number. */
const sized = (count: number, length: number) =>
  Array.from({ length: count }, (_, i) =>
    `PARA${i + 1} Filler about tides. `.padEnd(length, "Words worth reading. "),
  ).map((p) => p.slice(0, length));

const sum = (paragraphs: string[]) =>
  paragraphs.reduce((total, p) => total + p.length, 0);

/** What the model was given of the article: the text between the tags. */
const articleSection = (prompt: string) =>
  /<article[^>]*>([\s\S]*)<\/article>/.exec(prompt)?.[1] ?? "";

async function setup() {
  const f = await secondReaderTest(modules);
  await saveTestCredential(f.t, OWNER, "openrouter", OWNER_KEY);
  await saveTestCredential(f.t, f.readerLibraryId, "openrouter", READER_KEY);
  const mock = mockProviders();
  const seed = (userId: string, title = "The Zebra") =>
    f.t.run(async (ctx) => {
      const articleId = await ctx.db.insert("articles", {
        userId,
        guid: `g:${title}:${userId}`,
        url: `https://example.com/${title}/${userId}`,
        title,
        extractionStatus: "extracted",
        createdAt: 0,
        annotationStatus: "skipped",
      });
      await ctx.db.insert("summaries", {
        userId,
        articleId,
        thesis: "Stripes are about flies.",
        gist: "A tour of zebra stripes.",
        model: "fixture",
        createdAt: 0,
      });
      return articleId;
    });
  const ask = (
    client: { fetch: (path: string, init: RequestInit) => Promise<Response> },
    body: Record<string, string | number | string[] | null>,
  ) =>
    client.fetch("/api/companion", {
      method: "POST",
      body: JSON.stringify({
        mode: "article",
        title: "The Zebra",
        selection: "",
        paragraphIndex: null,
        question: "Why does the zebra have stripes?",
        ...body,
      }),
    });
  const rows = (userId?: string) =>
    f.t.run(async (ctx) =>
      (await ctx.db.query("articlePassages").take(1_000)).filter(
        (row) => !userId || row.userId === userId,
      ),
    );
  return { f, mock, seed, ask, rows };
}

describe("Ask about a long article", () => {
  it("sends at most the budget from a 100,000-character article, and logs it", async () => {
    const { f, mock, seed, ask } = await setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const paragraphs = article(100, 79);
    expect(sum(paragraphs)).toBe(100_000);
    const articleId = await seed(OWNER);
    const response = await ask(f.owner, { articleId, paragraphs });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Answer.");
    const sent = articleSection(mock.prompts.at(-1) ?? "");
    // ¶ labels, [...] gaps and the title are the only overhead
    expect(sent.length).toBeLessThan(ASK_BUDGET_CHARS + 2_000);
    expect(sent.length).toBeLessThan(sum(paragraphs) / 4);
    expect(log).toHaveBeenCalledWith(
      "ask article context: retrieved, 100000 chars before, " +
        `${sum(
          [...sent.matchAll(/¶\d+[^\n]*\n(PARA[^\n]*)/g)].map((m) => m[1]),
        )} after`,
    );
  });

  it("includes the passage that answers it, under its real ¶ number", async () => {
    const { f, mock, seed, ask } = await setup();
    const paragraphs = article(100, 79);
    const articleId = await seed(OWNER);
    await ask(f.owner, { articleId, paragraphs });
    const prompt = mock.prompts.at(-1) ?? "";
    // The answer is on paragraph 80 and carries that number, with its own text
    expect(prompt).toContain(`¶80\n${paragraphs[79]}`);
    // Every paragraph sent is under its own number
    for (const match of articleSection(prompt).matchAll(
      /¶(\d+)[^\n]*\n(PARA(\d+))/g,
    ))
      expect(match[1]).toBe(match[3]);
    // The opening, the summary and gaps for what was left out
    expect(prompt).toContain(`¶1\n${paragraphs[0]}`);
    expect(prompt).toContain("A tour of zebra stripes.");
    expect(prompt).toContain("[…]");
    expect(prompt).not.toContain("PARA60 ");
  });

  it("keeps the paragraph on screen and any the question cites", async () => {
    const { f, mock, seed, ask } = await setup();
    const paragraphs = article(100, 79);
    const articleId = await seed(OWNER);
    await ask(f.owner, {
      articleId,
      paragraphs,
      paragraphIndex: 30,
      question: "Why does the zebra have stripes, given ¶12?",
    });
    const prompt = mock.prompts.at(-1) ?? "";
    expect(prompt).toContain(`¶31\n${paragraphs[30]}`);
    expect(prompt).toContain(`¶12\n${paragraphs[11]}`);
  });

  it("embeds an article once and reuses the passages", async () => {
    const { f, mock, seed, ask, rows } = await setup();
    const paragraphs = article(100, 79);
    const articleId = await seed(OWNER);
    await ask(f.owner, { articleId, paragraphs });
    const stored = await rows();
    expect(stored.length).toBe(chunkParagraphs(paragraphs).length);
    const first = mock.embedInputs.flat().length;
    expect(first).toBe(stored.length + 1);
    await ask(f.owner, { articleId, paragraphs, question: "Zebra again?" });
    // Only the question is embedded the second time
    expect(mock.embedInputs.flat().length).toBe(first + 1);
    expect((await rows()).length).toBe(stored.length);
    // A changed text is a new article: its passages are embedded again
    await ask(f.owner, {
      articleId,
      paragraphs: [...paragraphs, "A new closing paragraph."],
    });
    expect(mock.embedInputs.flat().length).toBeGreaterThan(
      first + 1 + stored.length,
    );
  });

  it("answers from the summary and the opening when the search fails, with no error", async () => {
    const { f, mock, seed, ask, rows } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.breakEmbeddings();
    const paragraphs = article(100, 79);
    const articleId = await seed(OWNER);
    const response = await ask(f.owner, { articleId, paragraphs });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Answer.");
    const prompt = mock.prompts.at(-1) ?? "";
    expect(prompt).toContain("A tour of zebra stripes.");
    expect(prompt).toContain(`¶1\n${paragraphs[0]}`);
    expect(prompt).not.toContain("PARA80 ");
    expect(articleSection(prompt).length).toBeLessThan(
      ASK_BUDGET_CHARS + 2_000,
    );
    expect(await rows()).toEqual([]);
  });

  it("keeps every cited paragraph whole, up to the full budget", async () => {
    const { f, mock, seed, ask } = await setup();
    const paragraphs = sized(20, 3_000);
    const articleId = await seed(OWNER);
    await ask(f.owner, {
      articleId,
      paragraphs,
      question: "Compare ¶10 and ¶15",
    });
    const prompt = mock.prompts.at(-1) ?? "";
    expect(prompt).toContain(`¶10\n${paragraphs[9]}`);
    expect(prompt).toContain(`¶15\n${paragraphs[14]}`);
    expect(prompt).toContain(`¶1\n${paragraphs[0]}`);
  });

  it("keeps cited paragraphs whole when the search fails too", async () => {
    const { f, mock, seed, ask } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.breakEmbeddings();
    const paragraphs = sized(20, 3_000);
    const articleId = await seed(OWNER);
    await ask(f.owner, {
      articleId,
      paragraphs,
      question: "Compare ¶10 and ¶15",
    });
    const prompt = mock.prompts.at(-1) ?? "";
    expect(prompt).toContain(`¶10\n${paragraphs[9]}`);
    expect(prompt).toContain(`¶15\n${paragraphs[14]}`);
    expect(prompt).toContain(`¶1\n${paragraphs[0]}`);
    // The rest of the budget runs from the start of the article
    expect(prompt).toContain(`¶2\n${paragraphs[1]}`);
    expect(articleSection(prompt).length).toBeLessThan(
      ASK_BUDGET_CHARS + 2_000,
    );
  });

  it("finds an answer deep inside a long paragraph and labels the piece", async () => {
    const { f, mock, seed, ask, rows } = await setup();
    const paragraphs = sized(20, 3_000);
    // ¶10 is 6,000 characters and the answer starts at character 4,500
    paragraphs[9] = (
      "Plain words about nothing. ".repeat(167) +
      "The zebra stripes deter flies. " +
      "More plain words. ".repeat(100)
    ).slice(0, 6_000);
    const answerAt = paragraphs[9].indexOf("zebra");
    expect(answerAt).toBeGreaterThan(4_000);
    const articleId = await seed(OWNER);
    await ask(f.owner, { articleId, paragraphs });
    const prompt = mock.prompts.at(-1) ?? "";
    expect(prompt).toContain("¶10 (cont.)\n");
    expect(prompt).toContain("The zebra stripes deter flies.");
    expect(prompt).not.toContain(paragraphs[9]);
    // The pieces were embedded and cached with their offsets
    const stored = (await rows()).filter((r) => r.startParagraph === 9);
    expect(stored.length).toBeGreaterThan(1);
    expect(stored.every((r) => r.endParagraph === 9)).toBe(true);
    // Cited, the paragraph comes whole
    await ask(f.owner, {
      articleId,
      paragraphs,
      question: "What about the zebra in ¶10?",
    });
    expect(mock.prompts.at(-1)).toContain(`¶10\n${paragraphs[9]}`);
  });

  it("sends an article that fits the budget whole, without searching", async () => {
    const { f, mock, seed, ask } = await setup();
    const paragraphs = sized(5, 3_000);
    const articleId = await seed(OWNER);
    await ask(f.owner, { articleId, paragraphs });
    const prompt = mock.prompts.at(-1) ?? "";
    for (const [i, p] of paragraphs.entries())
      expect(prompt).toContain(`¶${i + 1}\n${p}`);
    expect(mock.embedInputs).toEqual([]);
  });

  it("keeps a short article whole", async () => {
    const { f, mock, seed, ask } = await setup();
    const paragraphs = article(10, 4);
    expect(sum(paragraphs)).toBeLessThanOrEqual(ASK_FULL_TEXT_CHARS);
    const articleId = await seed(OWNER);
    await ask(f.owner, { articleId, paragraphs });
    const prompt = mock.prompts.at(-1) ?? "";
    for (const [i, p] of paragraphs.entries())
      expect(prompt).toContain(`¶${i + 1}\n${p}`);
    expect(prompt).not.toContain("[…]");
    expect(mock.embedInputs).toEqual([]);
  });

  it("keeps two readers apart", async () => {
    const { f, mock, seed, ask, rows } = await setup();
    const paragraphs = article(100, 79);
    const mine = await seed(OWNER);
    const theirs = await seed(f.readerLibraryId, "Theirs");
    await ask(f.owner, { articleId: mine, paragraphs });
    const ownerRows = (await rows(OWNER)).length;
    expect(ownerRows).toBeGreaterThan(0);
    const embedded = mock.embedInputs.flat().length;

    // The second reader names the owner's article: nothing is read or written for it
    const generated = mock.prompts.length;
    const response = await ask(f.reader, { articleId: mine, paragraphs });
    expect(response.status).toBe(404);
    expect(mock.prompts).toHaveLength(generated);
    expect(await rows(f.readerLibraryId)).toEqual([]);
    expect((await rows(OWNER)).length).toBe(ownerRows);
    expect(mock.embedInputs.flat().length).toBe(embedded);
    const cache = await f.t.query(internal.articlePassages.cached, {
      userId: f.readerLibraryId,
      articleId: mine,
      contentHash: "x",
      model: "x",
    });
    expect(cache).toBeNull();

    // Their own article is cached under their library
    await ask(f.reader, { articleId: theirs, paragraphs });
    expect((await rows(f.readerLibraryId)).length).toBe(ownerRows);
    expect((await rows(OWNER)).length).toBe(ownerRows);
  });

  it("removes an article's passages when the article goes", async () => {
    const { f, seed, ask, rows } = await setup();
    const articleId = await seed(OWNER);
    await ask(f.owner, { articleId, paragraphs: article(100, 79) });
    expect((await rows()).length).toBeGreaterThan(0);
    vi.useFakeTimers();
    await f.t.mutation(internal.articlePassages.discard, {
      userId: OWNER,
      articleId,
    });
    // A batch at a time, the rest scheduled
    try {
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }
    expect(await rows()).toEqual([]);
  });
});

describe("Ask about a passage", () => {
  const request = (over: Partial<CompanionRequest>): CompanionRequest =>
    companionRequestSchema.parse({
      mode: "ask",
      title: "The Zebra",
      paragraphs: article(100, 79),
      selection: "PARA51 Filler",
      paragraphIndex: 50,
      paragraphEnd: 50,
      question: "What does this mean?",
      ...over,
    });

  it("sees the passage, two paragraphs either side, the summary and the title", () => {
    const { messages } = buildCompanionPrompt(request({}), {
      thesis: "Stripes are about flies.",
      gist: "A tour of zebra stripes.",
    });
    const prompt = messages[0].content;
    for (const n of [49, 50, 51, 52, 53]) expect(prompt).toContain(`¶${n}`);
    for (const n of [48, 54]) expect(prompt).not.toContain(`¶${n}\n`);
    expect(prompt).toContain("← contains the highlighted passage");
    expect(prompt).toContain("# The Zebra");
    expect(prompt).toContain("A tour of zebra stripes.");
    expect(articleSection(prompt).length).toBeLessThan(6_000);
  });

  it("explains with one paragraph either side, as before", () => {
    const { messages } = buildCompanionPrompt(request({ mode: "explain" }));
    for (const n of [50, 51, 52])
      expect(messages[0].content).toContain(`¶${n}`);
    expect(messages[0].content).not.toContain("¶49\n");
    expect(messages[0].content).not.toContain("¶53\n");
  });

  it("never sends more than the budget when the passage can't be placed", () => {
    const { messages } = buildCompanionPrompt(
      request({ selection: "words found nowhere", paragraphIndex: null }),
    );
    expect(articleSection(messages[0].content).length).toBeLessThan(
      ASK_BUDGET_CHARS + 2_000,
    );
  });
});

describe("Ask about a passage reaching into the article", () => {
  const paragraphs = article(100, 79);
  const passageAsk = {
    mode: "ask",
    selection: "PARA51 Filler",
    paragraphIndex: 50,
    paragraphEnd: 50,
  };
  const elsewhere = (prompt: string) =>
    /<elsewhere_in_the_article>([\s\S]*?)<\/elsewhere_in_the_article>/.exec(
      prompt,
    )?.[1] ?? "";

  it("adds the best matches from the article when the question reaches beyond the passage, after the passage's own surroundings", async () => {
    const { f, mock, seed, ask } = await setup();
    const articleId = await seed(OWNER);
    const response = await ask(f.owner, {
      ...passageAsk,
      articleId,
      paragraphs,
      question: "How does this connect to the zebra stripes?",
    });
    expect(response.status).toBe(200);
    const prompt = mock.prompts.at(-1) ?? "";
    expect(elsewhere(prompt)).toContain(`¶80\n${paragraphs[79]}`);
    // At most three passages (one paragraph each here) come from elsewhere
    expect(new Set(elsewhere(prompt).match(/¶\d+/g)).size).toBeLessThanOrEqual(
      3,
    );
    // The passage and its neighbours are not repeated and come first
    for (const n of [49, 50, 51, 52, 53])
      expect(elsewhere(prompt)).not.toContain(`¶${n}\n`);
    const at = (text: string) => prompt.indexOf(text);
    expect(at(`¶51 ← contains the highlighted passage`)).toBeGreaterThan(-1);
    expect(at("¶51 ←")).toBeLessThan(at("<elsewhere_in_the_article>"));
    expect(at("<elsewhere_in_the_article>")).toBeLessThan(
      at("<highlighted_passage"),
    );
  });

  it("adds nothing when the question is best answered by the passage's surroundings", async () => {
    const { f, mock, seed, ask } = await setup();
    const articleId = await seed(OWNER);
    await ask(f.owner, {
      ...passageAsk,
      articleId,
      paragraphs,
      question: "What does this mean?",
    });
    expect(mock.prompts.at(-1)).not.toContain("<elsewhere_in_the_article>");
  });

  it("embeds only the question when the article's passages are cached", async () => {
    const { f, mock, seed, ask, rows } = await setup();
    const articleId = await seed(OWNER);
    await ask(f.owner, { articleId, paragraphs });
    const stored = (await rows()).length;
    const before = mock.embedInputs.flat().length;
    await ask(f.owner, {
      ...passageAsk,
      articleId,
      paragraphs,
      question: "How does this connect to the zebra stripes?",
    });
    expect(mock.embedInputs.flat().length).toBe(before + 1);
    expect((await rows()).length).toBe(stored);
  });

  it("keeps a cited paragraph and still answers when the search fails", async () => {
    const { f, mock, seed, ask } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.breakEmbeddings();
    const articleId = await seed(OWNER);
    const response = await ask(f.owner, {
      ...passageAsk,
      articleId,
      paragraphs,
      question: "How does this connect to ¶12 and the zebra?",
    });
    expect(response.status).toBe(200);
    const prompt = mock.prompts.at(-1) ?? "";
    expect(elsewhere(prompt)).toContain(`¶12\n${paragraphs[11]}`);
    expect(elsewhere(prompt)).not.toContain("PARA80 ");
    expect(prompt).toContain("¶51 ←");
  });

  it("searches only the reader's own article", async () => {
    const { f, mock, seed, ask, rows } = await setup();
    const mine = await seed(OWNER);
    const response = await ask(f.reader, {
      ...passageAsk,
      articleId: mine,
      paragraphs,
      question: "How does this connect to the zebra stripes?",
    });
    expect(response.status).toBe(404);
    expect(mock.prompts).toHaveLength(0);
    expect(mock.embedInputs).toHaveLength(0);
    expect(await rows()).toEqual([]);
  });
});

describe("the budget for a passage question", () => {
  const ask = (paragraphs: string[], question: string) =>
    companionRequestSchema.parse({
      mode: "ask",
      title: "T",
      paragraphs,
      selection: "x",
      paragraphIndex: 10,
      paragraphEnd: 10,
      question,
    });

  it("keeps the window and a long citation within the one budget", async () => {
    // A 15,000-character window (five 3,000-character paragraphs) and a 10,000-character citation
    const paragraphs = Array.from({ length: 30 }, (_, i) =>
      `P${i + 1} `.padEnd(i === 2 ? 10_000 : 3_000, "w"),
    );
    const request = ask(paragraphs, "How does this follow from ¶3?");
    const { indices } = selectContext(request);
    expect(indices).toEqual([8, 9, 10, 11, 12]);
    const windowChars = indices.reduce((n, i) => n + paragraphs[i].length, 0);
    expect(windowChars).toBe(15_000);
    const { related } = await retrievePassageContext({} as never, {
      userId: "u",
      articleId: undefined,
      paragraphs,
      window: indices,
      question: request.question ?? "",
      history: [],
      embedder: null,
    });
    // The citation gets what the window left, cut where the budget ends
    expect(related?.chars).toBe(ASK_BUDGET_CHARS - windowChars);
    expect(windowChars + (related?.chars ?? 0)).toBeLessThanOrEqual(
      ASK_BUDGET_CHARS,
    );
  });

  it("trims the outer window paragraphs first when the window alone is too big", () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) =>
      `P${i + 1} `.padEnd(4_000, "w"),
    );
    const { indices, marked } = selectContext(ask(paragraphs, "Why?"));
    // Five at 4,000 is 20,000: the farthest goes (the later one on a tie) until it fits 16,000
    expect(indices).toEqual([8, 9, 10, 11]);
    expect([...marked]).toEqual([10]);
    expect(indices).toContain(10);
  });
});

describe("chunking", () => {
  it("splits only paragraphs over the limit, keeping their index and offsets", () => {
    const paragraphs = [
      "Short one.",
      "x".repeat(LONG_PARAGRAPH_CHARS + 1_000),
      "Short two.",
    ];
    const spans = chunkParagraphs(paragraphs);
    const pieces = spans.filter((s) => s.start === 1 && s.end === 1);
    expect(pieces.length).toBeGreaterThan(1);
    // Together the pieces are the paragraph, in order, with nothing lost
    expect(pieces.map((s) => passageText(paragraphs, s)).join("")).toBe(
      paragraphs[1],
    );
    expect(spans[0]).toMatchObject({ start: 0, end: 0 });
    expect(spans.at(-1)).toMatchObject({ start: 2, end: 2 });
  });
});

describe("citations in a question", () => {
  it("reads single paragraphs and ranges as zero-based indices", () => {
    expect(citedParagraphs("see ¶3 and ¶10–12, not ¶900", 20)).toEqual([
      2, 9, 10, 11,
    ]);
  });
});
