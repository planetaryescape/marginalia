/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadataContext } from "../test/metadata";
import { secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;
const zero = {
  annotated: 0,
  waiting: 0,
  pending: 0,
  fits5: 0,
  fits10: 0,
  fits20: 0,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function legacyFixture(size = 13) {
  const f = await secondReaderTest(modules);
  const ids = await f.t.run(async (ctx) => {
    const ids = [];
    for (let i = 0; i < size; i++)
      ids.push(
        await ctx.db.insert("articles", {
          userId: f.readerLibraryId,
          guid: `old-${i}`,
          url: `https://example.com/${i}`,
          title: `Old ${i}`,
          content: "Synthetic extracted text",
          extractionStatus: "extracted",
          annotationStatus: "skipped",
          skipReason: "no_provider",
          estimatedReadMinutes: [3, 8, 18][i % 3],
          queueCounted: true,
          createdAt: i,
        }),
      );
    await ctx.db.insert("readingQueueStats", {
      userId: f.readerLibraryId,
      ...zero,
      ready: true,
      cursor: "old-completed-cursor",
    });
    return ids;
  });
  return { ...f, ids };
}

async function finish(f: Fixture) {
  for (let i = 0; i < 500; i++) {
    await f.t.mutation(internal.readingQueue.initialize, {
      userId: f.readerLibraryId,
    });
    const stats = await f.t.run((ctx) =>
      ctx.db
        .query("readableQueueStats")
        .withIndex("by_user", (q) => q.eq("userId", f.readerLibraryId))
        .unique(),
    );
    if (stats?.ready) return;
  }
  throw new Error("Migration did not finish");
}

// Independent full-fixture oracle; no production policy or receipts in expected values.
function expected(rows: Doc<"articles">[]) {
  const counts = { ...zero };
  for (const a of rows) {
    if (a.annotationStatus === "pending") counts.pending++;
    if (
      a.extractionStatus !== "extracted" ||
      !a.content ||
      a.bookUnitCount !== undefined ||
      !["annotated", "deferred", "skipped"].includes(a.annotationStatus)
    )
      continue;
    counts.annotated++;
    if (a.finishedAt !== undefined) continue;
    counts.waiting++;
    if ((a.estimatedReadMinutes ?? Infinity) <= 5) counts.fits5++;
    if ((a.estimatedReadMinutes ?? Infinity) <= 10) counts.fits10++;
    if ((a.estimatedReadMinutes ?? Infinity) <= 20) counts.fits20++;
  }
  return counts;
}
async function assertCounts(f: Fixture) {
  const { rows, stats } = await f.t.run(async (ctx) => ({
    rows: await ctx.db
      .query("articles")
      .withIndex("by_user", (q) => q.eq("userId", f.readerLibraryId))
      .collect(),
    stats: await ctx.db
      .query("readableQueueStats")
      .withIndex("by_user", (q) => q.eq("userId", f.readerLibraryId))
      .unique(),
  }));
  expect(stats).toMatchObject({ ...expected(rows), ready: true });
  const overview = await f.reader.query(api.home.counts, {});
  expect(overview).toMatchObject({
    countsReady: true,
    waiting: expected(rows).waiting,
    fits: {
      5: expected(rows).fits5,
      10: expected(rows).fits10,
      20: expected(rows).fits20,
    },
  });
}

describe("readable queue receipts and the legacy baseline", () => {
  it("upgrades already-counted ready libraries in bounded pages, resumes and tolerates duplicate invocations", async () => {
    const f = await legacyFixture();
    await f.t.mutation(internal.readingQueue.initialize, {
      userId: f.readerLibraryId,
    });
    const receipts = await f.t.run(async (ctx) =>
      ctx.db.query("readableQueueEntries").take(30),
    );
    expect(receipts).toHaveLength(4);
    expect(await f.reader.query(api.home.counts, {})).toMatchObject({
      countsReady: false,
      waiting: null,
    });
    await Promise.all([finish(f), finish(f)]);
    await assertCounts(f);
    const before = await f.t.run((ctx) =>
      ctx.db.query("readableQueueStats").first(),
    );
    await finish(f);
    expect(
      await f.t.run((ctx) => ctx.db.query("readableQueueStats").first()),
    ).toEqual(before);
    expect(
      await f.t.run((ctx) => ctx.db.query("readingQueueStats").first()),
    ).toMatchObject({ ...zero, ready: true, cursor: "old-completed-cursor" });
  });

  it.each([
    false,
    true,
  ])("archive, restore, finish, status and length writes racing the scan (scan first=%s)", async (scanFirst) => {
    const f = await legacyFixture();
    if (scanFirst)
      await f.t.mutation(internal.readingQueue.initialize, {
        userId: f.readerLibraryId,
      });
    // Choose both a row in the first page and a row not scanned yet.
    for (const articleId of [f.ids[0], f.ids[12]]) {
      await f.reader.mutation(api.articles.archive, { articleId });
      await f.reader.mutation(api.articles.restore, { articleId });
      await f.t.mutation(internal.articles.updateAnnotationStatus, {
        articleId,
        status: "pending",
      });
      await f.t.mutation(internal.articles.updateAnnotationStatus, {
        articleId,
        status: "annotated",
      });
      await f.t.mutation(internal.articles.updateExtracted, {
        articleId,
        content: "Changed synthetic text",
        contentHtml: "<p>Changed synthetic text</p>",
        excerpt: "Changed",
        wordCount: 1500,
        estimatedReadMinutes: 9,
      });
    }
    await f.reader.mutation(api.sessions.recordInteraction, {
      articleId: f.ids[1],
      action: "finished",
    });
    await f.reader.mutation(api.sessions.recordInteraction, {
      articleId: f.ids[1],
      action: "finished",
    });
    // Delete on each side of the cursor through the real registered trigger.
    await f.t.run(async (ctx) => {
      const db = metadataContext(ctx).db;
      await db.delete(f.ids[2]);
      await db.delete(f.ids[11]);
    });
    await finish(f);
    await assertCounts(f);
    for (const articleId of [f.ids[0], f.ids[12]])
      await f.reader.mutation(api.articles.archive, { articleId });
    await assertCounts(f);
    for (const articleId of [f.ids[0], f.ids[12]])
      await f.reader.mutation(api.articles.restore, { articleId });
    await assertCounts(f);
  });

  it("counts a late commit behind the cursor exactly once and rolls back counter/receipt writes together", async () => {
    vi.useFakeTimers();
    const f = await legacyFixture();
    await f.t.mutation(internal.readingQueue.initialize, {
      userId: f.readerLibraryId,
    });
    vi.setSystemTime(Date.now() - 100_000);
    const input = {
      userId: f.readerLibraryId,
      guid: "late",
      url: "https://example.com/late",
      title: "Late",
      content: "Readable",
      contentHtml: "<p>Readable</p>",
      excerpt: "Readable",
      wordCount: 1,
      estimatedReadMinutes: 4,
    };
    await expect(
      f.t.run(async (ctx) => {
        await ctx.runMutation(internal.articles.insertExtracted, input);
        throw new Error("synthetic rollback");
      }),
    ).rejects.toThrow("synthetic rollback");
    const articleId = await f.t.mutation(
      internal.articles.insertExtracted,
      input,
    );
    await f.t.mutation(internal.articles.updateAnnotationStatus, {
      articleId,
      status: "skipped",
      skipReason: "no_provider",
    });
    await finish(f);
    await assertCounts(f);
  });

  it("rebuilds from a fresh generation after legacy-only rollback writes, including lost deletes", async () => {
    const f = await legacyFixture();
    await finish(f);
    // Simulate code without the new trigger, while preserving additive schema.
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.ids[0], { finishedAt: 123 });
      await ctx.db.delete(f.ids[1]);
      await ctx.db.patch(f.ids[2], {
        annotationStatus: "annotated",
        estimatedReadMinutes: 1,
      });
    });
    await f.t.mutation(internal.readingQueue.rebuildReadable, {
      userId: f.readerLibraryId,
    });
    await f.t.mutation(internal.readingQueue.initialize, {
      userId: f.readerLibraryId,
    });
    // Restart mid-page: receipts in the previous generation must not subtract.
    await f.t.mutation(internal.readingQueue.rebuildReadable, {
      userId: f.readerLibraryId,
    });
    await f.reader.mutation(api.articles.restore, { articleId: f.ids[0] });
    await finish(f);
    await assertCounts(f);
    expect(
      await f.t.run((ctx) => ctx.db.query("readableQueueStats").first()),
    ).toMatchObject({ generation: 3 });
  });

  it("initializes more than 1000 existing no-provider rows without reimport or status changes", async () => {
    const f = await legacyFixture(1003);
    await finish(f);
    await assertCounts(f);
    const rows = await f.t.run((ctx) => ctx.db.query("articles").take(1100));
    expect(
      rows.every(
        (a) =>
          a.annotationStatus === "skipped" && a.skipReason === "no_provider",
      ),
    ).toBe(true);
    expect((await f.reader.query(api.home.overview, {})).upNext).toHaveLength(
      10,
    );
  });

  it("does not declare a partly scanned legacy generation complete after a rebuild", async () => {
    const f = await legacyFixture();
    await f.t.run(async (ctx) => {
      const old = await ctx.db.query("readingQueueStats").first();
      if (!old) throw new Error("Missing baseline");
      await ctx.db.patch(old._id, { ready: false, cursor: undefined });
    });
    await f.t.mutation(internal.readingQueue.initialize, {
      userId: f.readerLibraryId,
    });
    await f.t.mutation(internal.readingQueue.rebuildReadable, {
      userId: f.readerLibraryId,
    });
    await finish(f);
    await assertCounts(f);
  });

  it("keeps mixed legacy contributions intact and rolls a failed page back before retry", async () => {
    const f = await legacyFixture(7);
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.ids[0], { annotationStatus: "annotated" });
      await ctx.db.patch(f.ids[1], {
        annotationStatus: "deferred",
        finishedAt: 0,
      });
      await ctx.db.patch(f.ids[2], { annotationStatus: "pending" });
      const stats = await ctx.db.query("readingQueueStats").first();
      if (!stats) throw new Error("Missing old baseline");
      await ctx.db.patch(stats._id, {
        annotated: 2,
        waiting: 1,
        pending: 1,
        fits5: 1,
        fits10: 1,
        fits20: 1,
      });
    });
    const old = await f.t.run((ctx) =>
      ctx.db.query("readingQueueStats").first(),
    );
    await expect(
      f.t.run(async (ctx) => {
        await ctx.runMutation(internal.readingQueue.initialize, {
          userId: f.readerLibraryId,
        });
        throw new Error("page failed before commit");
      }),
    ).rejects.toThrow("page failed before commit");
    expect(
      await f.t.run((ctx) => ctx.db.query("readableQueueEntries").take(10)),
    ).toEqual([]);
    expect(
      await f.t.run((ctx) => ctx.db.query("readableQueueStats").first()),
    ).toBeNull();
    await finish(f);
    await assertCounts(f);
    expect(
      await f.t.run((ctx) => ctx.db.query("readingQueueStats").first()),
    ).toEqual(old);
    const jobs = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(100),
    );
    expect(jobs.every((job) => job.name === "readingQueue:initialize")).toBe(
      true,
    );
  });

  it("keeps the legacy overview readable while its first migrated page contributes zero", async () => {
    const f = await legacyFixture();
    await f.t.run(async (ctx) => {
      for (const id of f.ids.slice(0, 4))
        await ctx.db.patch(id, { content: undefined });
    });
    await f.t.mutation(internal.readingQueue.initialize, {
      userId: f.readerLibraryId,
    });
    const overview = await f.reader.query(api.home.overview, {});
    expect(overview).toMatchObject({
      countsReady: false,
      annotatedTotal: 9,
      waiting: null,
    });
    expect(overview.upNext).toHaveLength(9);
    await finish(f);
    await assertCounts(f);
  });

  it("retains counters across disabled-reader writes and never creates them for deleting libraries", async () => {
    const f = await legacyFixture();
    await finish(f);
    const readerId = await f.t.run(async (ctx) => {
      const row = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.readerLibraryId))
        .unique();
      if (!row) throw new Error("Missing synthetic reader");
      await ctx.db.patch(row._id, { status: "disabled" });
      await metadataContext(ctx).db.patch(f.ids[0], { finishedAt: 12 });
      await ctx.db.patch(row._id, { status: "active" });
      return row._id;
    });
    await assertCounts(f);
    const before = await f.t.run((ctx) =>
      ctx.db.query("readableQueueStats").first(),
    );
    await f.t.run(async (ctx) => {
      await ctx.db.patch(readerId, { deletingAt: Date.now() });
      await metadataContext(ctx).db.patch(f.ids[1], { finishedAt: 13 });
    });
    await f.t.mutation(internal.readingQueue.rebuildReadable, {
      userId: f.readerLibraryId,
    });
    expect(
      await f.t.run((ctx) => ctx.db.query("readableQueueStats").first()),
    ).toEqual(before);
  });
});
