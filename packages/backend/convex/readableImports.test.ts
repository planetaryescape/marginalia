// @vitest-environment node
/// <reference types="vite/client" />

import { extract } from "@extractus/article-extractor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { embedTexts } from "./lib/embeddings";
import { prepareImportContent } from "./lib/importContent";
import {
  EXTRACTION_LEASE_MS,
  EXTRACTION_TIMEOUT_MS,
  INDEX_LEASE_MS,
} from "./lib/importJobs";
import { loadReaderAI } from "./lib/router";

vi.mock("@extractus/article-extractor", () => ({ extract: vi.fn() }));
vi.mock("./lib/router", () => ({ loadReaderAI: vi.fn() }));
vi.mock("./lib/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/embeddings")>()),
  embedTexts: vi.fn(),
}));

const modules = import.meta.glob("./**/*.ts");
const vector = Array.from({ length: 1536 }, () => 0.25);
const input = {
  userId: "default_user",
  guid: "manual:one",
  url: "https://example.com/essay",
  title: "Readable now",
  content: "A complete readable article.",
  contentHtml: "<p>A complete readable article.</p>",
  excerpt: "A complete readable article.",
  wordCount: 4,
  estimatedReadMinutes: 1,
};
type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(extract).mockReset();
  vi.mocked(embedTexts).mockReset().mockResolvedValue([vector]);
  vi.mocked(loadReaderAI)
    .mockReset()
    .mockResolvedValue({
      providers: ["openai"],
      chain: () => [],
      noteFailure: async () => {},
      embedder: () => ({ provider: "openai", apiKey: "fixture-only" }),
    });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function row(f: Fixture, articleId: Id<"articles">) {
  return f.t.run((ctx) => ctx.db.get("articles", articleId));
}

async function placeholder(f: Fixture, suffix = "") {
  const feedId = await f.t.run((ctx) =>
    ctx.db.insert("feeds", {
      userId: "default_user",
      title: "Source",
      url: "https://example.com/feed",
      isActive: true,
      articleCount: 0,
      createdAt: Date.now(),
    }),
  );
  const args = {
    userId: "default_user",
    feedId,
    guid: `tag:source:one${suffix}`,
    url: `${input.url}${suffix}`,
    title: "RSS title",
    extractionStatus: "pending" as const,
    annotationStatus: "pending" as const,
    createdAt: Date.now(),
  };
  const articleId = await f.t.mutation(internal.articles.insert, args);
  return { articleId, feedId, args };
}

function fence(
  articleId: Id<"articles">,
  claim: {
    userId: string;
    revision: number;
    run: number;
    hash: string;
    model: string;
  },
) {
  return {
    articleId,
    userId: claim.userId,
    revision: claim.revision,
    run: claim.run,
    hash: claim.hash,
    model: claim.model,
  };
}

/** Consume scheduler turns, not lease time; annotations are not due in this window. */
async function importTurns(t: Fixture["t"], turns = 20) {
  for (let i = 0; i < turns; i++) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

describe("readable publication and durable optional indexing", () => {
  it("an expired index claim remains eligible when its recovery finds two newer workers", async () => {
    const f = await secondReaderTest(modules);
    const ids = await Promise.all(
      [0, 1, 2].map((i) =>
        f.t.mutation(internal.articles.insertExtracted, {
          ...input,
          guid: `expiry-${i}`,
          url: `${input.url}/expiry-${i}`,
        }),
      ),
    );
    const old = await f.t.mutation(internal.libraryIndex.claim, {
      articleId: ids[0],
    });
    if (!old) throw new Error("No old claim");
    vi.setSystemTime(Date.now() + INDEX_LEASE_MS + 1);
    const next = await f.t.mutation(internal.libraryIndex.claim, {
      articleId: ids[1],
    });
    await f.t.mutation(internal.libraryIndex.claim, { articleId: ids[2] });
    if (!next) throw new Error("No newer claim");
    await f.t.mutation(internal.libraryIndex.start, {
      articleId: ids[0],
      userId: input.userId,
    });
    expect(await row(f, ids[0])).toMatchObject({
      libraryIndex: { status: "pending", attempts: 1 },
    });
    const before = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(100),
    );
    await f.t.mutation(internal.libraryIndex.complete, {
      ...fence(ids[1], next),
      embedding: vector,
    });
    const after = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(100),
    );
    expect(
      after
        .filter((job) => !before.some((old) => old._id === job._id))
        .map((job) => job.args[0]),
    ).toEqual([{ articleId: ids[0], userId: input.userId }]);
    expect(
      await f.t.mutation(internal.libraryIndex.claim, { articleId: ids[0] }),
    ).toMatchObject({ attempts: 2, run: old.run + 1 });
  });
  it("indexes all five fast imports through release wakes, before any lease recovery runs", async () => {
    const f = await secondReaderTest(modules);
    const ids = await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        f.t.mutation(internal.articles.insertExtracted, {
          ...input,
          guid: `fast-${i}`,
          url: `${input.url}/fast-${i}`,
          content: `Readable ${i}`,
          estimatedReadMinutes: 30,
        }),
      ),
    );
    const began = Date.now();
    let active = 0;
    let maximum = 0;
    let thirdSawRelease = false;
    const texts: string[] = [];
    vi.mocked(embedTexts).mockImplementation(async (_target, text) => {
      active++;
      maximum = Math.max(maximum, active);
      texts.push(text[0]);
      if (texts.length === 3)
        thirdSawRelease = (
          await Promise.all(ids.slice(0, 2).map((id) => row(f, id)))
        ).some((article) => article?.libraryIndex?.status === "ready");
      await Promise.resolve();
      active--;
      return [vector];
    });
    await importTurns(f.t);
    expect(thirdSawRelease).toBe(true);
    expect(maximum).toBeLessThanOrEqual(2);
    expect(new Set(texts).size).toBe(5);
    expect(texts).toHaveLength(5);
    expect(
      (await Promise.all(ids.map((id) => row(f, id)))).every(
        (article) => article?.libraryIndex?.status === "ready",
      ),
    ).toBe(true);
    expect(Date.now() - began).toBe(20);
    const recovery = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(200),
    );
    const leaseJobs = recovery.filter(
      (job) =>
        job.name.includes("libraryIndex:start") &&
        job.scheduledTime >= began + INDEX_LEASE_MS,
    );
    expect(leaseJobs).toHaveLength(5);
    expect(leaseJobs.every((job) => job.state.kind === "pending")).toBe(true);
  });

  it("a retry releases its slot immediately, honors retryAt, and never exceeds two concurrent calls", async () => {
    const f = await secondReaderTest(modules);
    const ids = await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        f.t.mutation(internal.articles.insertExtracted, {
          ...input,
          guid: `retry-${i}`,
          url: `${input.url}/retry-${i}`,
          content: `Retry readable ${i}`,
          estimatedReadMinutes: 30,
        }),
      ),
    );
    const began = Date.now();
    let active = 0;
    let maximum = 0;
    const calls = new Map<string, number>();
    vi.mocked(embedTexts).mockImplementation(async (_target, texts) => {
      active++;
      maximum = Math.max(maximum, active);
      const count = (calls.get(texts[0]) ?? 0) + 1;
      calls.set(texts[0], count);
      await Promise.resolve();
      active--;
      if (texts[0] === "Retry readable 0" && count === 1)
        throw new Error("Provider returned 503: fixture");
      return [vector];
    });
    await importTurns(f.t);
    expect(
      (await Promise.all(ids.slice(1).map((id) => row(f, id)))).every(
        (article) => article?.embedding,
      ),
    ).toBe(true);
    const retry = await row(f, ids[0]);
    expect(retry?.libraryIndex).toMatchObject({
      status: "pending",
      attempts: 1,
    });
    expect(retry?.libraryIndex?.retryAt).toBeGreaterThan(Date.now());
    const scheduledBefore = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(200),
    );
    for (let i = 0; i < 3; i++)
      await f.t.mutation(internal.libraryIndex.start, {
        articleId: ids[0],
        userId: input.userId,
      });
    expect(
      await f.t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").take(200),
      ),
    ).toHaveLength(scheduledBefore.length);
    expect(calls.get("Retry readable 0")).toBe(1);
    vi.advanceTimersByTime(5_000);
    await f.t.finishInProgressScheduledFunctions();
    await importTurns(f.t);
    expect(calls.get("Retry readable 0")).toBe(2);
    expect([...calls.values()].sort()).toEqual([1, 1, 1, 1, 2]);
    expect(maximum).toBeLessThanOrEqual(2);
    expect(
      (await Promise.all(ids.map((id) => row(f, id)))).every(
        (article) => article?.embedding,
      ),
    ).toBe(true);
    expect(Date.now() - began).toBeLessThan(INDEX_LEASE_MS);
  });

  it("a full pool creates no repeated immediate dispatch, and release does not wake a leaving library", async () => {
    const f = await secondReaderTest(modules);
    const ids = await Promise.all(
      [0, 1, 2].map((i) =>
        f.t.mutation(internal.articles.insertExtracted, {
          ...input,
          userId: f.readerLibraryId,
          guid: `leaving-${i}`,
          url: `${input.url}/leaving-${i}`,
        }),
      ),
    );
    const first = await f.t.mutation(internal.libraryIndex.claim, {
      articleId: ids[0],
    });
    await f.t.mutation(internal.libraryIndex.claim, { articleId: ids[1] });
    if (!first) throw new Error("No claim");
    const before = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(100),
    );
    for (let i = 0; i < 3; i++)
      await f.t.mutation(internal.libraryIndex.start, {
        articleId: ids[2],
        userId: f.readerLibraryId,
      });
    expect(
      await f.t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").take(100),
      ),
    ).toHaveLength(before.length);
    await f.t.run(async (ctx) => {
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.readerLibraryId))
        .unique();
      if (!reader) throw new Error("No reader");
      await ctx.db.patch(reader._id, { deletingAt: Date.now() });
    });
    expect(
      await f.t.mutation(internal.libraryIndex.complete, {
        ...fence(ids[0], first),
        embedding: vector,
      }),
    ).toBe(false);
    expect(
      await f.t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").take(100),
      ),
    ).toHaveLength(before.length);
    expect((await row(f, ids[2]))?.libraryIndex?.attempts).toBe(0);
  });
  it("atomically claims and dispatches scheduled indexing, and recovers an action lost after dispatch", async () => {
    const f = await secondReaderTest(modules);
    const articleId = await f.t.mutation(
      internal.articles.insertExtracted,
      input,
    );
    await expect(
      f.t.run(async (ctx) => {
        await ctx.runMutation(internal.libraryIndex.start, { articleId });
        throw new Error("dispatcher transaction failed");
      }),
    ).rejects.toThrow("dispatcher transaction failed");
    expect(await row(f, articleId)).toMatchObject({
      libraryIndex: { status: "pending", attempts: 0 },
    });
    await f.t.mutation(internal.libraryIndex.start, { articleId });
    const old = (await row(f, articleId))?.libraryIndex;
    if (!old) throw new Error("No dispatched claim");
    expect(old.status).toBe("running");
    expect(embedTexts).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + INDEX_LEASE_MS + 1);
    await f.t.mutation(internal.libraryIndex.start, { articleId });
    const next = (await row(f, articleId))?.libraryIndex;
    if (!next) throw new Error("No recovered claim");
    await f.t.action(internal.actions.indexLibraryArticle.runClaimed, {
      ...fence(articleId, { ...old, userId: input.userId }),
      text: input.content,
    });
    expect(embedTexts).not.toHaveBeenCalled();
    await f.t.action(internal.actions.indexLibraryArticle.runClaimed, {
      ...fence(articleId, { ...next, userId: input.userId }),
      text: input.content,
    });
    expect(await row(f, articleId)).toMatchObject({
      embedding: vector,
      libraryIndex: { attempts: 2, status: "ready" },
    });
  });
  it("opens a pasted URL without waiting for indexing and recognizes a later URL variant", async () => {
    const f = await secondReaderTest(modules);
    vi.mocked(extract).mockResolvedValue({
      title: input.title,
      content: input.contentHtml,
    });
    vi.mocked(embedTexts).mockImplementation(() => new Promise(() => {}));
    const first = await f.owner.action(api.actions.addArticleByUrl.add, {
      url: input.url,
    });
    expect(first.alreadyExists).toBe(false);
    expect(await row(f, first.articleId)).toMatchObject({
      content: input.content,
      extractionStatus: "extracted",
    });
    expect(
      await f.owner.action(api.actions.addArticleByUrl.add, {
        url: `${input.url}/#comments`,
      }),
    ).toEqual({ articleId: first.articleId, alreadyExists: true });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(embedTexts).not.toHaveBeenCalled();
  });
  it("caps paid indexing concurrency per library and wakes waiting articles without consuming a retry", async () => {
    const f = await secondReaderTest(modules);
    const ids = await Promise.all(
      ["a", "b", "c"].map((suffix) =>
        f.t.mutation(internal.articles.insertExtracted, {
          ...input,
          guid: suffix,
          url: `${input.url}/${suffix}`,
        }),
      ),
    );
    const started = deferred<void>();
    const provider = deferred<number[][]>();
    let calls = 0;
    vi.mocked(embedTexts).mockImplementation(() => {
      calls++;
      if (calls === 2) started.resolve();
      return provider.promise;
    });
    const actions = ids
      .slice(0, 2)
      .map((articleId) =>
        f.t.action(internal.actions.indexLibraryArticle.run, { articleId }),
      );
    await started.promise;
    await f.t.action(internal.actions.indexLibraryArticle.run, {
      articleId: ids[2],
    });
    expect(embedTexts).toHaveBeenCalledTimes(2);
    expect(await row(f, ids[2])).toMatchObject({
      libraryIndex: { status: "pending", attempts: 0 },
    });
    provider.resolve([vector]);
    await Promise.all(actions);
    await f.t.action(internal.actions.indexLibraryArticle.run, {
      articleId: ids[2],
    });
    expect(embedTexts).toHaveBeenCalledTimes(3);
    expect(await row(f, ids[2])).toMatchObject({ embedding: vector });
  });
  it("returns an API article without even starting a blocked embedding provider", async () => {
    const f = await secondReaderTest(modules);
    vi.mocked(embedTexts).mockImplementation(() => new Promise(() => {}));
    const result = await f.t.action(internal.actions.ingestExternal.ingest, {
      userId: input.userId,
      externalId: "api:one",
      url: input.url,
      title: input.title,
      html: input.contentHtml,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture publication failed");
    expect(await row(f, result.articleId)).toMatchObject({
      content: input.content,
      extractionStatus: "extracted",
      libraryIndex: { status: "pending" },
    });
    expect(embedTexts).not.toHaveBeenCalled();
    const scheduled = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      scheduled.filter((job) => job.name.includes("libraryIndex:start")),
    ).toHaveLength(1);
  });

  it("keeps text readable while indexing is blocked, then adds one vector to the same article", async () => {
    const f = await secondReaderTest(modules);
    const articleId = await f.t.mutation(
      internal.articles.insertExtracted,
      input,
    );
    const started = deferred<void>();
    const provider = deferred<number[][]>();
    vi.mocked(embedTexts).mockImplementation(() => {
      started.resolve();
      return provider.promise;
    });
    const indexing = f.t.action(internal.actions.indexLibraryArticle.run, {
      articleId,
    });
    await started.promise;
    expect(await row(f, articleId)).toMatchObject({
      content: input.content,
      libraryIndex: { status: "running" },
    });
    await f.t.action(internal.actions.indexLibraryArticle.run, { articleId });
    expect(embedTexts).toHaveBeenCalledTimes(1);
    provider.resolve([vector]);
    await indexing;
    expect(await row(f, articleId)).toMatchObject({
      embedding: vector,
      libraryIndex: { status: "ready", attempts: 1 },
    });
    expect(
      await f.t.run((ctx) => ctx.db.query("articles").collect()),
    ).toHaveLength(1);
  });

  it("rolls back the row and job together if publication fails", async () => {
    const f = await secondReaderTest(modules);
    await expect(
      f.t.run(async (ctx) => {
        await ctx.runMutation(internal.articles.insertExtracted, input);
        throw new Error("rollback publication");
      }),
    ).rejects.toThrow("rollback");
    expect(
      await f.t.run((ctx) => ctx.db.query("articles").collect()),
    ).toHaveLength(0);
    expect(
      await f.t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      ),
    ).toHaveLength(0);
  });

  it("retries transient provider failures a bounded number of times without losing text", async () => {
    const f = await secondReaderTest(modules);
    const articleId = await f.t.mutation(
      internal.articles.insertExtracted,
      input,
    );
    vi.mocked(embedTexts).mockRejectedValue(
      new Error("Provider returned 429: fixture"),
    );
    for (let n = 0; n < 5; n++) {
      const retryAt = (await row(f, articleId))?.libraryIndex?.retryAt;
      if (retryAt && retryAt > Date.now()) vi.setSystemTime(retryAt);
      await f.t.action(internal.actions.indexLibraryArticle.run, { articleId });
    }
    expect(embedTexts).toHaveBeenCalledTimes(3);
    expect(await row(f, articleId)).toMatchObject({
      content: input.content,
      libraryIndex: { status: "failed", attempts: 3 },
    });
    await f.t.action(internal.actions.embedArticle.embed, { articleId });
    await f.t.action(internal.actions.indexLibraryArticle.run, { articleId });
    expect(embedTexts).toHaveBeenCalledTimes(3);
  });

  it.each([
    "Provider refused the key (401)",
    "Embedding response did not match the requested texts",
  ])("does not retry permanent provider failure: %s", async (message) => {
    const f = await secondReaderTest(modules);
    const articleId = await f.t.mutation(
      internal.articles.insertExtracted,
      input,
    );
    vi.mocked(embedTexts).mockRejectedValue(new Error(message));
    await f.t.action(internal.actions.indexLibraryArticle.run, { articleId });
    await f.t.action(internal.actions.indexLibraryArticle.run, { articleId });
    expect(embedTexts).toHaveBeenCalledTimes(1);
    expect(await row(f, articleId)).toMatchObject({
      content: input.content,
      libraryIndex: {
        status: message.includes("refused the key") ? "unavailable" : "failed",
      },
    });
  });

  it("leaves a no-key import unembedded and allows the existing backfill action later", async () => {
    const f = await secondReaderTest(modules);
    const articleId = await f.t.mutation(
      internal.articles.insertExtracted,
      input,
    );
    vi.mocked(loadReaderAI).mockResolvedValueOnce({
      providers: [],
      chain: () => [],
      embedder: () => null,
      noteFailure: async () => {},
    });
    await f.t.action(internal.actions.indexLibraryArticle.run, { articleId });
    expect(await row(f, articleId)).toMatchObject({
      libraryIndex: { status: "unavailable" },
    });
    expect(embedTexts).not.toHaveBeenCalled();
    await f.t.action(internal.actions.embedArticle.embed, { articleId });
    await f.t.action(internal.actions.indexLibraryArticle.run, { articleId });
    expect(await row(f, articleId)).toMatchObject({ embedding: vector });
  });

  it("pauses a refused key without a paid loop and resumes through the existing credential backfill", async () => {
    const f = await secondReaderTest(modules);
    const articleId = await f.t.mutation(
      internal.articles.insertExtracted,
      input,
    );
    vi.mocked(embedTexts).mockRejectedValueOnce(
      new Error("Provider refused the key (401)"),
    );
    await f.t.action(internal.actions.indexLibraryArticle.run, { articleId });
    await f.t.action(internal.actions.indexLibraryArticle.run, { articleId });
    expect(embedTexts).toHaveBeenCalledTimes(1);
    await f.t.action(internal.actions.embedArticle.embed, { articleId });
    await f.t.action(internal.actions.indexLibraryArticle.run, { articleId });
    expect(embedTexts).toHaveBeenCalledTimes(2);
    expect(await row(f, articleId)).toMatchObject({
      embedding: vector,
      libraryIndex: { status: "ready" },
    });
  });

  it.each([
    "disabled",
    "deleting",
    "removed",
  ])("fences %s readers/articles before provider and commit", async (state) => {
    const f = await secondReaderTest(modules);
    const articleId = await f.t.mutation(internal.articles.insertExtracted, {
      ...input,
      userId: f.readerLibraryId,
    });
    const claim = await f.t.mutation(internal.libraryIndex.claim, {
      articleId,
    });
    if (!claim) throw new Error("No index claim");
    await f.t.run(async (ctx) => {
      if (state === "removed") {
        await ctx.db.delete(articleId);
        return;
      }
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.readerLibraryId))
        .unique();
      if (!reader) throw new Error("No reader fixture");
      await ctx.db.patch(
        reader._id,
        state === "disabled"
          ? { status: "disabled" }
          : { deletingAt: Date.now() },
      );
    });
    expect(
      await f.t.mutation(
        internal.libraryIndex.validate,
        fence(articleId, claim),
      ),
    ).toBe(false);
    expect(
      await f.t.mutation(internal.libraryIndex.complete, {
        ...fence(articleId, claim),
        embedding: vector,
      }),
    ).toBe(false);
    await f.t.action(internal.actions.indexLibraryArticle.run, { articleId });
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it("rejects changed content, expired runs and newer vectors rather than attaching an old result", async () => {
    const f = await secondReaderTest(modules);
    const articleId = await f.t.mutation(
      internal.articles.insertExtracted,
      input,
    );
    const old = await f.t.mutation(internal.libraryIndex.claim, { articleId });
    if (!old) throw new Error("No claim");
    expect(
      await f.t.mutation(internal.libraryIndex.validate, {
        ...fence(articleId, old),
        model: "wrong-model",
      }),
    ).toBe(false);
    expect(
      await f.t.mutation(internal.libraryIndex.validate, {
        ...fence(articleId, old),
        revision: old.revision + 1,
      }),
    ).toBe(false);
    await f.t.run((ctx) =>
      ctx.db.patch(articleId, {
        content: "Changed after the paid request started",
      }),
    );
    expect(
      await f.t.mutation(internal.libraryIndex.complete, {
        ...fence(articleId, old),
        embedding: vector,
      }),
    ).toBe(false);
    const next = await f.t.mutation(internal.libraryIndex.claim, { articleId });
    if (!next) throw new Error("No replacement claim");
    expect(next.revision).toBeGreaterThan(old.revision);
    vi.setSystemTime(Date.now() + INDEX_LEASE_MS + 1);
    const replacement = await f.t.mutation(internal.libraryIndex.claim, {
      articleId,
    });
    if (!replacement) throw new Error("No lease replacement");
    expect(
      await f.t.mutation(internal.libraryIndex.complete, {
        ...fence(articleId, next),
        embedding: vector,
      }),
    ).toBe(false);
    await f.t.run((ctx) =>
      ctx.db.patch(articleId, { embedding: vector.map(() => 0.5) }),
    );
    expect(
      await f.t.mutation(internal.libraryIndex.complete, {
        ...fence(articleId, replacement),
        embedding: vector,
      }),
    ).toBe(false);
    expect((await row(f, articleId))?.embedding?.[0]).toBe(0.5);
  });
});

describe("transactional cross-source identities", () => {
  it("old deletion cleanup cannot delete aliases remapped to a reimported article", async () => {
    const f = await secondReaderTest(modules);
    const oldId = await f.t.mutation(internal.articles.insertExtracted, input);
    await f.t.run((ctx) => ctx.db.delete(oldId));
    const newId = await f.t.mutation(internal.articles.insertExtracted, input);
    expect(newId).not.toBe(oldId);
    await f.t.mutation(internal.articleImportKeys.discard, {
      articleId: oldId,
      userId: input.userId,
    });
    expect(
      await f.t.query(internal.articles.getByUrl, {
        userId: input.userId,
        url: input.url,
      }),
    ).toMatchObject({ _id: newId });
    expect(
      await f.t.query(internal.articles.getByGuid, {
        userId: input.userId,
        guid: input.guid,
      }),
    ).toMatchObject({ _id: newId });
    const aliases = await f.t.run((ctx) =>
      ctx.db.query("articleImportKeys").take(10),
    );
    expect(aliases).toHaveLength(2);
    expect(aliases.every((key) => key.articleId === newId)).toBe(true);
  });
  it("concurrent RSS/API/manual variants keep one ID, source GUIDs, and the feed association", async () => {
    const f = await secondReaderTest(modules);
    const { articleId, feedId, args } = await placeholder(f);
    const [manual, api] = await Promise.all([
      f.t.mutation(internal.articles.insertExtracted, {
        ...input,
        guid: input.url,
        url: `${input.url}/#comments`,
      }),
      f.t.action(internal.actions.ingestExternal.ingest, {
        userId: input.userId,
        externalId: "other-source",
        url: `${input.url}/`,
        title: input.title,
        html: input.contentHtml,
      }),
    ]);
    expect(manual).toBe(articleId);
    expect(api).toEqual({ ok: true, articleId, created: false });
    expect(await row(f, articleId)).toMatchObject({
      guid: args.guid,
      feedId,
      content: input.content,
    });
    expect(
      (
        await f.t.query(internal.articles.getByGuid, {
          userId: input.userId,
          guid: input.url,
        })
      )?._id,
    ).toBe(articleId);
    expect(
      await f.t.query(internal.externalApi.articleByExternalId, {
        userId: input.userId,
        externalId: "other-source",
      }),
    ).toBe(articleId);
    expect(
      (
        await f.t.query(internal.readwise.findArticle, {
          userId: input.userId,
          readerDocumentId: "new-reader-id",
          url: `${input.url}/`,
        })
      )?._id,
    ).toBe(articleId);
    const duplicate = await f.t.mutation(internal.articles.upsertFeed, args);
    expect(duplicate).toEqual({ articleId, created: false });
    expect(await f.t.run((ctx) => ctx.db.get(feedId))).toMatchObject({
      articleCount: 1,
    });
    expect(
      await f.t.run((ctx) => ctx.db.query("articles").collect()),
    ).toHaveLength(1);
  });

  it("serializes a fresh concurrent URL insert across sources and retains API create semantics", async () => {
    const f = await secondReaderTest(modules);
    const [a, b] = await Promise.all(
      ["a", "b"].map((externalId) =>
        f.t.action(internal.actions.ingestExternal.ingest, {
          userId: input.userId,
          externalId,
          url: input.url,
          title: input.title,
          html: input.contentHtml,
        }),
      ),
    );
    expect(a.ok && b.ok && a.articleId === b.articleId).toBe(true);
    expect([a, b].filter((value) => value.ok && value.created)).toHaveLength(1);
    expect(
      await f.t.run((ctx) => ctx.db.query("articles").collect()),
    ).toHaveLength(1);
  });

  it("never conflates meaningful query parameters or readers, or matches empty URLs", async () => {
    const f = await secondReaderTest(modules);
    const ids = await Promise.all([
      f.t.mutation(internal.articles.insertExtracted, {
        ...input,
        guid: "query1",
        url: `${input.url}?page=1`,
      }),
      f.t.mutation(internal.articles.insertExtracted, {
        ...input,
        guid: "query2",
        url: `${input.url}?page=2`,
      }),
      f.t.mutation(internal.articles.insertExtracted, {
        ...input,
        userId: f.readerLibraryId,
      }),
      f.t.mutation(internal.articles.insertExtracted, {
        ...input,
        guid: "empty1",
        url: "",
      }),
      f.t.mutation(internal.articles.insertExtracted, {
        ...input,
        guid: "empty2",
        url: "",
      }),
    ]);
    expect(new Set(ids).size).toBe(5);
    expect(
      await f.t.query(internal.articles.getByUrl, {
        userId: input.userId,
        url: input.url,
      }),
    ).toBeNull();
  });

  it("adds a first feed to a readable article without changing ID or reextracting it", async () => {
    const f = await secondReaderTest(modules);
    const articleId = await f.t.mutation(
      internal.articles.insertExtracted,
      input,
    );
    const feed = await placeholder(f);
    expect(feed.articleId).toBe(articleId);
    expect(await row(f, articleId)).toMatchObject({
      guid: input.guid,
      extractionStatus: "extracted",
      content: input.content,
      feedId: feed.feedId,
    });
    expect(extract).not.toHaveBeenCalled();
  });

  it("bounds alias cleanup and never deletes another reader's source identities", async () => {
    const f = await secondReaderTest(modules);
    const articleId = await f.t.mutation(internal.articles.insertExtracted, {
      ...input,
      guid: "__proto__",
    });
    const foreignId = await f.t.mutation(internal.articles.insertExtracted, {
      ...input,
      userId: f.readerLibraryId,
    });
    await f.t.mutation(internal.articleImportKeys.discard, {
      articleId,
      userId: input.userId,
    });
    expect(
      await f.t.query(internal.articles.getByGuid, {
        userId: input.userId,
        guid: "__proto__",
      }),
    ).not.toBeNull();
    await f.t.run((ctx) => ctx.db.delete(articleId));
    await f.t.mutation(internal.articleImportKeys.discard, {
      articleId,
      userId: input.userId,
    });
    const count = await f.t.run(async (ctx) => {
      const { purgeForReader } = await import("./articleImportKeys");
      return purgeForReader(ctx, input.userId);
    });
    expect(count).toBe(0);
    expect(
      await f.t.query(internal.articles.getByUrl, {
        userId: f.readerLibraryId,
        url: input.url,
      }),
    ).toMatchObject({ _id: foreignId });
    expect(
      await f.t.run((ctx) => ctx.db.query("articleImportKeys").collect()),
    ).toHaveLength(2);
  });

  it("stores fixed-size alias keys so unusually long source IDs cannot break bounded cleanup", async () => {
    const f = await secondReaderTest(modules);
    const guid = "g".repeat(400_000);
    const articleId = await f.t.mutation(internal.articles.insertExtracted, {
      ...input,
      guid,
    });
    expect(
      await f.t.query(internal.articles.getByGuid, {
        userId: input.userId,
        guid,
      }),
    ).toMatchObject({ _id: articleId });
    const keys = await f.t.run((ctx) =>
      ctx.db.query("articleImportKeys").collect(),
    );
    expect(keys).toHaveLength(2);
    expect(keys.every((key) => key.key.length === 64)).toBe(true);
  });
});

describe("claimed, deadlined RSS extraction", () => {
  it("an expired extractor stays queued if its recovery finds two newer workers", async () => {
    const f = await secondReaderTest(modules);
    const items = await Promise.all(
      ["/expiry-0", "/expiry-1", "/expiry-2"].map((suffix) =>
        placeholder(f, suffix),
      ),
    );
    const old = await f.t.mutation(internal.articleExtraction.claim, {
      articleId: items[0].articleId,
    });
    if (!old) throw new Error("No old claim");
    vi.setSystemTime(Date.now() + EXTRACTION_LEASE_MS + 1);
    const next = await f.t.mutation(internal.articleExtraction.claim, {
      articleId: items[1].articleId,
    });
    await f.t.mutation(internal.articleExtraction.claim, {
      articleId: items[2].articleId,
    });
    if (!next) throw new Error("No newer claim");
    await f.t.mutation(internal.articleExtraction.start, {
      articleId: items[0].articleId,
      userId: input.userId,
    });
    expect(
      (await row(f, items[0].articleId))?.extractionLeaseUntil,
    ).toBeUndefined();
    const before = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(100),
    );
    const content = prepareImportContent(input.contentHtml);
    if (!content) throw new Error("Invalid fixture");
    await f.t.mutation(internal.articles.updateExtracted, {
      ...content,
      articleId: items[1].articleId,
      userId: input.userId,
      extractionRun: next.run,
    });
    const after = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(100),
    );
    expect(
      after
        .filter(
          (job) =>
            !before.some((old) => old._id === job._id) &&
            job.name.includes("articleExtraction:start"),
        )
        .map((job) => job.args[0]),
    ).toEqual([{ articleId: items[0].articleId, userId: input.userId }]);
    expect(
      await f.t.mutation(internal.articleExtraction.claim, {
        articleId: items[0].articleId,
      }),
    ).toMatchObject({ run: old.run + 1 });
    expect((await row(f, items[0].articleId))?.extractionAttempts).toBe(2);
  });
  it("extracts five fast items through release wakes before any 45-second recovery", async () => {
    const f = await secondReaderTest(modules);
    const items = await Promise.all(
      ["/fast-0", "/fast-1", "/fast-2", "/fast-3", "/fast-4"].map((suffix) =>
        placeholder(f, suffix),
      ),
    );
    const began = Date.now();
    let active = 0;
    let maximum = 0;
    let thirdSawRelease = false;
    const urls: string[] = [];
    vi.mocked(extract).mockImplementation(async (url) => {
      active++;
      maximum = Math.max(maximum, active);
      urls.push(url);
      if (urls.length === 3)
        thirdSawRelease = (
          await Promise.all(
            items.slice(0, 2).map((item) => row(f, item.articleId)),
          )
        ).some((article) => article?.extractionStatus === "extracted");
      await Promise.resolve();
      active--;
      return { content: input.contentHtml };
    });
    await importTurns(f.t);
    expect(thirdSawRelease).toBe(true);
    expect(maximum).toBeLessThanOrEqual(2);
    expect(new Set(urls).size).toBe(5);
    expect(urls).toHaveLength(5);
    expect(
      (await Promise.all(items.map((item) => row(f, item.articleId)))).every(
        (article) => article?.extractionStatus === "extracted",
      ),
    ).toBe(true);
    expect(Date.now() - began).toBe(20);
    const recovery = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(200),
    );
    const leaseJobs = recovery.filter(
      (job) =>
        job.name.includes("articleExtraction:start") &&
        job.scheduledTime >= began + EXTRACTION_LEASE_MS,
    );
    expect(leaseJobs).toHaveLength(5);
    expect(leaseJobs.every((job) => job.state.kind === "pending")).toBe(true);
  });

  it("an extraction failure wakes ready items rather than its backoff or a book placeholder", async () => {
    const f = await secondReaderTest(modules);
    const items = await Promise.all(
      ["/backoff", "/active", "/next"].map((suffix) => placeholder(f, suffix)),
    );
    const first = await f.t.mutation(internal.articleExtraction.claim, {
      articleId: items[0].articleId,
    });
    await f.t.mutation(internal.articleExtraction.claim, {
      articleId: items[1].articleId,
    });
    if (!first) throw new Error("No claim");
    await f.t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: input.userId,
        guid: "partial-book",
        url: "upload:partial",
        title: "Partial book",
        bookUnitCount: 1,
        extractionStatus: "pending",
        annotationStatus: "skipped",
        createdAt: Date.now(),
      }),
    );
    const before = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(100),
    );
    for (let i = 0; i < 3; i++)
      await f.t.mutation(internal.articleExtraction.start, {
        articleId: items[2].articleId,
        userId: input.userId,
      });
    expect(
      await f.t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").take(100),
      ),
    ).toHaveLength(before.length);
    await f.t.mutation(internal.articleExtraction.fail, {
      articleId: items[0].articleId,
      userId: input.userId,
      run: first.run,
      retryable: true,
    });
    const after = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(100),
    );
    const wakes = after.filter(
      (job) => !before.some((old) => old._id === job._id),
    );
    expect(
      wakes
        .filter((job) => job.scheduledTime <= Date.now())
        .map((job) => job.args[0]),
    ).toEqual([{ articleId: items[2].articleId, userId: input.userId }]);
    expect(
      await f.t.mutation(internal.articleExtraction.claim, {
        articleId: items[0].articleId,
      }),
    ).toBeNull();
    expect((await row(f, items[0].articleId))?.extractionAttempts).toBe(1);
  });
  it("recovers a dispatched extractor lost before its first fetch and rejects the delayed old dispatch", async () => {
    const f = await secondReaderTest(modules);
    const { articleId } = await placeholder(f);
    await f.t.mutation(internal.articleExtraction.start, { articleId });
    const old = (await row(f, articleId))?.extractionRun;
    if (!old) throw new Error("No extraction dispatch");
    expect(extract).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + EXTRACTION_LEASE_MS + 1);
    await f.t.mutation(internal.articleExtraction.start, { articleId });
    const next = (await row(f, articleId))?.extractionRun;
    if (!next) throw new Error("No recovery dispatch");
    vi.mocked(extract).mockResolvedValue({ content: input.contentHtml });
    await f.t.action(internal.actions.extractArticle.extractClaimed, {
      articleId,
      userId: input.userId,
      run: old,
    });
    expect(extract).not.toHaveBeenCalled();
    await f.t.action(internal.actions.extractArticle.extractClaimed, {
      articleId,
      userId: input.userId,
      run: next,
    });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(await row(f, articleId)).toMatchObject({
      extractionStatus: "extracted",
      content: input.content,
    });
  });
  it("caps simultaneous external extraction and lets waiting claims resume without spending attempts", async () => {
    const f = await secondReaderTest(modules);
    const items = await Promise.all(
      ["/a", "/b", "/c"].map((suffix) => placeholder(f, suffix)),
    );
    const started = deferred<void>();
    const response = deferred<Awaited<ReturnType<typeof extract>>>();
    let calls = 0;
    vi.mocked(extract).mockImplementation(() => {
      calls++;
      if (calls === 2) started.resolve();
      return response.promise;
    });
    const actions = items
      .slice(0, 2)
      .map(({ articleId }) =>
        f.t.action(internal.actions.extractArticle.extractOne, { articleId }),
      );
    await started.promise;
    await f.t.action(internal.actions.extractArticle.extractOne, {
      articleId: items[2].articleId,
    });
    expect(extract).toHaveBeenCalledTimes(2);
    expect(
      (await row(f, items[2].articleId))?.extractionAttempts,
    ).toBeUndefined();
    response.resolve({ content: input.contentHtml });
    await Promise.all(actions);
    await f.t.action(internal.actions.extractArticle.extractOne, {
      articleId: items[2].articleId,
    });
    expect(extract).toHaveBeenCalledTimes(3);
    expect(await row(f, items[2].articleId)).toMatchObject({
      extractionStatus: "extracted",
      extractionAttempts: 1,
    });
  });
  it("two extractors make just one external request, slim before saving, and never embed inline", async () => {
    const f = await secondReaderTest(modules);
    const { articleId } = await placeholder(f);
    const started = deferred<void>();
    const response = deferred<Awaited<ReturnType<typeof extract>>>();
    vi.mocked(extract).mockImplementation((_url, _parse, options) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      started.resolve();
      return response.promise;
    });
    const first = f.t.action(internal.actions.extractArticle.extractOne, {
      articleId,
    });
    await started.promise;
    await f.t.action(internal.actions.extractArticle.extractOne, { articleId });
    expect(extract).toHaveBeenCalledTimes(1);
    response.resolve({
      title: "Valid title",
      content: `<script>tracking</script><img src='data:image/png;base64,${"X".repeat(1_100_000)}'><p>日本語 😀 readable</p>`,
    });
    await first;
    expect(await row(f, articleId)).toMatchObject({
      content: "日本語 😀 readable",
      contentHtml: "<p>日本語 😀 readable</p>",
      extractionStatus: "extracted",
      libraryIndex: { status: "pending" },
    });
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it("rejects an expired extractor result and failure after a replacement/manual import wins", async () => {
    const f = await secondReaderTest(modules);
    const { articleId } = await placeholder(f);
    const old = await f.t.mutation(internal.articleExtraction.claim, {
      articleId,
    });
    if (!old) throw new Error("No old claim");
    vi.setSystemTime(Date.now() + EXTRACTION_LEASE_MS + 1);
    const next = await f.t.mutation(internal.articleExtraction.claim, {
      articleId,
    });
    if (!next) throw new Error("No replacement claim");
    const { guid: _guid, url: _url, ...content } = input;
    expect(
      await f.t.mutation(internal.articles.updateExtracted, {
        ...content,
        articleId,
        extractionRun: old.run,
      }),
    ).toBe(false);
    await f.t.mutation(internal.articles.insertExtracted, input);
    expect(
      await f.t.mutation(internal.articleExtraction.fail, {
        articleId,
        userId: input.userId,
        run: next.run,
        retryable: false,
      }),
    ).toBe(false);
    expect(await row(f, articleId)).toMatchObject({
      content: input.content,
      extractionStatus: "extracted",
    });
  });

  it("aborts a hung request at the explicit deadline and durably schedules bounded retries", async () => {
    const f = await secondReaderTest(modules);
    const { articleId } = await placeholder(f);
    const started = deferred<void>();
    let signal: AbortSignal | undefined;
    vi.mocked(extract).mockImplementation((_url, _parse, options) => {
      if (!(options?.signal instanceof AbortSignal))
        throw new Error("Missing extractor abort signal");
      signal = options.signal;
      started.resolve();
      return new Promise(() => {});
    });
    const action = f.t.action(internal.actions.extractArticle.extractOne, {
      articleId,
    });
    await started.promise;
    // Move only the deadline, not the fixture's scheduled background actions.
    vi.setSystemTime(Date.now() + EXTRACTION_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(EXTRACTION_TIMEOUT_MS);
    await action;
    expect(signal?.aborted).toBe(true);
    expect(await row(f, articleId)).toMatchObject({
      extractionStatus: "pending",
      extractionFailure: "transient",
      extractionAttempts: 1,
    });
  });

  it("rejects a parser result that finishes after the wall-clock deadline before abort can fire", async () => {
    const f = await secondReaderTest(modules);
    const { articleId } = await placeholder(f);
    vi.mocked(extract).mockImplementation(async () => {
      vi.setSystemTime(Date.now() + EXTRACTION_TIMEOUT_MS + 1);
      return { content: input.contentHtml };
    });
    await f.t.action(internal.actions.extractArticle.extractOne, { articleId });
    expect(await row(f, articleId)).toMatchObject({
      extractionStatus: "pending",
      extractionFailure: "transient",
    });
    expect((await row(f, articleId))?.content).toBeUndefined();
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it.each([
    "",
    `<p>${"界".repeat(200_000)}</p>`,
    `<p>${"x".repeat(500_000)}</p>`,
  ])("refuses invalid/UTF-8 oversized content before any optional provider", async (html) => {
    const f = await secondReaderTest(modules);
    const { articleId } = await placeholder(f);
    vi.mocked(extract).mockResolvedValue({ content: html });
    await f.t.action(internal.actions.extractArticle.extractOne, { articleId });
    expect(await row(f, articleId)).toMatchObject({
      extractionStatus: "failed",
      extractionFailure: "invalid",
    });
    expect((await row(f, articleId))?.content).toBeUndefined();
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it("rejects metadata-over-budget rows before storing or scheduling a paid retry", async () => {
    const f = await secondReaderTest(modules);
    const { articleId } = await placeholder(f);
    vi.mocked(extract).mockResolvedValue({
      content: `<p>${"x".repeat(449_990)}</p>`,
    });
    await f.t.action(internal.actions.extractArticle.extractOne, { articleId });
    expect(await row(f, articleId)).toMatchObject({
      extractionStatus: "failed",
      extractionFailure: "invalid",
    });
    expect((await row(f, articleId))?.content).toBeUndefined();
    expect(embedTexts).not.toHaveBeenCalled();
    const api = await f.t.action(internal.actions.ingestExternal.ingest, {
      userId: input.userId,
      externalId: "huge-title",
      title: "x".repeat(900_000),
      html: input.contentHtml,
    });
    expect(api).toEqual({ ok: false, reason: "too_large" });
  });

  it("exhausts crashed extractor leases without unbounded fetches", async () => {
    const f = await secondReaderTest(modules);
    const { articleId } = await placeholder(f);
    for (let n = 0; n < 3; n++) {
      expect(
        await f.t.mutation(internal.articleExtraction.claim, { articleId }),
      ).not.toBeNull();
      vi.setSystemTime(Date.now() + EXTRACTION_LEASE_MS + 1);
    }
    expect(
      await f.t.mutation(internal.articleExtraction.claim, { articleId }),
    ).toBeNull();
    expect(await row(f, articleId)).toMatchObject({
      extractionStatus: "failed",
      extractionFailure: "exhausted",
      extractionAttempts: 3,
    });
  });

  it("retries a transient extractor HTTP failure but never replaces stored readable content", async () => {
    const f = await secondReaderTest(modules);
    const { articleId } = await placeholder(f);
    vi.mocked(extract).mockRejectedValueOnce(
      new Error("Request failed with error code 503"),
    );
    await f.t.action(internal.actions.extractArticle.extractOne, { articleId });
    expect(await row(f, articleId)).toMatchObject({
      extractionFailure: "transient",
      extractionStatus: "pending",
    });
    await f.t.action(internal.actions.extractArticle.extractOne, { articleId });
    expect(extract).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 5001);
    vi.mocked(extract).mockResolvedValue({ content: input.contentHtml });
    await f.t.action(internal.actions.extractArticle.extractOne, { articleId });
    expect(await row(f, articleId)).toMatchObject({
      extractionStatus: "extracted",
      content: input.content,
    });
    vi.mocked(extract).mockRejectedValue(
      new Error("Request failed with error code 500"),
    );
    await f.t.action(internal.actions.extractArticle.extractOne, { articleId });
    expect(extract).toHaveBeenCalledTimes(2);
    expect(await row(f, articleId)).toMatchObject({
      extractionStatus: "extracted",
      content: input.content,
    });
  });

  it("will not fetch for disabled/deleting readers or let a foreign claim commit", async () => {
    const f = await secondReaderTest(modules);
    const articleId = await f.t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: f.readerLibraryId,
        guid: "g",
        url: input.url,
        title: input.title,
        extractionStatus: "pending",
        annotationStatus: "pending",
        createdAt: Date.now(),
      }),
    );
    const readerId = await f.t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("readers")
            .withIndex("by_libraryId", (q) =>
              q.eq("libraryId", f.readerLibraryId),
            )
            .unique()
        )?._id,
    );
    if (!readerId) throw new Error("No reader");
    await f.t.run((ctx) => ctx.db.patch(readerId, { deletingAt: Date.now() }));
    await f.t.action(internal.actions.extractArticle.extractOne, { articleId });
    await f.t.run((ctx) =>
      ctx.db.patch(readerId, { deletingAt: undefined, status: "disabled" }),
    );
    await f.t.action(internal.actions.extractArticle.extractOne, { articleId });
    expect(extract).not.toHaveBeenCalled();
    await f.t.run((ctx) => ctx.db.patch(readerId, { status: "active" }));
    const claim = await f.t.mutation(internal.articleExtraction.claim, {
      articleId,
    });
    if (!claim) throw new Error("No claim");
    const content = prepareImportContent(input.contentHtml);
    if (!content) throw new Error("Invalid fixture");
    expect(
      await f.t.mutation(internal.articles.updateExtracted, {
        ...content,
        articleId,
        extractionRun: claim.run,
        userId: "default_user",
      }),
    ).toBe(false);
  });
});

describe("shared validation", () => {
  it("repairs Unicode and removes quoted/unquoted data images before byte checks", () => {
    const result = prepareImportContent(
      `<img src=data:image/png;base64,${"x".repeat(1_100_000)}><p>Valid\uD800</p>`,
    );
    expect(result?.contentHtml).toBe("<p>Valid�</p>");
    expect(result?.content.isWellFormed()).toBe(true);
  });
});
