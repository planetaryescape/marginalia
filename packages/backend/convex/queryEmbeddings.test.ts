/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { readerTest } from "../test/owner";
import { internal } from "./_generated/api";
import {
  cachedQueryEmbedding,
  normaliseQuery,
  QUERY_EMBEDDING_CAP,
  QUERY_EMBEDDING_TTL_MS,
} from "./lib/queryEmbeddingCache";

const modules = import.meta.glob("./**/*.ts");
const embedding = Array.from({ length: 1536 }, (_, i) => i / 1536);
const DAY = 24 * 60 * 60_000;
const embedder = { provider: "openrouter" as const, apiKey: "test-only" };
const MODEL = "openai/text-embedding-3-small";

async function cacheTest() {
  const t = readerTest(modules);
  await t.run(async (ctx) => {
    for (const libraryId of ["reader-a", "reader-b"])
      await ctx.db.insert("readers", {
        libraryId,
        authId: `fixture-${libraryId}`,
        status: "active",
        createdAt: 0,
      });
  });
  return t;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Counts embedding requests and returns a vector for each, as the provider does. */
function embeddingCalls() {
  const calls: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return Response.json({ data: [{ index: 0, embedding }] });
  });
  return calls;
}

/** The action context the find route gives the cache, backed by the test database. */
function actionCtx(t: ReturnType<typeof readerTest>) {
  const run = t as unknown as {
    query(ref: unknown, args: unknown): Promise<unknown>;
    mutation(ref: unknown, args: unknown): Promise<unknown>;
  };
  return {
    runQuery: (ref: unknown, args: unknown) => run.query(ref, args),
    runMutation: (ref: unknown, args: unknown) => run.mutation(ref, args),
    scheduler: {
      runAfter: (_delay: number, ref: unknown, args: unknown) =>
        run.mutation(ref, args),
    },
  } as never;
}

describe("normaliseQuery", () => {
  it("lower-cases, collapses whitespace and trims", () => {
    expect(normaliseQuery("  Rust\t  Async\n Runtimes ")).toBe(
      "rust async runtimes",
    );
    expect(normaliseQuery("Rust async runtimes")).toBe(
      normaliseQuery("rust  async   runtimes"),
    );
  });
});

describe("cachedQueryEmbedding", () => {
  it("embeds a miss once, then serves the repeat from the cache", async () => {
    const t = await cacheTest();
    const calls = embeddingCalls();
    const ctx = actionCtx(t);

    const first = await cachedQueryEmbedding(
      ctx,
      "reader-a",
      "rust async",
      embedder,
    );
    await first.publication;
    const second = await cachedQueryEmbedding(
      ctx,
      "reader-a",
      "rust async",
      embedder,
    );

    expect(first.cached).toBe(false);
    expect(second).toMatchObject({ vector: embedding, cached: true });
    expect(first.vector).toEqual(embedding);
    expect(calls).toHaveLength(1);
  });

  it("treats differently spaced and cased queries as one entry", async () => {
    const t = await cacheTest();
    const calls = embeddingCalls();
    const ctx = actionCtx(t);

    await (
      await cachedQueryEmbedding(ctx, "reader-a", "  Rust   Async ", embedder)
    ).publication;
    const repeat = await cachedQueryEmbedding(
      ctx,
      "reader-a",
      "rust async",
      embedder,
    );

    expect(repeat.cached).toBe(true);
    expect(calls).toHaveLength(1);
    // The embedded text is the normalised form, so the stored vector matches its key
    expect(calls[0]).toEqual({ input: ["rust async"], model: MODEL });
  });

  it("keeps each reader's entries to themselves", async () => {
    const t = await cacheTest();
    const calls = embeddingCalls();
    const ctx = actionCtx(t);

    await (await cachedQueryEmbedding(ctx, "reader-a", "rust async", embedder))
      .publication;
    const other = await cachedQueryEmbedding(
      ctx,
      "reader-b",
      "rust async",
      embedder,
    );
    await other.publication;

    expect(other.cached).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("misses when the entry came from another model, and replaces it", async () => {
    const t = await cacheTest();
    const calls = embeddingCalls();
    const ctx = actionCtx(t);
    await t.mutation(internal.queryEmbeddings.store, {
      userId: "reader-a",
      key: "rust async",
      model: "text-embedding-ada-002",
      embedding: Array.from({ length: 1536 }, () => 0),
      now: Date.now(),
    });

    const result = await cachedQueryEmbedding(
      ctx,
      "reader-a",
      "rust async",
      embedder,
    );
    await result.publication;
    const again = await cachedQueryEmbedding(
      ctx,
      "reader-a",
      "rust async",
      embedder,
    );

    expect(result.cached).toBe(false);
    expect(result.vector).toEqual(embedding);
    expect(again.cached).toBe(true);
    expect(calls).toHaveLength(1);
    const rows = await t.run((ctx) =>
      ctx.db.query("queryEmbeddings").collect(),
    );
    expect(rows.map((row) => row.model)).toEqual([MODEL]);
  });

  it("falls back to embedding when the cache read fails", async () => {
    const calls = embeddingCalls();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      runQuery: async () => {
        throw new Error("cache unavailable");
      },
      runMutation: async () => {
        throw new Error("cache unavailable");
      },
    } as never;

    const result = await cachedQueryEmbedding(
      ctx,
      "reader-a",
      "rust async",
      embedder,
    );

    await result.publication;
    expect(result).toMatchObject({ vector: embedding, cached: false });
    expect(calls).toHaveLength(1);
    expect(errors).toHaveBeenCalledTimes(2);
  });
});

describe("queryEmbeddings expiry and cap", () => {
  it("ignores an entry once it is 30 days old, and keeps one just inside", async () => {
    const t = await cacheTest();
    const stored = 1_700_000_000_000;
    await t.mutation(internal.queryEmbeddings.store, {
      userId: "reader-a",
      key: "old",
      model: MODEL,
      embedding,
      now: stored,
    });
    const lookup = (now: number) =>
      t.query(internal.queryEmbeddings.lookup, {
        userId: "reader-a",
        key: "old",
        model: MODEL,
        now,
      });

    expect(await lookup(stored + QUERY_EMBEDDING_TTL_MS - DAY)).toEqual(
      embedding,
    );
    expect(await lookup(stored + QUERY_EMBEDDING_TTL_MS)).toBeNull();
  });

  it("keeps a reader at the cap by dropping the oldest entries on insert", async () => {
    const t = await cacheTest();
    const base = 1_700_000_000_000;
    for (let i = 0; i <= QUERY_EMBEDDING_CAP; i++) {
      await t.mutation(internal.queryEmbeddings.store, {
        userId: "reader-a",
        key: `query ${i}`,
        model: MODEL,
        embedding,
        now: base + i,
      });
    }
    // Another reader's entries are never counted against this one
    await t.mutation(internal.queryEmbeddings.store, {
      userId: "reader-b",
      key: "query 0",
      model: MODEL,
      embedding,
      now: base,
    });

    const keys = await t.run(async (ctx) =>
      (await ctx.db.query("queryEmbeddings").collect())
        .filter((row) => row.userId === "reader-a")
        .map((row) => row.key)
        .sort(),
    );
    expect(keys).toHaveLength(QUERY_EMBEDDING_CAP);
    expect(keys).not.toContain("query 0");
    expect(keys).toContain(`query ${QUERY_EMBEDDING_CAP}`);
    const counts = await t.run((ctx) =>
      ctx.db.query("queryEmbeddingCounts").collect(),
    );
    expect(counts.map((row) => [row.userId, row.count]).sort()).toEqual([
      ["reader-a", QUERY_EMBEDDING_CAP],
      ["reader-b", 1],
    ]);
  });

  it("removes expired entries when a new one is stored", async () => {
    const t = await cacheTest();
    const base = 1_700_000_000_000;
    await t.mutation(internal.queryEmbeddings.store, {
      userId: "reader-a",
      key: "stale",
      model: MODEL,
      embedding,
      now: base,
    });
    await t.mutation(internal.queryEmbeddings.store, {
      userId: "reader-a",
      key: "fresh",
      model: MODEL,
      embedding,
      now: base + QUERY_EMBEDDING_TTL_MS + DAY,
    });

    const keys = await t.run(async (ctx) =>
      (await ctx.db.query("queryEmbeddings").collect()).map((row) => row.key),
    );
    expect(keys).toEqual(["fresh"]);
    const counts = await t.run((ctx) =>
      ctx.db.query("queryEmbeddingCounts").collect(),
    );
    expect(counts.map((row) => row.count)).toEqual([1]);
  });
});
