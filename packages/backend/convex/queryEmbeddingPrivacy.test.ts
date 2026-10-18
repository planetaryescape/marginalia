/// <reference types="vite/client" />
import { afterEach, expect, it, vi } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import { cachedQueryEmbedding } from "./lib/queryEmbeddingCache";

const modules = import.meta.glob("./**/*.ts");
const embedding = Array.from({ length: 1536 }, () => 1);
afterEach(() => vi.unstubAllGlobals());

it.each([
  "disabled",
  "deleting",
  "deleted",
] as const)("refuses new and legacy publication for a %s library", async (state) => {
  const { t, readerLibraryId } = await secondReaderTest(modules);
  await t.run(async (ctx) => {
    const reader = await ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", readerLibraryId))
      .unique();
    if (!reader) throw new Error("Reader fixture missing");
    if (state === "deleted") await ctx.db.delete(reader._id);
    else if (state === "disabled")
      await ctx.db.patch(reader._id, { status: "disabled" });
    else await ctx.db.patch(reader._id, { deletingAt: Date.now() });
  });
  const args = {
    userId: readerLibraryId,
    key: "private query",
    model: "fixture",
    embedding,
    now: Date.now(),
  };
  await t.mutation(internal.queryEmbeddings.publish, args);
  await t.mutation(internal.queryEmbeddings.store, args);
  await t.mutation(internal.queryEmbeddings.cleanup, {
    userId: readerLibraryId,
    now: Date.now(),
  });
  expect(await t.run((ctx) => ctx.db.query("queryEmbeddings").take(1))).toEqual(
    [],
  );
  expect(
    await t.run((ctx) => ctx.db.query("queryEmbeddingCounts").take(1)),
  ).toEqual([]);
});

it("an embedding started while active cannot recreate query data after deleteMine and a completed cache purge", async () => {
  const { t, reader, readerLibraryId } = await secondReaderTest(modules);
  let started!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal("fetch", async () => {
    started();
    await held;
    return Response.json({ data: [{ index: 0, embedding }] });
  });
  const pending = t.action(async (ctx) => {
    const result = await cachedQueryEmbedding(
      ctx,
      readerLibraryId,
      "private query",
      { provider: "openai", apiKey: "fixture" },
    );
    await result.publication;
    return result.vector;
  });
  await waiting;
  await reader.mutation(api.account.deleteMine, { confirmation: "DELETE" });
  // Hold the embedding across the state reached when purge has passed these
  // tables and removed the reader. No scheduler drain/timeout race is needed.
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query("queryEmbeddings").take(500))
      await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("queryEmbeddingCounts").take(10))
      await ctx.db.delete(row._id);
    const row = await ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", readerLibraryId))
      .first();
    if (row) await ctx.db.delete(row._id);
  });
  release();
  expect(await pending).toEqual(embedding);
  // Legacy durable jobs are fenced too, and cleanup must not recreate a count.
  await t.mutation(internal.queryEmbeddings.store, {
    userId: readerLibraryId,
    key: "late legacy",
    model: "fixture",
    embedding,
    now: Date.now(),
  });
  await t.mutation(internal.queryEmbeddings.cleanup, {
    userId: readerLibraryId,
    now: Date.now(),
  });
  expect(await t.run((ctx) => ctx.db.query("queryEmbeddings").take(1))).toEqual(
    [],
  );
  expect(
    await t.run((ctx) => ctx.db.query("queryEmbeddingCounts").take(1)),
  ).toEqual([]);
});

it("still publishes for the owner and cleanup does not recreate an absent counter", async () => {
  const { t } = await secondReaderTest(modules);
  const args = {
    userId: "default_user",
    key: "owner query",
    model: "fixture",
    embedding,
    now: Date.now(),
  };
  await t.mutation(internal.queryEmbeddings.publish, args);
  expect(
    await t.query(internal.queryEmbeddings.lookup, {
      userId: args.userId,
      key: args.key,
      model: args.model,
      now: args.now,
    }),
  ).toEqual(embedding);
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query("queryEmbeddingCounts").take(10))
      await ctx.db.delete(row._id);
  });
  await t.mutation(internal.queryEmbeddings.cleanup, {
    userId: args.userId,
    now: args.now,
  });
  expect(
    await t.run((ctx) => ctx.db.query("queryEmbeddingCounts").take(1)),
  ).toEqual([]);
});
