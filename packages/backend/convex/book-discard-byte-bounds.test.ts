/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { metadataContext } from "../test/metadata";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());

it("discards near-limit unpublished units with atomic card cleanup under real transaction limits", async () => {
  vi.useFakeTimers();
  const t = convexTest({ schema, modules, transactionLimits: true });
  const userId = "default_user";
  const articleId = await t.run(async (raw) => {
    const ctx = metadataContext(raw);
    const id = await ctx.db.insert("articles", {
      userId,
      guid: "partial-large-book",
      url: "upload:partial-large-book",
      title: "Unpublished book",
      bookUnitCount: 12,
      bookOutline: Array.from({ length: 12 }, (_, index) => ({
        title: `Part ${index}`,
        minutes: 1,
      })),
      extractionStatus: "pending",
      annotationStatus: "pending",
      createdAt: Date.now(),
    });
    await ctx.db.insert("books", {
      userId,
      articleId: id,
      unitCount: 12,
      finishedThrough: -1,
      finished: false,
      furthestUnit: 0,
      furthestScroll: 0,
      furthestParagraph: 0,
      createdAt: Date.now(),
    });
    return id;
  });
  const unitIds: Id<"bookUnits">[] = [];
  for (let index = 0; index < 12; index++) {
    unitIds.push(
      await t.run((raw) =>
        metadataContext(raw).db.insert("bookUnits", {
          userId,
          articleId,
          index,
          title: `Part ${index}`,
          content: "界".repeat(165_000),
          contentHtml: "界".repeat(165_000),
          wordCount: 1,
          estimatedReadMinutes: 1,
          annotationStatus: "deferred",
        }),
      ),
    );
  }
  // Ten rich deletes, even without the selection scan, exceed the wrapped budget.
  await expect(
    t.mutation(async (raw) => {
      const ctx = metadataContext(raw);
      for (const id of unitIds.slice(0, 10))
        await ctx.db.delete("bookUnits", id);
    }),
  ).rejects.toThrow(/Read too much data/);
  expect(
    await t.run(
      async (ctx) => (await ctx.db.query("bookPartCards").take(20)).length,
    ),
  ).toBe(12);
  await t.mutation(internal.books.discardBook, { userId, articleId });
  const remaining = await t.run(
    async (ctx) => (await ctx.db.query("bookPartCards").take(20)).length,
  );
  expect(remaining).toBeGreaterThan(0);
  expect(remaining).toBeLessThan(12);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  for (const table of [
    "bookUnits",
    "books",
    "articles",
    "bookPartCards",
    "articleMetadata",
  ] as const)
    expect(await t.run((ctx) => ctx.db.query(table).take(1))).toHaveLength(0);
  const jobs = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").take(100),
  );
  expect(jobs.every((job) => job.state.kind === "success")).toBe(true);
});
