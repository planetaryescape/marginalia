/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runScheduled,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { BATCH_DELAY_MS, PAGE } from "./catchUp";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const READER_OPENROUTER = "sk-or-reader-openrouter-fixture-0003";
const READER_ANTHROPIC = "sk-ant-reader-anthropic-fixture-0004";
const vector = Array.from({ length: 1536 }, () => 0.5);

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

/** Answers key checks, embeddings and annotation requests; records each call. */
function mockProviders() {
  const calls: { url: string; auth: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        auth: new Headers(init?.headers).get("Authorization"),
      });
      const request = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.endsWith("/embeddings"))
        return Response.json({
          data: (request.input as string[]).map((_, index) => ({
            index,
            embedding: vector,
          })),
        });
      if (url.endsWith("/chat/completions"))
        return Response.json({
          id: "fixture",
          created: 1,
          model: request.model,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  annotations: [],
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
      // Key validation
      return Response.json({ data: [] });
    },
  );
  return {
    calls,
    chats: () => calls.filter((c) => c.url.endsWith("/chat/completions")),
    embeds: () => calls.filter((c) => c.url.endsWith("/embeddings")),
  };
}

type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;

async function addArticle(
  ctx: MutationCtx,
  userId: string,
  guid: string,
  fields: {
    annotationStatus?: "skipped" | "annotated";
    skipReason?: "no_provider";
    embedded?: boolean;
  } = {},
) {
  return ctx.db.insert("articles", {
    userId,
    guid,
    url: `https://example.com/${userId}/${guid}`,
    title: `Article ${guid}`,
    content: `Article ${guid}. ${"Words worth reading slowly. ".repeat(40)}`,
    wordCount: 160,
    extractionStatus: "extracted",
    annotationStatus: fields.annotationStatus ?? "skipped",
    skipReason: fields.skipReason,
    embedding: fields.embedded ? vector : undefined,
    createdAt: Date.now(),
  });
}

/** One unembedded note, highlight, thread and impression on an article. */
async function addActivity(
  ctx: MutationCtx,
  userId: string,
  articleId: Id<"articles">,
) {
  const now = Date.now();
  await ctx.db.insert("userNotes", {
    userId,
    articleId,
    selectedText: "Words",
    content: "<p>My thought</p>",
    contentPlain: "My thought",
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("highlights", {
    userId,
    articleId,
    kind: "highlight",
    text: "Words worth reading",
    createdAt: now,
  });
  await ctx.db.insert("companionThreads", {
    userId,
    articleId,
    mode: "ask",
    selection: "Words",
    question: "Why?",
    turns: [{ role: "assistant", content: "Because." }],
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("impressions", {
    userId,
    articleId,
    rating: 4,
    tags: ["slow"],
    createdAt: now,
    updatedAt: now,
  });
}

async function unembedded(t: Fixture["t"], userId: string) {
  return t.run(async (ctx) => {
    const count = async (
      table:
        | "articles"
        | "userNotes"
        | "highlights"
        | "companionThreads"
        | "impressions",
    ) =>
      (await ctx.db.query(table).take(200)).filter(
        (row) => row.userId === userId && !row.embedding,
      ).length;
    return {
      articles: await count("articles"),
      notes: await count("userNotes"),
      highlights: await count("highlights"),
      threads: await count("companionThreads"),
      impressions: await count("impressions"),
    };
  });
}

function scheduled(t: Fixture["t"]) {
  return t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(500));
}

describe("catching up after a key is saved", () => {
  it("embeds the reader's activity, then annotates their no-key articles, and nobody else's", async () => {
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    const ids = await t.run(async (ctx) => {
      const waiting = await addArticle(ctx, readerLibraryId, "waiting", {
        skipReason: "no_provider",
      });
      // Skipped before reasons were recorded: left for Re-annotate
      const older = await addArticle(ctx, readerLibraryId, "older", {
        embedded: true,
      });
      const done = await addArticle(ctx, readerLibraryId, "done", {
        annotationStatus: "annotated",
      });
      await addActivity(ctx, readerLibraryId, done);
      // convex-test's vector search fails on rows without a vector, which
      // real indexes skip, so the owner's unembedded activity is covered by
      // the next test, where no marginalia are written
      const ownerArticle = await addArticle(ctx, OWNER, "owner", {
        skipReason: "no_provider",
      });
      return { waiting, older, ownerArticle };
    });
    const mock = mockProviders();

    await reader.action(api.providerCredentials.save, {
      provider: "openrouter",
      apiKey: READER_OPENROUTER,
    });
    await runScheduled(t);

    const status = await t.run(async (ctx) => ({
      waiting: await ctx.db.get(ids.waiting),
      older: await ctx.db.get(ids.older),
      owner: await ctx.db.get(ids.ownerArticle),
    }));
    expect(status.waiting).toMatchObject({ annotationStatus: "annotated" });
    expect(status.waiting?.skipReason).toBeUndefined();
    expect(status.older).toMatchObject({ annotationStatus: "skipped" });
    expect(status.owner).toMatchObject({
      annotationStatus: "skipped",
      skipReason: "no_provider",
    });
    expect(mock.chats()).toHaveLength(1);
    expect(await unembedded(t, readerLibraryId)).toEqual({
      articles: 0,
      notes: 0,
      highlights: 0,
      threads: 0,
      impressions: 0,
    });
    // The owner's library is untouched, and only the reader's key was used
    expect((await unembedded(t, OWNER)).articles).toBe(1);
    const keys = new Set(mock.calls.filter((c) => c.auth).map((c) => c.auth));
    expect(keys).toEqual(new Set([`Bearer ${READER_OPENROUTER}`]));
    expect(await reader.query(api.catchUp.status, {})).toBeNull();
  });

  it("embeds once an embedding-capable key joins a text-only one", async () => {
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      for (const userId of [readerLibraryId, OWNER]) {
        const articleId = await addArticle(ctx, userId, "a", {
          annotationStatus: "annotated",
        });
        await addActivity(ctx, userId, articleId);
      }
    });
    const mock = mockProviders();
    await reader.action(api.providerCredentials.save, {
      provider: "anthropic",
      apiKey: READER_ANTHROPIC,
    });
    await runScheduled(t);
    expect(mock.embeds()).toHaveLength(0);
    expect((await unembedded(t, readerLibraryId)).notes).toBe(1);

    await reader.action(api.providerCredentials.save, {
      provider: "openrouter",
      apiKey: READER_OPENROUTER,
    });
    await runScheduled(t);
    expect(await unembedded(t, readerLibraryId)).toEqual({
      articles: 0,
      notes: 0,
      highlights: 0,
      threads: 0,
      impressions: 0,
    });
    expect(mock.embeds()).toHaveLength(5);
    expect(await unembedded(t, OWNER)).toEqual({
      articles: 1,
      notes: 1,
      highlights: 1,
      threads: 1,
      impressions: 1,
    });
  });

  it("runs once when the key is saved twice", async () => {
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      for (const guid of ["one", "two", "three"])
        await addArticle(ctx, readerLibraryId, guid, {
          skipReason: "no_provider",
          embedded: true,
        });
    });
    const mock = mockProviders();
    for (let i = 0; i < 2; i++)
      await reader.action(api.providerCredentials.save, {
        provider: "openrouter",
        apiKey: READER_OPENROUTER,
      });
    const steps = (await scheduled(t)).filter((job) =>
      job.name.startsWith("catchUp"),
    );
    expect(steps).toHaveLength(1);
    await runScheduled(t);
    expect(mock.chats()).toHaveLength(3);
    const annotations = (await scheduled(t)).filter((job) =>
      job.name.includes("generateForArticle"),
    );
    expect(annotations).toHaveLength(3);
  });

  it("skips disabled readers and stops when a reader is disabled mid-run", async () => {
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    const articleId = await t.run((ctx) =>
      addArticle(ctx, readerLibraryId, "a", { skipReason: "no_provider" }),
    );
    mockProviders();
    await reader.action(api.providerCredentials.save, {
      provider: "openrouter",
      apiKey: READER_OPENROUTER,
    });
    // Disabled before the first batch runs
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", readerLibraryId))
        .unique();
      await ctx.db.patch(row!._id, { status: "disabled" });
    });
    await runScheduled(t);
    expect(await t.run((ctx) => ctx.db.get(articleId))).toMatchObject({
      annotationStatus: "skipped",
      skipReason: "no_provider",
    });
    const state = await t.run((ctx) => ctx.db.query("catchUpState").first());
    expect(state).toMatchObject({ running: false, articlesQueued: 0 });

    // And a disabled reader's catch-up never starts
    await t.mutation(internal.catchUp.start, { userId: readerLibraryId });
    expect(
      (await scheduled(t)).filter(
        (job) => job.name.startsWith("catchUp") && job.state.kind === "pending",
      ),
    ).toEqual([]);
  });

  it("queues one page per batch and schedules the next instead of running it", async () => {
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < PAGE + 2; i++)
        await addArticle(ctx, readerLibraryId, `a${i}`, {
          skipReason: "no_provider",
          embedded: true,
        });
    });
    mockProviders();
    await reader.action(api.providerCredentials.save, {
      provider: "openrouter",
      apiKey: READER_OPENROUTER,
    });
    // Run only the first step
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();

    const jobs = await scheduled(t);
    const steps = jobs.filter((job) => job.name.startsWith("catchUp"));
    expect(steps.map((job) => job.state.kind)).toEqual(["success", "pending"]);
    expect(
      steps[1].scheduledTime - steps[0].scheduledTime,
    ).toBeGreaterThanOrEqual(BATCH_DELAY_MS);
    expect(
      jobs.filter((job) => job.name.includes("generateForArticle")),
    ).toHaveLength(PAGE);
    const statuses = await t.run(async (ctx) =>
      (await ctx.db.query("articles").take(50)).map(
        (row) => row.annotationStatus,
      ),
    );
    expect(statuses.filter((s) => s === "pending")).toHaveLength(PAGE);
    expect(statuses.filter((s) => s === "skipped")).toHaveLength(2);
    expect(await reader.query(api.catchUp.status, {})).toEqual({
      articlesQueued: PAGE,
      itemsQueued: 0,
    });
  });

  it("waits for the reader's hourly catch-up budget", async () => {
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      await addArticle(ctx, readerLibraryId, "a", {
        skipReason: "no_provider",
        embedded: true,
      });
      await ctx.db.insert("readerLimits", {
        userId: readerLibraryId,
        bucket: "catchUp",
        startedAt: Date.now(),
        count: 30,
      });
    });
    mockProviders();
    await reader.action(api.providerCredentials.save, {
      provider: "openrouter",
      apiKey: READER_OPENROUTER,
    });
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
    const jobs = await scheduled(t);
    expect(
      jobs.filter((job) => job.name.includes("generateForArticle")),
    ).toEqual([]);
    const next = jobs.filter(
      (job) => job.name.startsWith("catchUp") && job.state.kind === "pending",
    );
    expect(next).toHaveLength(1);
    expect(next[0].scheduledTime - Date.now()).toBeGreaterThan(5 * 60_000);
  });

  it("lists only the given library's unembedded highlights and threads", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      for (const userId of [readerLibraryId, OWNER])
        await addActivity(ctx, userId, await addArticle(ctx, userId, "a"));
    });
    for (const ref of [
      internal.highlights.listUnembedded,
      internal.companionThreads.listUnembedded,
    ]) {
      const ids: string[] = await t.query(ref, { userId: readerLibraryId });
      expect(ids).toHaveLength(1);
      const row = await t.run((ctx) => ctx.db.get(ids[0] as Id<"highlights">));
      expect(row?.userId).toBe(readerLibraryId);
    }
  });
});
