/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runScheduled,
  saveTestCredential,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { BATCH_DELAY_MS, PAGE } from "./catchUp";
import { CLAIM_TTL_MS, STALE_MS } from "./reannotateBackfill";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const vector = Array.from({ length: 1536 }, () => 0.5);
const SENTENCE = "Remote work makes teams faster, so the conclusion follows.";

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

function mockProviders({ failFor }: { failFor?: () => boolean } = {}) {
  const chatTimes: number[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      if (String(input).endsWith("/embeddings"))
        return Response.json({
          data: (request.input as string[]).map((_, index) => ({
            index,
            embedding: vector,
          })),
        });
      chatTimes.push(Date.now());
      if (failFor?.()) return new Response("nope", { status: 400 });
      return Response.json({
        id: "x",
        created: 1,
        model: request.model,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                thesis: "Point.",
                gist: "Gist.",
                tags: [],
                annotations: [
                  {
                    type: "assumption",
                    anchorText: SENTENCE,
                    content: "Assumes the cause.",
                    relevanceScore: 0.8,
                    reasoning: "r",
                  },
                ],
                reflection: {
                  strongestPoint: "s",
                  weakestAssumption: "w",
                  credibleCounterview: "c",
                  questionForYou: "q",
                },
              }),
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    },
  );
  return { chatTimes };
}

function addArticle(
  ctx: MutationCtx,
  userId: string,
  guid: string,
  fields: Record<string, unknown> = {},
) {
  return ctx.db.insert("articles", {
    userId,
    guid,
    url: `https://example.com/${userId}/${guid}`,
    title: `Article ${guid}`,
    content: `${SENTENCE} ${"More words to read. ".repeat(40)}`,
    wordCount: 800,
    estimatedReadMinutes: 5,
    embedding: vector,
    extractionStatus: "extracted",
    annotationStatus: "annotated",
    createdAt: Date.now(),
    ...fields,
  });
}

async function setup() {
  const f = await secondReaderTest(modules);
  await saveTestCredential(
    f.t,
    f.readerLibraryId,
    "openrouter",
    "sk-or-fixture-0009",
  );
  const userId = f.readerLibraryId;
  const start = () =>
    f.t.mutation(internal.reannotateBackfill.start, { userId });
  const versions = () =>
    f.t.run(async (ctx) =>
      Object.fromEntries(
        (await ctx.db.query("articles").collect()).map((a) => [
          a.guid,
          a.annotationVersion,
        ]),
      ),
    );
  return { ...f, userId, start, versions };
}

describe("reannotateBackfill", () => {
  it("re-annotates unread articles of 20 minutes or less, and nothing else", async () => {
    const f = await setup();
    const mock = mockProviders();
    await f.t.run(async (ctx) => {
      const u = f.userId;
      await addArticle(ctx, u, "short");
      await addArticle(ctx, u, "no-minutes", {
        estimatedReadMinutes: undefined,
        wordCount: 3_000,
      });
      await addArticle(ctx, u, "twenty", { estimatedReadMinutes: 20 });
      // Left alone
      await addArticle(ctx, u, "long", { estimatedReadMinutes: 21 });
      await addArticle(ctx, u, "very-long-no-minutes", {
        estimatedReadMinutes: undefined,
        wordCount: 8_000,
      });
      await addArticle(ctx, u, "finished", { finishedAt: 5 });
      await addArticle(ctx, u, "current", { annotationVersion: 2 });
      await addArticle(ctx, u, "skipped", { annotationStatus: "skipped" });
      await addArticle(ctx, u, "failed", { annotationStatus: "failed" });
      await addArticle(ctx, u, "unknown-length", {
        estimatedReadMinutes: undefined,
        wordCount: undefined,
      });
      const withNote = await addArticle(ctx, u, "reflected");
      await ctx.db.insert("userNotes", {
        userId: u,
        articleId: withNote,
        annotationId: await ctx.db.insert("annotations", {
          articleId: withNote,
          userId: u,
          type: "question",
          anchorText: "a",
          anchorStartOffset: 0,
          anchorEndOffset: 1,
          content: "old",
          relevanceScore: 0.7,
          wasViewed: false,
          wasDismissed: false,
          createdAt: 1,
        }),
        selectedText: "a",
        embedding: vector,
        content: "<p>x</p>",
        contentPlain: "x",
        createdAt: 1,
        updatedAt: 1,
      });
      // Another library's article is never touched
      await addArticle(ctx, OWNER, "someone-elses");
    });
    expect(await f.start()).toBe("started");
    await runScheduled(f.t);

    expect(mock.chatTimes).toHaveLength(3);
    expect(await f.versions()).toEqual({
      short: 2,
      "no-minutes": 2,
      twenty: 2,
      long: undefined,
      "very-long-no-minutes": undefined,
      finished: undefined,
      current: 2,
      skipped: undefined,
      failed: undefined,
      "unknown-length": undefined,
      reflected: undefined,
      "someone-elses": undefined,
    });
    // The new margin replaced the old one, and the reflected article kept its own
    const reflected = await f.t.run((ctx) =>
      ctx.db
        .query("annotations")
        .filter((q) => q.eq(q.field("content"), "old"))
        .collect(),
    );
    expect(reflected).toHaveLength(1);
    expect(
      await f.t.run((ctx) => ctx.db.query("reannotateState").collect()),
    ).toMatchObject([
      { running: false, queued: 3, finishedAt: expect.any(Number) },
    ]);
  });

  it("is idempotent: a second run makes no model calls", async () => {
    const f = await setup();
    const mock = mockProviders();
    await f.t.run(async (ctx) => {
      await addArticle(ctx, f.userId, "a");
      await addArticle(ctx, f.userId, "b");
    });
    await f.start();
    await runScheduled(f.t);
    expect(mock.chatTimes).toHaveLength(2);
    expect(await f.start()).toBe("started");
    await runScheduled(f.t);
    expect(mock.chatTimes).toHaveLength(2);
    // Margins were replaced, not doubled
    expect(
      await f.t.run((ctx) => ctx.db.query("annotations").collect()),
    ).toHaveLength(2);
  });

  it("paces itself: a batch of PAGE, then a wait", async () => {
    const f = await setup();
    const mock = mockProviders();
    await f.t.run(async (ctx) => {
      for (let i = 0; i < PAGE + 2; i++)
        await addArticle(ctx, f.userId, `a${i}`);
    });
    await f.start();
    await runScheduled(f.t);
    expect(mock.chatTimes).toHaveLength(PAGE + 2);
    const sorted = [...mock.chatTimes].sort((a, b) => a - b);
    expect(sorted[PAGE] - sorted[PAGE - 1]).toBeGreaterThanOrEqual(
      BATCH_DELAY_MS - 3_000 * PAGE,
    );
    expect(sorted[PAGE] - sorted[0]).toBeGreaterThanOrEqual(BATCH_DELAY_MS);
  });

  it("retries a failed article on the next run and leaves its old margin meanwhile", async () => {
    const f = await setup();
    let failing = true;
    const mock = mockProviders({ failFor: () => failing });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await f.t.run(async (ctx) => {
      const article = await addArticle(ctx, f.userId, "flaky");
      await ctx.db.insert("annotations", {
        articleId: article,
        userId: f.userId,
        type: "context",
        anchorText: "a",
        anchorStartOffset: 0,
        anchorEndOffset: 1,
        content: "old note",
        relevanceScore: 0.7,
        wasViewed: false,
        wasDismissed: false,
        createdAt: 1,
      });
      return article;
    });
    await f.start();
    await runScheduled(f.t);
    const afterFailure = await f.t.run((ctx) => ctx.db.get(id));
    expect(afterFailure?.annotationStatus).toBe("annotated");
    expect(afterFailure?.annotationVersion).toBeUndefined();
    expect(
      (await f.t.run((ctx) => ctx.db.query("annotations").collect()))[0]
        .content,
    ).toBe("old note");
    failing = false;
    await f.start();
    await runScheduled(f.t);
    expect((await f.versions()).flaky).toBe(2);
    expect(mock.chatTimes.length).toBeGreaterThanOrEqual(2);
  });

  it("leaves a live run alone and resumes one that lost its schedule", async () => {
    const f = await setup();
    mockProviders();
    await f.t.run((ctx) => addArticle(ctx, f.userId, "a"));
    await f.start();
    expect(await f.start()).toBe("already running");
    await runScheduled(f.t);

    // A run left "running" with no step scheduled
    await f.t.run(async (ctx) => {
      const row = await ctx.db.query("reannotateState").first();
      await ctx.db.patch("reannotateState", row!._id, {
        running: true,
        updatedAt: Date.now() - STALE_MS - 1,
      });
      await addArticle(ctx, f.userId, "b");
    });
    expect(await f.start()).toBe("resumed");
    await runScheduled(f.t);
    expect((await f.versions()).b).toBe(2);
  });

  it("does not start without both a text and an embedding key", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    await saveTestCredential(
      t,
      readerLibraryId,
      "anthropic",
      "sk-ant-fixture-0010",
    );
    await t.run((ctx) => addArticle(ctx, readerLibraryId, "a"));
    const mock = mockProviders();
    expect(
      await t.mutation(internal.reannotateBackfill.start, {
        userId: readerLibraryId,
      }),
    ).toMatch(/not started/);
    await runScheduled(t);
    expect(mock.chatTimes).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query("reannotateState").collect()),
    ).toEqual([]);
  });

  it("reports its progress", async () => {
    const f = await setup();
    mockProviders();
    expect(
      await f.t.query(internal.reannotateBackfill.status, { userId: f.userId }),
    ).toBeNull();
    await f.t.run((ctx) => addArticle(ctx, f.userId, "a"));
    await f.start();
    await runScheduled(f.t);
    expect(
      await f.t.query(internal.reannotateBackfill.status, { userId: f.userId }),
    ).toMatchObject({ running: false, queued: 1 });
  });

  describe("claims", () => {
    const generateJobs = (t: Awaited<ReturnType<typeof setup>>["t"]) =>
      t.run(async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).filter(
          (job) => job.name.includes("generateForArticle"),
        ),
      );

    it("does not schedule an article again on a restart while its call is in flight", async () => {
      const f = await setup();
      mockProviders();
      const id = await f.t.run((ctx) => addArticle(ctx, f.userId, "slow"));
      await f.start();
      // The first batch queues the article and claims it; the call never completes here
      await f.t.mutation(internal.reannotateBackfill.step, {
        userId: f.userId,
        runId: 1,
      });
      expect(await generateJobs(f.t)).toHaveLength(1);
      expect(
        (await f.t.run((ctx) => ctx.db.get(id)))?.reannotateClaimedAt,
      ).toBeDefined();

      // The run is marked finished, then restarted from the beginning
      await f.t.run(async (ctx) => {
        const row = await ctx.db.query("reannotateState").first();
        await ctx.db.patch("reannotateState", row!._id, { running: false });
      });
      expect(await f.start()).toBe("started");
      await f.t.mutation(internal.reannotateBackfill.step, {
        userId: f.userId,
        runId: 2,
      });
      expect(await generateJobs(f.t)).toHaveLength(1);
    });

    it("schedules it again once the claim has expired", async () => {
      const f = await setup();
      mockProviders();
      const id = await f.t.run((ctx) => addArticle(ctx, f.userId, "lost"));
      await f.start();
      await f.t.mutation(internal.reannotateBackfill.step, {
        userId: f.userId,
        runId: 1,
      });
      await f.t.run(async (ctx) => {
        await ctx.db.patch("articles", id, {
          reannotateClaimedAt: Date.now() - CLAIM_TTL_MS - 1,
        });
        const row = await ctx.db.query("reannotateState").first();
        await ctx.db.patch("reannotateState", row!._id, { running: false });
      });
      await f.start();
      await f.t.mutation(internal.reannotateBackfill.step, {
        userId: f.userId,
        runId: 2,
      });
      expect(await generateJobs(f.t)).toHaveLength(2);
    });

    it("clears the claim on success and on failure, so a failed article is retried", async () => {
      const f = await setup();
      let failing = true;
      mockProviders({ failFor: () => failing });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const id = await f.t.run((ctx) => addArticle(ctx, f.userId, "claimed"));
      await f.start();
      await runScheduled(f.t);
      let article = await f.t.run((ctx) => ctx.db.get(id));
      expect(article?.reannotateClaimedAt).toBeUndefined();
      expect(article?.annotationVersion).toBeUndefined();
      failing = false;
      await f.start();
      await runScheduled(f.t);
      article = await f.t.run((ctx) => ctx.db.get(id));
      expect(article?.reannotateClaimedAt).toBeUndefined();
      expect(article?.annotationVersion).toBe(2);
    });
  });
});
