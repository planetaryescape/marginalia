/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveTestCredential, secondReaderTest } from "../test/owner";
import { internal } from "./_generated/api";
import {
  ASK_BUDGET_CHARS,
  ASK_FULL_TEXT_CHARS,
  chunkParagraphs,
  citedParagraphs,
  FALLBACK_HEAD_CHARS,
} from "./lib/articleAsk";
import {
  buildCompanionPrompt,
  type CompanionRequest,
  companionRequestSchema,
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
      FALLBACK_HEAD_CHARS + 2_000,
    );
    expect(await rows()).toEqual([]);
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
    const response = await ask(f.reader, { articleId: mine, paragraphs });
    expect(response.status).toBe(200);
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

describe("citations in a question", () => {
  it("reads single paragraphs and ranges as zero-based indices", () => {
    expect(citedParagraphs("see ¶3 and ¶10–12, not ¶900", 20)).toEqual([
      2, 9, 10, 11,
    ]);
  });
});
