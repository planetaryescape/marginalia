/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { addReader } from "../test/owner";
import { api, internal } from "./_generated/api";
import authSchema from "./betterAuth/schema";
import { syncArticleMetadata } from "./lib/articleMetadata";
import "./functions";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("backfills near-limit sources without rewriting bodies and reads skipped metadata under 64 KB", async () => {
  const t = convexTest({ schema, modules, transactionLimits: true });
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("./betterAuth/**/*.ts"),
  );
  const { client, libraryId } = await addReader(t, {
    email: "queue-budget@example.com",
  });
  for (let i = 0; i < 12; i++)
    await t.run(async (ctx) => {
      const fields = {
        userId: libraryId,
        guid: `large-${i}`,
        url: `https://example.com/large-${i}`,
        title: `Large ${i}`,
        content: "x".repeat(990_000),
        extractionStatus: "extracted" as const,
        annotationStatus: "skipped" as const,
        skipReason: "no_provider" as const,
        estimatedReadMinutes: 3,
        queueCounted: true,
        createdAt: i,
      };
      const id = await ctx.db.insert("articles", fields);
      const source = await ctx.db.get(id);
      if (!source) throw new Error("Missing legacy source");
      await syncArticleMetadata(ctx, null, source);
    });
  await t.run(async (ctx) => {
    await ctx.db.insert("readingQueueStats", {
      userId: libraryId,
      annotated: 0,
      waiting: 0,
      pending: 0,
      fits5: 0,
      fits10: 0,
      fits20: 0,
      ready: true,
    });
    await ctx.db.insert("libraryMetadataState", {
      userId: libraryId,
      articlesReady: true,
      phase: "done",
      cursor: null,
    });
  });
  let maximumRead = 0;
  let maximumWrite = 0;
  for (let i = 0; i < 15; i++) {
    const metrics = await t.run(async (ctx) => {
      await ctx.runMutation(internal.readingQueue.initialize, {
        userId: libraryId,
      });
      return ctx.meta.getTransactionMetrics();
    });
    maximumRead = Math.max(maximumRead, metrics.bytesRead.used);
    maximumWrite = Math.max(maximumWrite, metrics.bytesWritten.used);
    if (
      (await t.run((ctx) => ctx.db.query("readableQueueStats").first()))?.ready
    )
      break;
  }
  // Pagination reads at most 1.5 MB plus one source of overshoot. Receipts and
  // counter progress remain compact; no full article patch is part of this scan.
  expect(maximumRead).toBeLessThan(3_600_000);
  expect(maximumWrite).toBeLessThan(20_000);
  expect(await client.query(api.home.counts, {})).toMatchObject({
    countsReady: true,
    waiting: 12,
    fits: { 5: 12 },
  });
  const measured = await client.query(async (ctx) => {
    const picks = await ctx.runQuery(api.suggestions.forWindow, {
      requestedMinutes: 5,
    });
    const upNext = await ctx.runQuery(api.home.upNextPage, {
      paginationOpts: { numItems: 8, cursor: null },
    });
    const more = await ctx.runQuery(api.suggestions.moreForWindow, {
      requestedMinutes: 5,
      paginationOpts: { numItems: 8, cursor: '["skipped",null]' },
    });
    return {
      picks: picks.length,
      upNext: upNext.page.length,
      more: more.page.length,
      metrics: await ctx.meta.getTransactionMetrics(),
    };
  });
  expect(measured).toMatchObject({ picks: 3, upNext: 8, more: 8 });
  expect(measured.metrics.bytesRead.used).toBeLessThan(64_000);
  process.stdout.write(
    `readable-queue-native-budget ${JSON.stringify({ maximumRead, maximumWrite, reads: measured.metrics.bytesRead.used })}\n`,
  );
});
