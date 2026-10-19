/// <reference types="vite/client" />
import { appendFileSync } from "node:fs";

import { getDocumentSize } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { addReader } from "../test/owner";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import authSchema from "./betterAuth/schema";
import {
  initializeEmptyMetadata,
  limitLegacyReadBytes,
  readLegacyDocument,
} from "./lib/articleMetadata";
import * as feedTitles from "./lib/feedStatus";
import { metadataTriggers } from "./lib/metadataTriggers";
import { roomPeriod } from "./lib/readingRoom";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.UTC(2026, 10, 2, 18);
const args = { timeZone: "America/New_York", period: "90days" } as const;
const MiB = 1024 * 1024;
const body = "界".repeat(330_000); // 990 KB UTF-8, not 990 KB of UTF-16 units.
function evidence(label: string, value: string) {
  const line = `${label} ${value}`;
  console.log(line);
  if (process.env.READING_ROOM_EVIDENCE)
    appendFileSync(process.env.READING_ROOM_EVIDENCE, `${line}\n`);
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function fixture() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const t = convexTest({ schema, modules, transactionLimits: true });
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("./betterAuth/**/*.ts"),
  );
  const { client, libraryId: userId } = await addReader(t, {
    email: "room-sources@example.com",
  });
  await t.run(async (ctx) => {
    expect(await feedTitles.initializeEmptyFeedStatus(ctx, userId)).toBe(true);
    expect(await initializeEmptyMetadata(ctx, userId)).toBe(true);
  });
  const measure = () =>
    client.run(async (ctx) => {
      const result = await ctx.runQuery(api.stats.readingRoom, args);
      return { result, metrics: await ctx.meta.getTransactionMetrics() };
    });
  return { t, client, userId, measure };
}

async function largeFixture() {
  const f = await fixture();
  const feeds: Id<"feeds">[] = [];
  const articles: Id<"articles">[] = [];
  for (let i = 0; i < 30; i++)
    await f.t.run(async (ctx) => {
      const { db } = metadataTriggers.wrapDB(ctx);
      const feedId = await db.insert("feeds", {
        userId: f.userId,
        title: `Source ${i}`,
        description: body,
        url: `https://example.com/feed/${i}`,
        isActive: i % 2 === 0,
        createdAt: i,
      });
      feeds.push(feedId);
      await db.insert("feedStats", {
        userId: f.userId,
        feedId,
        offered: 100 - i,
        opened: i,
        finished: i % 3,
        skipped: 2,
        updatedAt: 1,
      });
      if (i < 8)
        articles.push(
          await db.insert("articles", {
            userId: f.userId,
            guid: `a-${i}`,
            title: `Article ${i}`,
            content: body,
            url: `https://example.com/a/${i}`,
            estimatedReadMinutes: i % 2 ? 30 : 5,
            extractionStatus: "extracted",
            annotationStatus: "annotated",
            createdAt: i,
          }),
        );
    });
  for (let start = 0; start < 1501; start += 100)
    await f.t.run(async (ctx) => {
      for (let i = start; i < Math.min(start + 100, 1501); i++) {
        const at = Date.UTC(2026, 10, 1, 5) + i * 60_000;
        await ctx.db.insert("readingActivity", {
          userId: f.userId,
          articleId: articles[i % 8],
          visitId: `v-${i}`,
          day: "wrong-device-date",
          startedAt: at,
          updatedAt: at,
          activeTimeMs: 60_000,
          visibleTimeMs: 60_000,
          timeSpentMs: 60_000,
          maxScrollPercent: 50,
          annotationsOpened: Array.from(
            { length: 128 },
            (_, n) => `${n}-${"x".repeat(30)}`,
          ),
          // Old visit: must recover its length from the owned card/body.
        });
      }
    });
  return { ...f, feeds, articles };
}

it("runs the actual public room with 30 near-1MB sources and all 1501 full visits; the old source join fails native bytes", async () => {
  const f = await largeFixture();
  const ready = await f.measure();
  expect(ready.result).toMatchObject({
    partial: true,
    readsPartial: false,
    activeTimeMs: 1500 * 60_000,
    period: roomPeriod(NOW, args.timeZone, args.period),
    weekday: { short: 0, middle: 0, long: 0 },
    weekend: { short: 4, middle: 0, long: 4 },
  });
  expect(ready.result.feeds).toEqual(
    f.feeds.map((feedId, i) => ({
      feedId,
      title: `Source ${i}`,
      offered: 100 - i,
      opened: i,
      finished: i % 3,
      skipsMost: i / (100 - i) < 0.1,
    })),
  );
  expect(ready.result.heat.reduce((sum, n) => sum + n, 0)).toBe(1500);
  expect(ready.result.readingDays).toBe(2);
  // Only eight compact cards, thirty compact source headings, and visits:
  // even ONE canonical feed body would push this native delta over 990 KB.
  const visitBytes = await f.t.run(async (ctx) =>
    (await ctx.db.query("readingActivity").take(1501)).reduce(
      (sum, row) => sum + getDocumentSize(row),
      0,
    ),
  );
  expect(ready.metrics.bytesRead.used - visitBytes).toBeLessThan(100_000);
  expect(ready.metrics.bytesWritten.used).toBe(0);
  const old = vi
    .spyOn(feedTitles, "reportingFeedTitles")
    .mockImplementation(async (ctx, userId) => async (feedId) => {
      const feed = await ctx.db.get("feeds", feedId);
      return feed?.userId === userId ? feed.title : null;
    });
  const oldFailure = await f.client.run(async (ctx) => {
    await expect(ctx.runQuery(api.stats.readingRoom, args)).rejects.toThrow(
      /Read too much data/,
    );
    return ctx.meta.getTransactionMetrics();
  });
  expect(oldFailure.bytesRead.used).toBeGreaterThan(16 * MiB);
  old.mockRestore();
  // Remove only projections to model a genuinely legacy article library.
  await f.t.run(async (ctx) => {
    const state = await ctx.db.query("libraryMetadataState").first();
    if (!state) throw new Error("Missing metadata state");
    await ctx.db.patch(state._id, { articlesReady: false });
    for (const card of await ctx.db.query("articleMetadata").take(8))
      await ctx.db.delete(card._id);
  });
  const legacyArticles = await f.measure();
  expect(legacyArticles.result).toEqual(ready.result);
  expect(legacyArticles.metrics.bytesRead.used).toBeLessThan(16 * MiB);
  expect(legacyArticles.metrics.bytesWritten.used).toBe(0);
  // Feed and article bodies must not get independent ten-MiB pools. A missing
  // unready heading now needs one more body than the remaining allowance permits.
  await f.t.run(async (ctx) => {
    const counts = await ctx.db.query("feedStatusCounts").first();
    if (!counts) throw new Error("Missing status counts");
    await ctx.db.patch(counts._id, { ready: false });
    for (const entry of await ctx.db.query("feedStatusEntries").take(30))
      await ctx.db.delete(entry._id);
  });
  const boundedError = await f.client.run(async (ctx) => {
    await expect(ctx.runQuery(api.stats.readingRoom, args)).rejects.toThrow(
      /read budget/,
    );
    return ctx.meta.getTransactionMetrics();
  });
  expect(boundedError.bytesRead.used).toBeLessThan(16 * MiB);
  expect(boundedError.bytesWritten.used).toBe(0);
  evidence(
    "C06 room physical bytes",
    JSON.stringify({
      ready: ready.metrics,
      legacyArticles: legacyArticles.metrics,
      boundedError,
      oldFailure,
      visitBytes,
    }),
  );
});

it("preserves old joins' exact dates, DST buckets and outputs across all supported windows", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    const feedId = await db.insert("feeds", {
      userId: f.userId,
      title: "Exact historical source",
      url: "https://example.com/exact",
      isActive: false,
      createdAt: 0,
    });
    await db.insert("feedStats", {
      userId: f.userId,
      feedId,
      offered: 42,
      opened: 3,
      finished: 2,
      skipped: 1,
      updatedAt: 0,
    });
    const articleId = await db.insert("articles", {
      userId: f.userId,
      guid: "dates",
      title: "Dates",
      url: "https://example.com/dates",
      estimatedReadMinutes: 30,
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 0,
    });
    const times = new Set([
      Date.UTC(2026, 10, 1, 5, 30),
      Date.UTC(2026, 10, 1, 6, 30),
      NOW,
      NOW + 1,
    ]);
    for (const timeZone of ["UTC", "America/New_York", "Pacific/Auckland"])
      for (const period of ["month", "30days", "90days"] as const) {
        const { start } = roomPeriod(NOW, timeZone, period);
        times.add(start - 1);
        times.add(start);
        times.add(start + 1);
      }
    for (const startedAt of times)
      await db.insert("readingActivity", {
        userId: f.userId,
        articleId,
        visitId: `${startedAt}`,
        day: "wrong-zone",
        startedAt,
        updatedAt: startedAt,
        activeTimeMs: 60_000,
        visibleTimeMs: 60_000,
        timeSpentMs: 60_000,
        maxScrollPercent: 50,
        annotationsOpened: [],
      });
  });
  const factory = feedTitles.reportingFeedTitles;
  for (const timeZone of ["UTC", "America/New_York", "Pacific/Auckland"])
    for (const period of ["month", "30days", "90days"] as const) {
      const options = { timeZone, period, today: "ignored-date" };
      const current = await f.client.query(api.stats.readingRoom, options);
      const old = vi
        .spyOn(feedTitles, "reportingFeedTitles")
        .mockImplementation(async (ctx, userId) => async (feedId) => {
          const feed = await ctx.db.get("feeds", feedId);
          return feed?.userId === userId ? feed.title : null;
        });
      expect(await f.client.query(api.stats.readingRoom, options)).toEqual(
        current,
      );
      old.mockRestore();
      expect(feedTitles.reportingFeedTitles).toBe(factory);
      expect(current.partial).toBe(false);
      expect(current.period.end).toBe(NOW + 1);
      expect(current.activeTimeMs).toBeGreaterThan(0);
    }
  const ny = await f.client.query(api.stats.readingRoom, {
    timeZone: "America/New_York",
    period: "month",
  });
  // Both occurrences of 01:30 on the fall-back Sunday share the same hour.
  expect(ny.heat[6 * 24 + 1]).toBe(2);
});

it("charges the nonreturned 1501st physical visit while preserving the exact 1500-row boundary", async () => {
  const f = await fixture();
  const articleId = await f.t.run((ctx) =>
    metadataTriggers.wrapDB(ctx).db.insert("articles", {
      userId: f.userId,
      guid: "sentinel",
      title: "Sentinel",
      url: "https://example.com/sentinel",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 0,
    }),
  );
  let sentinel: Id<"readingActivity"> | undefined;
  for (let start = 0; start < 1501; start += 100)
    await f.t.run(async (ctx) => {
      for (let i = start; i < Math.min(start + 100, 1501); i++) {
        const id = await ctx.db.insert("readingActivity", {
          userId: f.userId,
          articleId,
          visitId: `${i}`,
          day: "2026-11-02",
          startedAt: NOW - i,
          updatedAt: NOW,
          activeTimeMs: 60_000,
          visibleTimeMs: 60_000,
          timeSpentMs: 60_000,
          maxScrollPercent: 50,
          annotationsOpened: Array.from(
            { length: 128 },
            (_, n) => `${n}-${"x".repeat(30)}`,
          ),
          estimatedReadMinutes: 5,
        });
        if (i === 1500) sentinel = id;
      }
    });
  if (!sentinel) throw new Error("Missing sentinel");
  const id = sentinel;
  const sentinelBytes = await f.t.run(async (ctx) => {
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Missing sentinel row");
    return getDocumentSize(row);
  });
  const before = await f.measure();
  await f.t.run((ctx) => ctx.db.delete(id));
  const after = await f.measure();
  expect(before.result.partial).toBe(true);
  expect(after.result.partial).toBe(false);
  expect({ ...before.result, partial: false }).toEqual(after.result);
  expect(before.metrics.bytesRead.used - after.metrics.bytesRead.used).toBe(
    sentinelBytes,
  );
  evidence(
    "C06 sentinel bytes",
    JSON.stringify({
      before: before.metrics,
      after: after.metrics,
      sentinelBytes,
    }),
  );
});

it("uses authoritative ready headings across missing, foreign, transfer, deletion, paused and Unicode/empty titles", async () => {
  const f = await fixture();
  const other = await addReader(f.t, { email: "other-room@example.com" });
  const titles = [
    "",
    "😀".repeat(2049),
    "paused",
    "transferred",
    "deleted",
    "missing",
    "foreign",
  ];
  const ids = await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    const ids: Id<"feeds">[] = [];
    for (const [i, title] of titles.entries()) {
      const feedId = await db.insert("feeds", {
        userId: f.userId,
        title,
        url: `https://example.com/${i}`,
        isActive: false,
        createdAt: i,
      });
      ids.push(feedId);
      await db.insert("feedStats", {
        userId: f.userId,
        feedId,
        offered: 100 - i,
        opened: 0,
        finished: 0,
        skipped: 0,
        updatedAt: 1,
      });
    }
    await db.patch(ids[3], {
      userId: other.libraryId,
      title: "PRIVATE transferred title",
    });
    await db.delete(ids[4]);
    const missing = await db
      .query("feedStatusEntries")
      .withIndex("by_feedId", (q) => q.eq("feedId", ids[5]))
      .unique();
    const foreign = await db
      .query("feedStatusEntries")
      .withIndex("by_feedId", (q) => q.eq("feedId", ids[6]))
      .unique();
    if (!missing || !foreign) throw new Error("Missing fixture entries");
    await db.delete(missing._id);
    await db.patch(foreign._id, {
      userId: other.libraryId,
      title: "PRIVATE entry",
    });
    return ids;
  });
  const ready = await f.measure();
  expect(ready.result.partial).toBe(false);
  expect(ready.result.feeds.map((f) => f.title)).toEqual([
    "",
    `${"😀".repeat(2048)}…`,
    "paused",
  ]);
  expect(ready.metrics.bytesWritten.used).toBe(0);
  // Unready/absent counts permit an owned legacy fallback, but never override a
  // foreign entry (including transfer) with a canonical body lookup.
  await f.t.run(async (ctx) => {
    const counts = await ctx.db
      .query("feedStatusCounts")
      .withIndex("by_userId", (q) => q.eq("userId", f.userId))
      .unique();
    if (!counts) throw new Error("Missing counts");
    await ctx.db.delete(counts._id);
  });
  const legacy = await f.measure();
  expect(legacy.result.feeds.map((f) => f.feedId)).toEqual([
    ids[0],
    ids[1],
    ids[2],
    ids[5],
  ]);
  expect(legacy.result.partial).toBe(false);
});

it("keeps the 200-source index cap before offered sort/top30, stable ties and zero-offer filtering", async () => {
  const f = await fixture();
  const ids = await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    const ids: Id<"feeds">[] = [];
    for (let i = 0; i < 201; i++) {
      const feedId = await db.insert("feeds", {
        userId: f.userId,
        title: `${i}`,
        url: `https://example.com/${i}`,
        isActive: false,
        createdAt: i,
      });
      ids.push(feedId);
      await db.insert("feedStats", {
        userId: f.userId,
        feedId,
        offered: i === 200 ? 99999 : i < 2 ? 0 : Math.floor(i / 2),
        opened: 0,
        finished: 0,
        skipped: 0,
        updatedAt: 1,
      });
    }
    return ids;
  });
  const measured = await f.measure();
  expect(measured.result.feeds.map((f) => f.feedId)).toEqual(
    Array.from({ length: 198 }, (_, n) => n + 2)
      .sort((a, b) => Math.floor(b / 2) - Math.floor(a / 2))
      .slice(0, 30)
      .map((i) => ids[i]),
  );
  expect(measured.result.partial).toBe(false);
  expect(measured.metrics.bytesWritten.used).toBe(0);
});

it("marks a byte-cut visit page partial without silently changing Topics' row-only helper", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const articleId = await metadataTriggers.wrapDB(ctx).db.insert("articles", {
      userId: f.userId,
      guid: "byte-cut",
      title: "Byte cut",
      url: "https://example.com/byte-cut",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 0,
    });
    // Valid under the native 1-MiB document cap; convex-test doesn't enforce
    // that cap. The large legacy visitId exercises a physical byte cutoff.
    for (let i = 0; i < 12; i++)
      await ctx.db.insert("readingActivity", {
        userId: f.userId,
        articleId,
        visitId: `${i}-${body}`,
        day: "2026-11-01",
        startedAt: NOW - i,
        updatedAt: NOW,
        activeTimeMs: 60_000,
        visibleTimeMs: 60_000,
        timeSpentMs: 60_000,
        maxScrollPercent: 50,
        annotationsOpened: Array.from(
          { length: 128 },
          (_, n) => `${n}-${"x".repeat(30)}`,
        ),
        estimatedReadMinutes: 5,
      });
  });
  const measured = await f.measure();
  expect(measured.result.partial).toBe(true);
  expect(measured.result.activeTimeMs).toBe(9 * 60_000);
  expect(measured.metrics.bytesRead.used).toBeGreaterThan(8 * MiB);
  expect(measured.metrics.bytesRead.used).toBeLessThan(10 * MiB);
  expect(measured.metrics.bytesWritten.used).toBe(0);
  // readingTopics still gets every one of these twelve rows, with its existing
  // array-only response. Its helper must not inherit the room's paginator.
  const { periodVisits } = await import("./stats");
  expect(
    (
      await f.t.run((ctx) =>
        periodVisits(ctx, f.userId, args.timeZone, args.period),
      )
    ).rows,
  ).toHaveLength(12);
  evidence("C06 byte-cut native", JSON.stringify(measured.metrics));
});

it("retains the full reservation until settlement and rejects queued reads before dispatch when allowance is exhausted", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    limitLegacyReadBytes(ctx, MiB);
    let settle!: (row: {
      _id: string;
      _creationTime: number;
      content: string;
    }) => void;
    const outstanding = new Promise<{
      _id: string;
      _creationTime: number;
      content: string;
    }>((resolve) => {
      settle = resolve;
    });
    const firstRead = vi.fn(() => outstanding);
    const secondRead = vi.fn(async () => null);
    const first = readLegacyDocument(ctx, firstRead);
    const second = readLegacyDocument(ctx, secondRead);
    // Attach the rejection observer before resolving the outstanding body.
    const rejected = expect(second).rejects.toThrow(/read budget/);
    await Promise.resolve();
    expect(firstRead).toHaveBeenCalledTimes(1);
    expect(secondRead).not.toHaveBeenCalled();
    settle({ _id: "fixture", _creationTime: 0, content: "small but nonzero" });
    await first;
    await rejected;
    expect(secondRead).not.toHaveBeenCalled();
  });
  await f.t.run(async (ctx) => {
    limitLegacyReadBytes(ctx, MiB - 1);
    const read = vi.fn(async () => null);
    await expect(readLegacyDocument(ctx, read)).rejects.toThrow(/read budget/);
    expect(read).not.toHaveBeenCalled();
  });
  await f.t.run(async (ctx) => {
    limitLegacyReadBytes(ctx, 0);
    const read = vi.fn(async () => null);
    await expect(readLegacyDocument(ctx, read)).rejects.toThrow(/read budget/);
    expect(read).not.toHaveBeenCalled();
  });
});
