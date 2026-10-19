/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { metadataContext } from "../test/metadata";
import { addReader, ownerTest, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import authSchema from "./betterAuth/schema";
import {
  initializeEmptyFeedStatus,
  purgeFeedStatus,
  statusTitle,
  syncFeedStatus,
} from "./lib/feedStatus";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const feed = (userId = "default_user", title = "Example") => ({
  userId,
  title,
  url: `https://example.com/${title}`,
  isActive: true,
  createdAt: 1,
});

async function migrate(
  t: Pick<ReturnType<typeof convexTest>, "mutation">,
  userId = "default_user",
) {
  for (let i = 0; i < 100; i++) {
    const result = await t.mutation(internal.feedStatus.backfill, { userId });
    if (result.complete || result.inactive) return result;
  }
  throw new Error("Fixture migration exceeded 100 pages");
}

describe("compact source status", () => {
  it("initializes only proven-empty active registrations, not populated, disabled, absent or unready libraries", async () => {
    const f = await secondReaderTest(modules);
    expect(
      await f.t.run((ctx) => initializeEmptyFeedStatus(ctx, f.readerLibraryId)),
    ).toBe(true);
    expect(await f.reader.query(api.feedStatus.status, {})).toEqual({
      ready: true,
      total: 0,
      failed: 0,
      failingTitle: null,
    });
    await f.t.run((ctx) => ctx.db.insert("feeds", feed()));
    expect(
      await f.t.run((ctx) => initializeEmptyFeedStatus(ctx, "default_user")),
    ).toBe(false);
    expect(
      await f.t.run((ctx) => initializeEmptyFeedStatus(ctx, "absent-library")),
    ).toBe(false);
    const disabled = await addReader(f.t, {
      email: "disabled-status@example.com",
      status: "disabled",
    });
    expect(
      await f.t.run((ctx) =>
        initializeEmptyFeedStatus(ctx, disabled.libraryId),
      ),
    ).toBe(false);
    const unready = await addReader(f.t, {
      email: "unready-status@example.com",
    });
    const id = await f.t.run((ctx) =>
      metadataContext(ctx).db.insert("feeds", feed(unready.libraryId)),
    );
    await f.t.run((ctx) => metadataContext(ctx).db.delete(id));
    expect(
      await f.t.run((ctx) => initializeEmptyFeedStatus(ctx, unready.libraryId)),
    ).toBe(false);
    expect(await unready.client.query(api.feedStatus.status, {})).toMatchObject(
      { ready: false, total: null },
    );
  });

  it("bounds generic writer amplification and does not rewrite counters for unrelated fields or title-only changes", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    await migrate(t);
    const inserted = await t.run(async (raw) => {
      const id = await metadataContext(raw).db.insert("feeds", {
        ...feed(),
        description: "x".repeat(990_000),
      });
      return { id, metrics: await raw.meta.getTransactionMetrics() };
    });
    expect(inserted.metrics.documentsWritten.used).toBe(3);
    const unchanged = await t.run(async (raw) => {
      await metadataContext(raw).db.patch(inserted.id, { lastFetchedAt: 42 });
      return raw.meta.getTransactionMetrics();
    });
    expect(unchanged.documentsWritten.used).toBe(1);
    const renamed = await t.run(async (raw) => {
      await metadataContext(raw).db.patch(inserted.id, {
        title: "Changed title",
      });
      return raw.meta.getTransactionMetrics();
    });
    expect(renamed.documentsWritten.used).toBe(2);
    const failed = await t.run(async (raw) => {
      await metadataContext(raw).db.patch(inserted.id, { lastError: "failed" });
      return raw.meta.getTransactionMetrics();
    });
    expect(failed.documentsWritten.used).toBe(3);
    expect(failed.bytesRead.used).toBeLessThan(4_000_000);
  });

  it("never invents readiness, including writes into populated legacy libraries", async () => {
    const t = await ownerTest(modules);
    await t.run((ctx) =>
      ctx.db.insert("feeds", { ...feed(), lastError: "legacy failure" }),
    );
    expect(await t.query(api.feedStatus.status, {})).toEqual({
      ready: false,
      total: null,
      failed: null,
      failingTitle: null,
    });
    await t.run((ctx) =>
      metadataContext(ctx).db.insert("feeds", feed("default_user", "new")),
    );
    expect(await t.query(api.feedStatus.status, {})).toMatchObject({
      ready: false,
      total: null,
    });
    await migrate(t);
    expect(await t.query(api.feedStatus.status, {})).toEqual({
      ready: true,
      total: 2,
      failed: 1,
      failingTitle: "Example",
    });
    await migrate(t);
    expect(await t.query(api.feedStatus.status, {})).toMatchObject({
      total: 2,
      failed: 1,
    });
  });

  it("counts zero/one/many and truthy errors even on paused feeds; generic replace/title/toggle/URL/error clear are atomic", async () => {
    const t = await ownerTest(modules);
    await migrate(t);
    expect(await t.query(api.feedStatus.status, {})).toMatchObject({
      ready: true,
      total: 0,
      failed: 0,
    });
    const a = await t.run((ctx) =>
      metadataContext(ctx).db.insert("feeds", {
        ...feed(),
        isActive: false,
        lastError: " ",
      }),
    );
    const b = await t.run((ctx) =>
      metadataContext(ctx).db.insert("feeds", {
        ...feed("default_user", "Other"),
        lastError: "",
      }),
    );
    expect(await t.query(api.feedStatus.status, {})).toMatchObject({
      total: 2,
      failed: 1,
      failingTitle: "Example",
    });
    await t.run((ctx) =>
      metadataContext(ctx).db.replace(a, {
        ...feed("default_user", "Renamed"),
        url: "https://renamed.example",
        lastError: "404",
      }),
    );
    expect(await t.query(api.feedStatus.status, {})).toMatchObject({
      total: 2,
      failed: 1,
      failingTitle: "Renamed",
    });
    await t.run(async (ctx) => {
      const db = metadataContext(ctx).db;
      await db.patch(b, { lastError: "second" });
      await db.patch(b, { lastError: "second" });
    });
    expect(await t.query(api.feedStatus.status, {})).toMatchObject({
      total: 2,
      failed: 2,
      failingTitle: null,
    });
    await t.run((ctx) =>
      metadataContext(ctx).db.patch(a, {
        lastError: undefined,
        isActive: false,
      }),
    );
    expect(await t.query(api.feedStatus.status, {})).toMatchObject({
      failed: 1,
      failingTitle: "Other",
    });
    await t.run((ctx) => metadataContext(ctx).db.delete(b));
    expect(await t.query(api.feedStatus.status, {})).toMatchObject({
      total: 1,
      failed: 0,
    });
  });

  it("resumes migration with insert/delete/error/title/owner changes on both sides of its cursor without duplicate contributions", async () => {
    const f = await secondReaderTest(modules);
    const ids: Id<"feeds">[] = [];
    for (let i = 0; i < 13; i++)
      ids.push(
        await f.t.run((ctx) =>
          ctx.db.insert("feeds", {
            ...feed("default_user", `Feed ${i}`),
            lastError: i % 2 ? "failed" : undefined,
          }),
        ),
      );
    expect(
      await f.t.mutation(internal.feedStatus.backfill, {
        userId: "default_user",
      }),
    ).toMatchObject({ complete: false });
    await f.t.run(async (ctx) => {
      const db = metadataContext(ctx).db;
      await db.delete(ids[0]);
      await db.delete(ids[11]);
      await db.patch(ids[1], { lastError: undefined });
      await db.patch(ids[10], {
        lastError: "new failure",
        title: "changed ahead",
      });
      await db.patch(ids[2], {
        userId: f.readerLibraryId,
        lastError: "moved behind",
      });
      await db.patch(ids[12], { userId: f.readerLibraryId });
      await db.insert("feeds", {
        ...feed("default_user", "New tail"),
        lastError: "new",
      });
    });
    await migrate(f.t);
    await migrate(f.t, f.readerLibraryId);
    const expected = await f.t.run((ctx) =>
      ctx.db
        .query("feeds")
        .withIndex("by_user", (q) => q.eq("userId", "default_user"))
        .collect(),
    );
    expect(await f.owner.query(api.feedStatus.status, {})).toEqual({
      ready: true,
      total: expected.length,
      failed: expected.filter((f) => f.lastError).length,
      failingTitle: null,
    });
    expect(await f.reader.query(api.feedStatus.status, {})).toMatchObject({
      total: 2,
      failed: 1,
      failingTitle: "Feed 2",
    });
    await migrate(f.t);
    expect(await f.owner.query(api.feedStatus.status, {})).toMatchObject({
      total: 10,
      failed: 6,
    });
  });

  it("isolates readers, retains disabled libraries, refuses absent/deleting resurrection and purges in positive bounded batches", async () => {
    const f = await secondReaderTest(modules);
    await migrate(f.t, f.readerLibraryId);
    const id = await f.t.run((ctx) =>
      metadataContext(ctx).db.insert("feeds", {
        ...feed(f.readerLibraryId),
        lastError: "failed",
      }),
    );
    await f.t.run(async (ctx) => {
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.readerLibraryId))
        .unique();
      if (!reader) throw new Error("Missing fixture reader");
      await ctx.db.patch(reader._id, { status: "disabled" });
      await metadataContext(ctx).db.patch(id, { title: "Disabled retained" });
    });
    expect(
      await f.t.run((ctx) => ctx.db.query("feedStatusEntries").first()),
    ).toMatchObject({ title: "Disabled retained" });
    await expect(
      f.t.run((ctx) => purgeFeedStatus(ctx, f.readerLibraryId)),
    ).rejects.toThrow("retained");
    await expect(f.reader.query(api.feedStatus.status, {})).rejects.toThrow();
    await migrate(f.t);
    expect(await f.owner.query(api.feedStatus.status, {})).toMatchObject({
      total: 0,
      failed: 0,
    });
    await f.t.run(async (ctx) => {
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.readerLibraryId))
        .unique();
      if (!reader) throw new Error("Missing fixture reader");
      await ctx.db.patch(reader._id, { deletingAt: 1 });
    });
    expect(
      await f.t.mutation(internal.feedStatus.backfill, {
        userId: f.readerLibraryId,
      }),
    ).toMatchObject({ inactive: true });
    expect(
      await f.t.run((ctx) => purgeFeedStatus(ctx, f.readerLibraryId)),
    ).toBe(1);
    expect(
      await f.t.run((ctx) => purgeFeedStatus(ctx, f.readerLibraryId)),
    ).toBe(1);
    expect(
      await f.t.run((ctx) => purgeFeedStatus(ctx, f.readerLibraryId)),
    ).toBe(0);
    await f.t.run(async (ctx) => {
      await metadataContext(ctx).db.patch(id, { lastError: "late" });
      await metadataContext(ctx).db.insert("feeds", feed("absent-reader"));
    });
    expect(
      await f.t.run((ctx) => ctx.db.query("feedStatusEntries").collect()),
    ).toEqual([]);
    expect(
      await f.t.run((ctx) =>
        ctx.db
          .query("feedStatusCounts")
          .withIndex("by_userId", (q) => q.eq("userId", f.readerLibraryId))
          .unique(),
      ),
    ).toBeNull();
  });

  it("serves ready status from at most two small rows under 32 KiB when even one feed cannot fit", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { bytesRead: 32 * 1024 },
    });
    t.registerComponent(
      "betterAuth",
      authSchema,
      import.meta.glob("./betterAuth/**/*.ts"),
    );
    const { client, libraryId } = await addReader(t, {
      email: "status-bytes@example.com",
    });
    for (let i = 0; i < 24; i++)
      await t.run(async (ctx) => {
        const fields = {
          ...feed(libraryId, i === 0 ? "😀".repeat(2200) : `Feed ${i}`),
          description: "x".repeat(950_000),
          lastError: i === 0 ? "failure" : undefined,
        };
        const id = await ctx.db.insert("feeds", fields);
        await syncFeedStatus(ctx, null, {
          ...fields,
          _id: id,
          _creationTime: i,
        });
      });
    // This tiny-budget fixture cannot scan legacy sources; seed readiness ONLY
    // after every known fixture contribution is installed. Real backfill tested below.
    await t.run(async (ctx) => {
      const counts = await ctx.db
        .query("feedStatusCounts")
        .withIndex("by_userId", (q) => q.eq("userId", libraryId))
        .unique();
      if (!counts) throw new Error("Missing fixture counts");
      await ctx.db.patch(counts._id, { ready: true });
    });
    const result = await client.run(async (ctx) => {
      const value = await ctx.runQuery(api.feedStatus.status, {});
      return { value, metrics: await ctx.meta.getTransactionMetrics() };
    });
    expect(result.value).toMatchObject({
      total: 24,
      failed: 1,
      failingTitle: `${"😀".repeat(2048)}…`,
    });
    expect(result.metrics.bytesRead.used).toBeLessThan(32 * 1024);
    await expect(client.query(api.feeds.list, {})).rejects.toThrow(
      "Read too much data",
    );
    console.info(
      "compact-source-status-ready-bytes",
      result.metrics.bytesRead.used,
    );
  });

  it("migrates near-limit feed rows with all installed generic handlers under enforced transaction limits", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const ids: Id<"feeds">[] = [];
    for (let i = 0; i < 18; i++)
      ids.push(
        await t.run((ctx) =>
          ctx.db.insert("feeds", {
            ...feed("default_user", `Large ${i}`),
            description: "x".repeat(990_000),
            lastError: i === 5 ? "failure" : undefined,
          }),
        ),
      );
    let pages = 0;
    for (; pages < 20; pages++) {
      const result = await t.run(async (ctx) => {
        const value = await ctx.runMutation(internal.feedStatus.backfill, {
          userId: "default_user",
        });
        return { value, metrics: await ctx.meta.getTransactionMetrics() };
      });
      expect(result.metrics.bytesRead.used).toBeLessThan(6_000_000);
      if (result.value.complete) break;
    }
    expect(pages).toBeLessThan(20);
    await t.run((ctx) =>
      metadataContext(ctx).db.patch(ids[5], {
        title: "Updated large failure",
        isActive: false,
      }),
    );
    const before = await t.run((ctx) => ctx.db.get(ids[5]));
    if (!before) throw new Error("Missing fixture source");
    await t.run((ctx) => syncFeedStatus(ctx, before, before));
    expect(
      await t.run((ctx) => ctx.db.query("feedStatusCounts").first()),
    ).toMatchObject({ ready: true, total: 18, failed: 1 });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("feedStatusEntries")
          .withIndex("by_feedId", (q) => q.eq("feedId", ids[5]))
          .unique(),
      ),
    ).toMatchObject({ title: "Updated large failure", failed: true });
  });

  it("caps Unicode titles visibly without splitting scalars", () => {
    expect(statusTitle("a normal title")).toBe("a normal title");
    expect(statusTitle("😀".repeat(2048))).toBe("😀".repeat(2048));
    expect(statusTitle("😀".repeat(2049))).toBe(`${"😀".repeat(2048)}…`);
  });

  it("keeps four started network reservations across status changes, pause, owner move and deletion", async () => {
    const f = await secondReaderTest(modules);
    const ids: Id<"feeds">[] = [];
    for (let i = 0; i < 4; i++)
      ids.push(
        await f.t.run((ctx) =>
          metadataContext(ctx).db.insert(
            "feeds",
            feed("default_user", `Slot ${i}`),
          ),
        ),
      );
    const original = await f.t.run(async (ctx) => {
      const runId = await ctx.db.insert("feedPollRuns", {
        userId: "default_user",
        run: 1,
        active: true,
        scanned: 4,
        exhausted: true,
        deadline: Date.now() + 60_000,
      });
      const slots = [];
      for (const feedId of ids) {
        const stateId = await ctx.db.insert("feedPollStates", {
          userId: "default_user",
          feedId,
          url: "https://example.com",
          run: 1,
          generation: 1,
          attempts: 1,
          nextBatch: 0,
          started: true,
        });
        slots.push({
          stateId,
          generation: 1,
          runId,
          run: 1,
          started: true,
          leaseUntil: Date.now() + 60_000,
        });
      }
      await ctx.db.insert("feedPollPool", { key: "global", slots });
      return slots;
    });
    await f.t.run(async (ctx) => {
      const db = metadataContext(ctx).db;
      await db.patch(ids[0], { title: "Renamed", lastError: "error" });
      await db.patch(ids[1], { isActive: false });
      await db.patch(ids[2], { userId: f.readerLibraryId });
      await db.delete(ids[3]);
    });
    expect(
      (await f.t.run((ctx) => ctx.db.query("feedPollPool").unique()))?.slots,
    ).toEqual(original);
  });

  it("account deletion drains large sources and compact metadata without a second paginator or late resurrection", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest({ schema, modules, transactionLimits: true });
      t.registerComponent(
        "betterAuth",
        authSchema,
        import.meta.glob("./betterAuth/**/*.ts"),
      );
      const { client, libraryId } = await addReader(t, {
        email: "status-delete@example.com",
      });
      for (let i = 0; i < 18; i++)
        await t.run((ctx) =>
          metadataContext(ctx).db.insert("feeds", {
            ...feed(libraryId, `Delete ${i}`),
            description: "x".repeat(990_000),
            lastError: i === 0 ? "failure" : undefined,
          }),
        );
      await migrate(t, libraryId);
      await client.mutation(api.account.deleteMine, { confirmation: "DELETE" });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      for (const table of [
        "feeds",
        "feedStatusEntries",
        "feedStatusCounts",
        "readers",
      ] as const)
        expect(await t.run((ctx) => ctx.db.query(table).take(1))).toHaveLength(
          0,
        );
      await t.run((ctx) =>
        metadataContext(ctx).db.insert(
          "feeds",
          feed(libraryId, "Late publication"),
        ),
      );
      expect(
        await t.run((ctx) => ctx.db.query("feedStatusCounts").take(1)),
      ).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
