/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runScheduled,
  saveTestCredential,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { BATCH_DELAY_MS, JOB_STAGGER_MS } from "./catchUp";
import {
  BATCH_JOBS,
  CLAIM_TTL_MS,
  EMBED_BATCH,
  MAX_ATTEMPTS,
  MAX_UNIT_FAILURES,
} from "./lib/bookIndex";
import { encryptProviderKey } from "./lib/providerKeys";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const OWNER_KEY = "sk-or-owner-openrouter-fixture-0001";
const READER_KEY = "sk-or-reader-openrouter-fixture-0002";

type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  vi.stubEnv("OPENROUTER_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A one-hot vector keyed on a word, so a search can tell which text matched. */
function vectorFor(text: string) {
  const vector = new Array<number>(1536).fill(0);
  vector[text.includes("alpha") ? 0 : text.includes("beta") ? 1 : 2] = 1;
  return vector;
}

/** Answers embeddings, summaries, the book's point and streamed answers; records each call. */
function mockProviders() {
  const prompts: { system: string; user: string }[] = [];
  const embedBatches: number[] = [];
  const embedInputs: string[] = [];
  let failSummaries = false;
  let embedStatus: number | null = null;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const request = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.endsWith("/embeddings") && embedStatus !== null)
        return new Response("refused", { status: embedStatus });
      if (url.endsWith("/embeddings")) {
        const texts = request.input as string[];
        embedBatches.push(texts.length);
        embedInputs.push(...texts);
        return Response.json({
          data: texts.map((text, index) => ({
            index,
            embedding: vectorFor(text),
          })),
        });
      }
      if (!url.endsWith("/chat/completions"))
        return Response.json({ data: [] });
      const messages = request.messages as { role: string; content: string }[];
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const user = messages.filter((m) => m.role === "user").at(-1)?.content;
      prompts.push({ system, user: user ?? "" });
      if (request.stream)
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Answer." } }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        );
      if (failSummaries && !user?.includes("<parts>"))
        return new Response("nope", { status: 400 });
      const content = user?.includes("<parts>")
        ? { thesis: "The book's point.", gist: "The book's gist." }
        : {
            summary: `About part ${/Part (\d+) of/.exec(user ?? "")?.[1]}.`,
          };
      return Response.json({
        id: "x",
        created: 1,
        model: request.model,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: JSON.stringify(content) },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    },
  );
  return {
    prompts,
    embedBatches,
    embedInputs,
    embedStatus: (status: number | null) => {
      embedStatus = status;
    },
    failSummaries: (on: boolean) => {
      failSummaries = on;
    },
    summaryPrompts: () =>
      prompts.filter((p) => p.system.startsWith("You summarise")),
    pointPrompts: () => prompts.filter((p) => p.user.includes("<parts>")),
  };
}

const paragraph = (marker: string, n: number) =>
  `${marker} paragraph ${n}. ${"Words worth reading slowly. ".repeat(8)}`;

/** A book of units, each with a marker only its own text carries. */
async function seedBook(
  { t }: Pick<Fixture, "t">,
  userId: string,
  units: { words?: number; paragraphs?: number; keyword?: string }[],
  title = "Systems Thinking",
) {
  return t.run(async (ctx) => {
    const articleId = await ctx.db.insert("articles", {
      userId,
      guid: `upload:${title}:${userId}`,
      url: `upload:${title}:${userId}`,
      title,
      extractionStatus: "extracted",
      annotationStatus: "skipped",
      bookUnitCount: units.length,
      bookOutline: units.map((_, i) => ({
        title: `Unit ${i + 1}`,
        minutes: 5,
      })),
      createdAt: Date.now(),
    });
    await ctx.db.insert("books", {
      userId,
      articleId,
      unitCount: units.length,
      finishedThrough: -1,
      furthestUnit: -1,
      furthestScroll: 0,
      finished: false,
      createdAt: Date.now(),
    });
    for (const [index, unit] of units.entries()) {
      const marker = `MARK${index + 1}${unit.keyword ? ` ${unit.keyword}` : ""}`;
      const content = Array.from({ length: unit.paragraphs ?? 3 }, (_, n) =>
        paragraph(marker, n),
      ).join("\n\n");
      await ctx.db.insert("bookUnits", {
        userId,
        articleId,
        index,
        title: `Unit ${index + 1}`,
        content,
        contentHtml: `<p>${content}</p>`,
        wordCount: unit.words ?? 400,
        estimatedReadMinutes: 5,
        annotationStatus: "deferred",
      });
    }
    return articleId;
  });
}

const state = (f: Pick<Fixture, "t">, articleId: Id<"articles">) =>
  f.t.run((ctx) =>
    ctx.db
      .query("bookIndexState")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", OWNER).eq("articleId", articleId),
      )
      .unique(),
  );

const indexRows = (
  f: Pick<Fixture, "t">,
  stage: "summary" | "passages",
  userId = OWNER,
) =>
  f.t.run(async (ctx) =>
    (
      await ctx.db
        .query("bookIndexUnits")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .take(500)
    )
      .filter((row) => row.stage === stage)
      .sort((a, b) => a.unitIndex - b.unitIndex),
  );

/** Scheduled jobs of one function that have not run yet. */
const scheduled = (f: Pick<Fixture, "t">, fn: string) =>
  f.t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").take(1000)).filter(
      (job) => job.name.includes(fn) && job.state.kind === "pending",
    ),
  );

const step = (f: Pick<Fixture, "t">, articleId: Id<"articles">, runId = 1) =>
  f.t.mutation(internal.bookIndex.step, { userId: OWNER, articleId, runId });

const start = (f: Pick<Fixture, "t">, articleId: Id<"articles">) =>
  f.t.mutation(internal.bookIndex.start, { userId: OWNER, articleId });

describe("the summary queue", () => {
  it("queues a small batch with a stagger, then waits before the next", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, OWNER, "openrouter", OWNER_KEY);
    const articleId = await seedBook(
      f,
      OWNER,
      Array.from({ length: 12 }, () => ({})),
    );
    expect(await start(f, articleId)).toBe("started");
    const now = Date.now();
    await step(f, articleId);

    const rows = await indexRows(f, "summary");
    expect(
      rows.map((row) => [row.unitIndex, row.status, row.attempts]),
    ).toEqual(Array.from({ length: BATCH_JOBS }, (_, i) => [i, "pending", 1]));
    const jobs = (await scheduled(f, "summarizeUnit")).sort(
      (a, b) => a.scheduledTime - b.scheduledTime,
    );
    expect(jobs.map((job) => job.scheduledTime - now)).toEqual(
      Array.from({ length: BATCH_JOBS }, (_, i) => i * JOB_STAGGER_MS),
    );
    // The next batch waits, and only one step is ever scheduled ahead
    const steps = (await scheduled(f, "bookIndex:step")).filter(
      (job) => job.scheduledTime - now >= BATCH_DELAY_MS,
    );
    expect(steps).toHaveLength(1);
    expect((await state(f, articleId))?.cursor).toBe(BATCH_JOBS);
  });

  it("does not schedule a unit that holds a live claim, and takes a lost claim again", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, OWNER, "openrouter", OWNER_KEY);
    const articleId = await seedBook(
      f,
      OWNER,
      Array.from({ length: BATCH_JOBS }, () => ({})),
    );
    await start(f, articleId);
    await step(f, articleId);
    expect(await scheduled(f, "summarizeUnit")).toHaveLength(BATCH_JOBS);

    // A restart rescans from the top: every claim is live, so nothing is queued
    const rewind = () =>
      f.t.run(async (ctx) => {
        const row = await ctx.db.query("bookIndexState").first();
        if (row) await ctx.db.patch("bookIndexState", row._id, { cursor: 0 });
      });
    await rewind();
    await step(f, articleId);
    expect(await scheduled(f, "summarizeUnit")).toHaveLength(BATCH_JOBS);

    // The jobs never reported: after the TTL they are claimed again, up to the cap
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      vi.advanceTimersByTime(CLAIM_TTL_MS + 1);
      await rewind();
      await step(f, articleId);
      expect((await indexRows(f, "summary")).map((r) => r.attempts)).toEqual(
        Array.from({ length: BATCH_JOBS }, () => attempt),
      );
    }
    vi.advanceTimersByTime(CLAIM_TTL_MS + 1);
    await rewind();
    await step(f, articleId);
    expect((await indexRows(f, "summary")).map((r) => r.status)).toEqual(
      Array.from({ length: BATCH_JOBS }, () => "failed"),
    );
  });

  it("ignores a job whose claim was replaced", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, OWNER, "openrouter", OWNER_KEY);
    const articleId = await seedBook(f, OWNER, [{}]);
    await start(f, articleId);
    await step(f, articleId);
    const [row] = await indexRows(f, "summary");
    const stale = row.claimedAt - 1;
    expect(
      await f.t.mutation(internal.bookIndex.completeJob, {
        userId: OWNER,
        articleId,
        stage: "summary",
        unitIndex: 0,
        claim: stale,
        status: "done",
        summary: "Late.",
      }),
    ).toBe(false);
    expect((await indexRows(f, "summary"))[0]).toMatchObject({
      status: "pending",
    });
  });

  it("does not start without a key, and stops quietly when the key goes", async () => {
    const f = await secondReaderTest(modules);
    const articleId = await seedBook(f, OWNER, [{}, {}]);
    expect(await start(f, articleId)).toMatch(/^not started/);
    expect(await state(f, articleId)).toBeNull();

    const credential = await saveTestCredential(
      f.t,
      OWNER,
      "openrouter",
      OWNER_KEY,
    );
    expect(await start(f, articleId)).toBe("started");
    await f.t.run((ctx) => ctx.db.delete("providerCredentials", credential));
    await step(f, articleId);
    expect(await state(f, articleId)).toMatchObject({
      running: false,
      phase: "summaries",
    });
    expect(await indexRows(f, "summary")).toEqual([]);
    expect(await scheduled(f, "summarizeUnit")).toEqual([]);
  });

  it("does nothing for a disabled library", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, f.readerLibraryId, "openrouter", READER_KEY);
    const articleId = await seedBook(f, f.readerLibraryId, [{}]);
    await f.t.run(async (ctx) => {
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.readerLibraryId))
        .first();
      if (reader)
        await ctx.db.patch("readers", reader._id, { status: "disabled" });
    });
    expect(
      await f.t.mutation(internal.bookIndex.start, {
        userId: f.readerLibraryId,
        articleId,
      }),
    ).toMatch(/^not started/);
  });

  it("stops a running index when the library is disabled mid-run", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, f.readerLibraryId, "openrouter", READER_KEY);
    const articleId = await seedBook(f, f.readerLibraryId, [{}, {}]);
    const args = { userId: f.readerLibraryId, articleId };
    await f.t.mutation(internal.bookIndex.start, args);
    await f.t.run(async (ctx) => {
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.readerLibraryId))
        .first();
      if (reader)
        await ctx.db.patch("readers", reader._id, { status: "disabled" });
    });
    await f.t.mutation(internal.bookIndex.step, { ...args, runId: 1 });
    expect(await indexRows(f, "summary", f.readerLibraryId)).toEqual([]);
  });
});

describe("indexing a whole book", () => {
  it("summarises each unit from its own text, then writes the point from the summaries, then embeds passages", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, OWNER, "openrouter", OWNER_KEY);
    const mock = mockProviders();
    const articleId = await seedBook(f, OWNER, [
      {},
      { words: 10 },
      {},
      {},
      {},
      {},
      {},
    ]);
    // The point annotating part 1 wrote, to be replaced
    await f.t.run((ctx) =>
      ctx.db.insert("summaries", {
        userId: OWNER,
        articleId,
        thesis: "From part one only.",
        gist: "Old gist.",
        model: "fixture",
        createdAt: Date.now(),
      }),
    );

    await start(f, articleId);
    await runScheduled(f.t, { stepMs: 15_000 });

    // One call per unit with a body; the 10-word unit is skipped without a call
    expect(mock.summaryPrompts()).toHaveLength(6);
    for (const { user } of mock.summaryPrompts()) {
      const markers = [...user.matchAll(/MARK\d+/g)].map((m) => m[0]);
      const part = /Part (\d+) of 7/.exec(user)?.[1];
      expect(new Set(markers)).toEqual(new Set([`MARK${part}`]));
      expect(user).toContain("Book: Systems Thinking");
    }
    const summaries = await indexRows(f, "summary");
    expect(summaries.map((row) => row.status)).toEqual([
      "done",
      "skipped",
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);

    // The one point comes from the summaries alone, in one call
    expect(mock.pointPrompts()).toHaveLength(1);
    const point = mock.pointPrompts()[0].user;
    expect(point).toContain("Part 3: Unit 3. About part 3.");
    expect(point).not.toContain("MARK");
    const overview = await f.owner.query(api.summaries.getByArticle, {
      articleId,
    });
    expect(overview).toMatchObject({
      thesis: "The book's point.",
      gist: "The book's gist.",
    });
    expect(
      await f.t.run((ctx) => ctx.db.query("summaries").take(10)),
    ).toHaveLength(1);

    // The outline carries each part's summary
    const book = await f.owner.query(api.books.get, { articleId });
    expect(book?.summaries).toEqual([
      "About part 1.",
      null,
      "About part 3.",
      "About part 4.",
      "About part 5.",
      "About part 6.",
      "About part 7.",
    ]);

    // Passages are stored per unit, under their heading
    const passages = await f.t.run((ctx) =>
      ctx.db.query("bookPassages").take(500),
    );
    expect(passages.length).toBeGreaterThanOrEqual(7);
    expect(new Set(passages.map((p) => p.articleId))).toEqual(
      new Set([articleId]),
    );
    expect(passages[0].heading).toBe("Systems Thinking › Unit 1");
    expect(await state(f, articleId)).toMatchObject({
      phase: "done",
      running: false,
    });
    // Done is done: starting again does nothing
    expect(await start(f, articleId)).toBe("already indexed");
  });

  it("embeds passages in bounded batches", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, OWNER, "openrouter", OWNER_KEY);
    const mock = mockProviders();
    const articleId = await seedBook(f, OWNER, [
      { paragraphs: 150 },
      { paragraphs: 3 },
    ]);
    await f.t.run(async (ctx) => {
      // Long paragraphs so each fills a passage by itself: 150 passages in one unit
      const unit = await ctx.db
        .query("bookUnits")
        .withIndex("by_userId_and_articleId_and_index", (q) =>
          q.eq("userId", OWNER).eq("articleId", articleId).eq("index", 0),
        )
        .unique();
      if (unit)
        await ctx.db.patch("bookUnits", unit._id, {
          content: Array.from(
            { length: 150 },
            (_, n) => `MARK1 long ${n}. ${"w".repeat(1_000)}`,
          ).join("\n\n"),
        });
    });
    await start(f, articleId);
    await runScheduled(f.t, { stepMs: 15_000 });

    const passages = await f.t.run((ctx) =>
      ctx.db
        .query("bookPassages")
        .withIndex("by_userId_and_articleId_and_unitIndex", (q) =>
          q.eq("userId", OWNER).eq("articleId", articleId).eq("unitIndex", 0),
        )
        .take(500),
    );
    expect(passages).toHaveLength(150);
    expect(Math.max(...mock.embedBatches)).toBeLessThanOrEqual(EMBED_BATCH);
    expect(mock.embedBatches.filter((n) => n === EMBED_BATCH).length).toBe(2);
    // Every passage of both units was embedded once
    const all = await f.t.run((ctx) => ctx.db.query("bookPassages").take(500));
    expect(mock.embedBatches.reduce((a, b) => a + b, 0)).toBe(all.length);
    expect(
      (await indexRows(f, "passages")).find((row) => row.unitIndex === 0),
    ).toMatchObject({ status: "done", passageCount: 150 });
  });

  it("retries a failed summary and then gives up, leaving the part-1 point", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, OWNER, "openrouter", OWNER_KEY);
    const mock = mockProviders();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.failSummaries(true);
    const articleId = await seedBook(f, OWNER, [{}, {}]);
    await f.t.run((ctx) =>
      ctx.db.insert("summaries", {
        userId: OWNER,
        articleId,
        thesis: "From part one only.",
        gist: "Old gist.",
        model: "fixture",
        createdAt: Date.now(),
      }),
    );
    await start(f, articleId);
    await runScheduled(f.t, { stepMs: 15_000 });
    const rows = await indexRows(f, "summary");
    expect(rows.map((row) => [row.status, row.attempts])).toEqual([
      ["failed", MAX_ATTEMPTS],
      ["failed", MAX_ATTEMPTS],
    ]);
    // No summary, so no call for the point, and the part-1 one stands
    expect(mock.pointPrompts()).toHaveLength(0);
    expect(
      (await f.owner.query(api.summaries.getByArticle, { articleId }))?.thesis,
    ).toBe("From part one only.");
    // The passages still got searchable
    expect(await state(f, articleId)).toMatchObject({ phase: "done" });
  });

  it("stops after the summaries when there is only a key that can't embed", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(
      f.t,
      OWNER,
      "anthropic",
      "sk-ant-owner-fixture-0003",
    );
    mockProviders();
    const articleId = await seedBook(f, OWNER, [{}]);
    await start(f, articleId);
    await runScheduled(f.t, { stepMs: 15_000 });
    expect(await state(f, articleId)).toMatchObject({
      phase: "passages",
      running: false,
    });
    expect(
      await f.t.run((ctx) => ctx.db.query("bookPassages").take(5)),
    ).toEqual([]);
  });
});

describe("backfilling books already imported", () => {
  it("indexes each unindexed book of the library, one after another, and none of another reader's", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, OWNER, "openrouter", OWNER_KEY);
    await saveTestCredential(f.t, f.readerLibraryId, "openrouter", READER_KEY);
    mockProviders();
    const first = await seedBook(f, OWNER, [{}, {}], "First");
    const second = await seedBook(f, OWNER, [{}], "Second");
    const theirs = await seedBook(f, f.readerLibraryId, [{}], "Theirs");
    expect(
      await f.t.mutation(internal.bookIndex.backfill, { userId: OWNER }),
    ).toBe("scheduled 2 of 2 books");
    await runScheduled(f.t, { stepMs: 15_000 });
    expect(await state(f, first)).toMatchObject({ phase: "done" });
    expect(await state(f, second)).toMatchObject({ phase: "done" });
    expect(
      await f.t.run((ctx) =>
        ctx.db
          .query("bookIndexState")
          .withIndex("by_userId", (q) => q.eq("userId", f.readerLibraryId))
          .take(5),
      ),
    ).toEqual([]);
    expect(theirs).toBeTruthy();
    // A second run finds them done
    expect(
      await f.t.mutation(internal.bookIndex.backfill, { userId: OWNER }),
    ).toBe("scheduled 0 of 2 books");
  });
});

describe("two readers", () => {
  it("never shows one reader another's summaries, and counts only their own rows", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, OWNER, "openrouter", OWNER_KEY);
    mockProviders();
    const articleId = await seedBook(f, OWNER, [{}, {}]);
    await start(f, articleId);
    await runScheduled(f.t, { stepMs: 15_000 });
    expect(
      (await f.owner.query(api.books.get, { articleId }))?.summaries,
    ).toEqual(["About part 1.", "About part 2."]);
    expect(await f.reader.query(api.books.get, { articleId })).toBeNull();
    expect(
      await f.reader.query(api.summaries.getByArticle, { articleId }),
    ).toBeNull();
    // Their own library has nothing indexed
    expect(await indexRows(f, "summary", f.readerLibraryId)).toEqual([]);
  });

  it("starting another reader's book does nothing", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, f.readerLibraryId, "openrouter", READER_KEY);
    const articleId = await seedBook(f, OWNER, [{}]);
    expect(
      await f.t.mutation(internal.bookIndex.start, {
        userId: f.readerLibraryId,
        articleId,
      }),
    ).toBe("not started: no such book");
  });
});

describe("Ask about this book", () => {
  /** Two readers' books with alpha and beta passages; the answer's prompt is captured. */
  async function askSetup() {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, OWNER, "openrouter", OWNER_KEY);
    await saveTestCredential(f.t, f.readerLibraryId, "openrouter", READER_KEY);
    const mock = mockProviders();
    const mine = await seedBook(f, OWNER, [{}, {}, {}], "My Book");
    const theirs = await seedBook(f, f.readerLibraryId, [{}], "Their Book");
    await f.t.run(async (ctx) => {
      const add = async (
        userId: string,
        articleId: Id<"articles">,
        unitIndex: number,
        text: string,
      ) =>
        ctx.db.insert("bookPassages", {
          userId,
          articleId,
          unitIndex,
          passageIndex: 0,
          heading: `Heading ${unitIndex + 1}`,
          text,
          embedding: vectorFor(text),
        });
      await add(OWNER, mine, 1, "alpha passage in my book");
      await add(OWNER, mine, 2, "beta passage in my book");
      await add(f.readerLibraryId, theirs, 0, "alpha passage in THEIR book");
      await ctx.db.insert("bookIndexUnits", {
        userId: OWNER,
        articleId: mine,
        stage: "summary",
        unitIndex: 1,
        status: "done",
        claimedAt: 0,
        attempts: 1,
        summary: "Part two is about alpha things.",
      });
    });
    return { f, mock, mine, theirs };
  }

  const ask = (
    client: { fetch: (path: string, init: RequestInit) => Promise<Response> },
    body: Record<string, unknown>,
  ) =>
    client.fetch("/api/companion", {
      method: "POST",
      body: JSON.stringify({
        mode: "article",
        title: "My Book",
        paragraphs: ["First paragraph of part one.", "Second paragraph."],
        selection: "",
        paragraphIndex: null,
        question: "What about alpha?",
        ...body,
      }),
    });

  it("retrieves the passages that match, from this book only, with the outline", async () => {
    const { f, mock, mine } = await askSetup();
    const response = await ask(f.owner, { articleId: mine, unitIndex: 0 });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Answer.");
    const { system, user } = mock.prompts.at(-1) ?? { system: "", user: "" };
    expect(user).toContain("[Part 2] Heading 2\nalpha passage in my book");
    // The beta passage doesn't match the question; the other reader's alpha is out of reach
    expect(user).not.toContain("beta passage");
    expect(user).not.toContain("THEIR");
    // The outline carries every part's title and the summaries that exist
    expect(user).toContain("Part 1: Unit 1");
    expect(user).toContain("Part 2: Unit 2. Part two is about alpha things.");
    expect(user).toContain("Part 3: Unit 3");
    // ¶ belongs to the part on screen, and the answer is told so
    expect(user).toContain('<article part="1 of 3">');
    expect(user).toContain("¶1\nFirst paragraph of part one.");
    expect(system).toContain('say "Part N"');
  });

  it("carries the part on screen and the outline, not the book", async () => {
    const { f, mock, mine } = await askSetup();
    await ask(f.owner, { articleId: mine, unitIndex: 0 });
    const { user } = mock.prompts.at(-1) ?? { user: "" };
    // The units' own text never travels
    expect(user).not.toContain("MARK");
    expect(user.length).toBeLessThan(4_000);
  });

  it("answers from the outline alone when the question can't be embedded", async () => {
    const { f, mock, mine } = await askSetup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/embeddings")
        ? Promise.resolve(new Response("down", { status: 500 }))
        : original(input, init),
    );
    const response = await ask(f.owner, { articleId: mine, unitIndex: 1 });
    expect(await response.text()).toBe("Answer.");
    const { user } = mock.prompts.at(-1) ?? { user: "" };
    expect(user).toContain("Part 2: Unit 2. Part two is about alpha things.");
    expect(user).toContain("aren't searchable yet");
    expect(user).not.toContain("alpha passage in my book");
  });

  it("searches for the latest question joined with the one before, not the first alone", async () => {
    const { f, mock, mine } = await askSetup();
    await ask(f.owner, { articleId: mine, unitIndex: 0 });
    const first = mock.embedInputs.at(-1);
    expect(first).toBe("What about alpha?");
    await ask(f.owner, {
      articleId: mine,
      unitIndex: 0,
      history: [
        { role: "assistant", content: "Alpha is the first thing." },
        { role: "user", content: "And what about beta?" },
      ],
    });
    // The follow-up is resolved by the question it follows
    expect(mock.embedInputs.at(-1)).toBe(
      "What about alpha?\nAnd what about beta?",
    );
    await ask(f.owner, {
      articleId: mine,
      unitIndex: 0,
      history: [
        { role: "user", content: "And what about beta?" },
        { role: "assistant", content: "Beta is the second." },
        { role: "user", content: "Which came first?" },
      ],
    });
    // Only the last two user turns count
    expect(mock.embedInputs.at(-1)).toBe(
      "And what about beta?\nWhich came first?",
    );
  });

  it("gives another reader's book no context at all", async () => {
    const { f, mock, mine } = await askSetup();
    // The second reader names the owner's book
    const response = await ask(f.reader, { articleId: mine, unitIndex: 0 });
    expect(response.status).toBe(404);
    expect(mock.prompts).toHaveLength(0);
    expect(mock.embedInputs).toHaveLength(0);
  });

  it("reads another reader's passages as nothing", async () => {
    const { f, mine, theirs } = await askSetup();
    const ids = await f.t.run(async (ctx) =>
      (await ctx.db.query("bookPassages").take(10)).map((p) => p._id),
    );
    // Right reader, wrong book; wrong reader, right book
    expect(
      await f.t.query(internal.bookIndex.loadPassages, {
        userId: OWNER,
        articleId: theirs,
        ids,
      }),
    ).toEqual([]);
    expect(
      await f.t.query(internal.bookIndex.loadPassages, {
        userId: f.readerLibraryId,
        articleId: mine,
        ids,
      }),
    ).toEqual([]);
    expect(
      await f.t.query(internal.bookIndex.loadPassages, {
        userId: OWNER,
        articleId: mine,
        ids,
      }),
    ).toHaveLength(2);
  });

  it("leaves an ordinary article's Ask alone", async () => {
    const { f, mock } = await askSetup();
    const articleId = await f.t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: OWNER,
        guid: "plain",
        url: "https://example.com/plain",
        title: "Plain",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      }),
    );
    const response = await ask(f.owner, { articleId, unitIndex: 0 });
    expect(await response.text()).toBe("Answer.");
    const { user, system } = mock.prompts.at(-1) ?? { user: "", system: "" };
    expect(user).not.toContain("<book_outline>");
    expect(system).not.toContain("whole book");
  });
});

describe("when indexing is interrupted", () => {
  const sealed = (userId: string, key: string) =>
    encryptProviderKey(key, userId, "openrouter");

  it("writes nothing for a reader being deleted, then nothing after the purge", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, f.readerLibraryId, "openrouter", READER_KEY);
    const mock = mockProviders();
    const userId = f.readerLibraryId;
    const articleId = await seedBook(f, userId, [{}, {}]);
    await f.t.mutation(internal.bookIndex.start, { userId, articleId });
    await f.t.mutation(internal.bookIndex.step, {
      userId,
      articleId,
      runId: 1,
    });
    const claims = (await indexRows(f, "summary", userId)).map(
      (row) => row.claimedAt,
    );
    expect(claims).toHaveLength(2);
    // A passages job holding a claim, as one would mid-flight
    const claim = Date.now();
    await f.t.run((ctx) =>
      ctx.db.insert("bookIndexUnits", {
        userId,
        articleId,
        stage: "passages",
        unitIndex: 0,
        status: "pending",
        claimedAt: claim,
        attempts: 1,
      }),
    );
    const late = async () => ({
      completed: await f.t.mutation(internal.bookIndex.completeJob, {
        userId,
        articleId,
        stage: "summary",
        unitIndex: 0,
        claim: claims[0],
        status: "done",
        summary: "Late.",
      }),
      cleared: await f.t.mutation(internal.bookIndex.clearPassages, {
        userId,
        articleId,
        unitIndex: 0,
        claim,
      }),
      added: await f.t.mutation(internal.bookIndex.addPassages, {
        userId,
        articleId,
        unitIndex: 0,
        claim,
        passages: [
          {
            passageIndex: 0,
            heading: "H",
            text: "T",
            embedding: vectorFor(""),
          },
        ],
      }),
      overview: await f.t.mutation(internal.summaries.saveBookOverview, {
        userId,
        articleId,
        thesis: "Late.",
        gist: "Late.",
        model: "x",
      }),
    });
    // Live: the claims are honoured
    expect(await late()).toMatchObject({ completed: true, added: true });

    await f.reader.mutation(api.account.deleteMine, { confirmation: "DELETE" });
    // Deletion has begun; claims still exist, and a late job still writes nothing
    const before = await f.t.run(async (ctx) => ({
      passages: (await ctx.db.query("bookPassages").take(50)).length,
      units: await ctx.db.query("bookIndexUnits").take(50),
    }));
    expect(await late()).toEqual({
      completed: false,
      cleared: false,
      added: false,
      overview: null,
    });
    expect(
      await f.t.run(
        async (ctx) => (await ctx.db.query("bookPassages").take(50)).length,
      ),
    ).toBe(before.passages);

    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    // Jobs that were already scheduled found a purged library and called no model
    expect(mock.prompts).toEqual([]);
    expect(await late()).toEqual({
      completed: false,
      cleared: false,
      added: false,
      overview: null,
    });
    const left = await f.t.run(async (ctx) => {
      const mine = <T extends { userId: string }>(rows: T[]) =>
        rows.filter((row) => row.userId === userId).length;
      return [
        mine(await ctx.db.query("bookPassages").take(100)),
        mine(await ctx.db.query("bookIndexUnits").take(100)),
        mine(await ctx.db.query("bookIndexState").take(100)),
        mine(await ctx.db.query("summaries").take(100)),
        mine(await ctx.db.query("bookUnits").take(100)),
      ];
    });
    expect(left).toEqual([0, 0, 0, 0, 0]);
  });

  it("retries a lost overview call within its cap, then moves on keeping the part-1 point", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, OWNER, "openrouter", OWNER_KEY);
    const articleId = await seedBook(f, OWNER, [{}, {}]);
    await f.t.run(async (ctx) => {
      for (const unitIndex of [0, 1])
        await ctx.db.insert("bookIndexUnits", {
          userId: OWNER,
          articleId,
          stage: "summary",
          unitIndex,
          status: "done",
          claimedAt: 0,
          attempts: 1,
          summary: `About part ${unitIndex + 1}.`,
        });
    });
    await start(f, articleId);
    await f.t.run(async (ctx) => {
      const row = await ctx.db.query("bookIndexState").first();
      if (row)
        await ctx.db.patch("bookIndexState", row._id, { phase: "point" });
    });
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await step(f, articleId);
      const claimed = await state(f, articleId);
      expect(claimed).toMatchObject({ phase: "point", pointAttempts: attempt });
      const claim = claimed?.pointClaimedAt as number;
      // The action is lost: it never reports. A step meanwhile leaves the claim alone.
      await step(f, articleId);
      expect((await state(f, articleId))?.pointAttempts).toBe(attempt);
      // The watchdog was scheduled with the claim
      expect(
        (await scheduled(f, "pointWatchdog")).some(
          (job) => job.args[0].claim === claim,
        ),
      ).toBe(true);
      // The clock moves without running what is scheduled: the action is lost
      vi.setSystemTime(Date.now() + CLAIM_TTL_MS + 2_000);
      await f.t.mutation(internal.bookIndex.pointWatchdog, {
        userId: OWNER,
        articleId,
        runId: 1,
        claim,
      });
      expect((await state(f, articleId))?.pointClaimedAt).toBeUndefined();
      // A watchdog for a claim that is gone does nothing
      await f.t.mutation(internal.bookIndex.pointWatchdog, {
        userId: OWNER,
        articleId,
        runId: 1,
        claim,
      });
    }
    await step(f, articleId);
    expect(await state(f, articleId)).toMatchObject({
      phase: "passages",
      running: true,
    });
  });

  it("pauses on a credential that won't open and resumes when a key is saved, counting the pause", async () => {
    const f = await secondReaderTest(modules);
    const mock = mockProviders();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const credential = await saveTestCredential(
      f.t,
      OWNER,
      "openrouter",
      OWNER_KEY,
    );
    const original = await f.t.run((ctx) =>
      ctx.db.get("providerCredentials", credential),
    );
    await f.t.run((ctx) =>
      ctx.db.patch("providerCredentials", credential, {
        ciphertext: "not-a-real-ciphertext",
      }),
    );
    const articleId = await seedBook(f, OWNER, [{}, {}, {}]);
    await start(f, articleId);
    await runScheduled(f.t, { stepMs: 15_000 });

    // Stopped with a reason, no model call, and the tries were refunded
    expect(await state(f, articleId)).toMatchObject({
      running: false,
      phase: "summaries",
      pausedReason: "unusable_key",
      failures: 1,
    });
    expect(mock.prompts).toEqual([]);
    expect((await indexRows(f, "summary")).every((r) => r.attempts === 0)).toBe(
      true,
    );

    // Saving a working key resumes it, paced, and the count stays
    await f.t.mutation(internal.providerCredentials.store, {
      userId: OWNER,
      provider: "openrouter",
      ciphertext: original?.ciphertext ?? "",
      iv: original?.iv ?? "",
      last4: OWNER_KEY.slice(-4),
    });
    await runScheduled(f.t, { stepMs: 15_000 });
    expect(await state(f, articleId)).toMatchObject({
      phase: "done",
      failures: 1,
    });
    expect((await state(f, articleId))?.pausedReason).toBeUndefined();
    expect(mock.summaryPrompts()).toHaveLength(3);
  });

  it("resumes a book that never started for want of a key when one is saved", async () => {
    const f = await secondReaderTest(modules);
    mockProviders();
    const articleId = await seedBook(f, OWNER, [{}, {}]);
    expect(await start(f, articleId)).toMatch(/^not started/);
    const key = await sealed(OWNER, OWNER_KEY);
    await f.t.mutation(internal.providerCredentials.store, {
      userId: OWNER,
      provider: "openrouter",
      ...key,
      last4: "0001",
    });
    expect(await scheduled(f, "bookIndex:start")).toHaveLength(1);
    await runScheduled(f.t, { stepMs: 15_000 });
    expect(await state(f, articleId)).toMatchObject({ phase: "done" });
  });

  it("does not resume a book whose key keeps failing past the pause cap", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, OWNER, "openrouter", OWNER_KEY);
    const articleId = await seedBook(f, OWNER, [{}]);
    await start(f, articleId);
    await f.t.run(async (ctx) => {
      const row = await ctx.db.query("bookIndexState").first();
      if (row)
        await ctx.db.patch("bookIndexState", row._id, {
          running: false,
          failures: 5,
        });
    });
    const key = await sealed(OWNER, OWNER_KEY);
    await f.t.mutation(internal.providerCredentials.store, {
      userId: OWNER,
      provider: "openrouter",
      ...key,
      last4: "0001",
    });
    expect(await scheduled(f, "bookIndex:start")).toHaveLength(0);
  });

  it("pauses on a refused key instead of marking the book done, and a good key brings the passages", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, OWNER, "openrouter", OWNER_KEY);
    const mock = mockProviders();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.embedStatus(401);
    const articleId = await seedBook(f, OWNER, [{}, {}, {}]);
    await start(f, articleId);
    await runScheduled(f.t, { stepMs: 15_000 });

    // Every embedding call was refused; nothing was spent or settled
    expect(await state(f, articleId)).toMatchObject({
      running: false,
      phase: "passages",
      pausedReason: "unusable_key",
    });
    expect(
      await f.t.run((ctx) => ctx.db.query("bookPassages").take(5)),
    ).toEqual([]);
    const rows = await indexRows(f, "passages");
    expect(rows.every((row) => row.attempts === 0 && !row.failures)).toBe(true);

    // A good key resumes it and the passages arrive
    mock.embedStatus(null);
    const key = await sealed(OWNER, OWNER_KEY);
    await f.t.mutation(internal.providerCredentials.store, {
      userId: OWNER,
      provider: "openrouter",
      ...key,
      last4: "0001",
    });
    await runScheduled(f.t, { stepMs: 15_000 });
    expect(await state(f, articleId)).toMatchObject({ phase: "done" });
    expect(
      (await f.t.run((ctx) => ctx.db.query("bookPassages").take(50))).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("recovers units that failed for other reasons, up to a lifetime cap", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(f.t, OWNER, "openrouter", OWNER_KEY);
    const mock = mockProviders();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.embedStatus(500);
    const articleId = await seedBook(f, OWNER, [{}, {}]);
    await start(f, articleId);
    await runScheduled(f.t, { stepMs: 15_000 });
    // The run ended with its units failed, and says they can be tried again
    expect(await state(f, articleId)).toMatchObject({
      phase: "done",
      recoverable: 2,
    });
    expect(
      (await indexRows(f, "passages")).map((r) => [r.status, r.failures]),
    ).toEqual([
      ["failed", MAX_ATTEMPTS],
      ["failed", MAX_ATTEMPTS],
    ]);

    // Backfill and start don't skip it as "already indexed"
    mock.embedStatus(null);
    expect(
      await f.t.mutation(internal.bookIndex.backfill, { userId: OWNER }),
    ).toBe("scheduled 1 of 1 books");
    await runScheduled(f.t, { stepMs: 15_000 });
    expect(await state(f, articleId)).toMatchObject({ phase: "done" });
    expect(
      (await f.t.run((ctx) => ctx.db.query("bookPassages").take(50))).length,
    ).toBeGreaterThanOrEqual(2);
    expect((await state(f, articleId))?.recoverable).toBe(0);
    expect(await start(f, articleId)).toBe("already indexed");

    // A unit that has failed too often is left alone
    const other = await seedBook(f, OWNER, [{}], "Other");
    await start(f, other);
    await f.t.run(async (ctx) => {
      const states = await ctx.db.query("bookIndexState").take(10);
      const row = states.find((r) => r.articleId === other);
      if (row)
        await ctx.db.patch("bookIndexState", row._id, {
          phase: "done",
          running: false,
        });
      await ctx.db.insert("bookIndexUnits", {
        userId: OWNER,
        articleId: other,
        stage: "passages",
        unitIndex: 0,
        status: "failed",
        claimedAt: 0,
        attempts: MAX_ATTEMPTS,
        failures: MAX_UNIT_FAILURES,
      });
    });
    expect(await start(f, other)).toBe("already indexed");
  });
});
