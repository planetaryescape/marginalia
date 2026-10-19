/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { addReader } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import authSchema from "./betterAuth/schema";
import { metadataTriggers } from "./lib/metadataTriggers";
import * as reportingTagModule from "./lib/reportingTags";
import { reportingTags } from "./lib/reportingTags";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function fixture(large = false) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 10, 2, 18));
  const t = convexTest({ schema, modules, transactionLimits: true });
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("./betterAuth/**/*.ts"),
  );
  const { client, libraryId: userId } = await addReader(t, {
    email: "reporting@example.com",
  });
  const tagIds: Id<"tags">[] = [];
  // Raw fixture insertion models a pre-migration library.
  for (let start = 0; start < 305; start += 20)
    await t.run(async (ctx) => {
      for (let i = start; i < Math.min(start + 20, 305); i++)
        tagIds.push(
          await ctx.db.insert("tags", {
            userId,
            name: `Topic ${i}`,
            key: `key-${305 - i}`,
            count: i,
            status: i === 1 ? "candidate" : "active",
            aliases: large ? ["a".repeat(15_500)] : [],
            embedding: Array(1536).fill(0.125),
            createdAt: 305 - i,
          }),
        );
    });
  for (let page = 0; page < 310; page++) {
    if (
      (await client.mutation(internal.tags.migrateVocabulary, { userId })).done
    )
      break;
  }
  const articles: Id<"articles">[] = [];
  await t.run(async (ctx) => {
    for (let i = 0; i < (large ? 100 : 5); i++) {
      const articleId = await ctx.db.insert("articles", {
        userId,
        guid: `article-${i}`,
        title: `Article ${i}`,
        url: `https://example.com/${i}`,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 0,
      });
      articles.push(articleId);
      // Include the source-order cap boundary and candidates.
      for (const tagId of [tagIds[i], tagIds[299], tagIds[300], tagIds[301]])
        await ctx.db.insert("articleTags", {
          userId,
          articleId,
          tagId,
          createdAt: 0,
        });
    }
  });
  const count = large ? 1501 : 25;
  for (let start = 0; start < count; start += 100)
    await t.run(async (ctx) => {
      for (let i = start; i < Math.min(start + 100, count); i++) {
        // Both sides of the New York fall-back transition, and period edges.
        const at = Date.UTC(2026, 10, 1, 5) + i * 60_000;
        const articleId = articles[i % articles.length];
        await ctx.db.insert("readingActivity", {
          userId,
          articleId,
          visitId: `v-${i}`,
          day: "incorrect-device-zone",
          startedAt: at,
          updatedAt: at,
          activeTimeMs: 60_000,
          visibleTimeMs: 60_000,
          timeSpentMs: 60_000,
          maxScrollPercent: 50,
          annotationsOpened: large
            ? Array.from({ length: 128 }, (_, n) => `${n}-${"x".repeat(30)}`)
            : [],
          estimatedReadMinutes: 5,
        });
        await ctx.db.insert("paragraphDwell", {
          userId,
          articleId,
          visitId: `v-${i}`,
          day: "incorrect-device-zone",
          updatedAt: at,
          dwell: Object.fromEntries(
            Array.from({ length: large ? 300 : 8 }, (_, p) => [
              String(p),
              1000 + (i % 3) * 1000,
            ]),
          ),
        });
        if (i < 4)
          await ctx.db.insert("articleInteractions", {
            userId,
            articleId,
            action: i % 2 ? "finished" : "skipped",
            createdAt: at,
          });
      }
    });
  const state = await t.run((ctx) =>
    ctx.db
      .query("tagVocabularyState")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique(),
  );
  if (!state) throw new Error("Missing fixture vocabulary");
  return { t, client, userId, tagIds, state, articles };
}

it("matches canonical active source order after atomic count/status/name edits and deletes", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    await db.patch(f.tagIds[0], { count: 1000, name: "Renamed" });
    await db.patch(f.tagIds[1], { status: "active" });
    await db.patch(f.tagIds[3], { status: "candidate" });
    await db.delete(f.tagIds[4]);
  });
  await f.t.run(async (ctx) => {
    const tags = await reportingTags(ctx, f.userId);
    const canonical = await ctx.db
      .query("tags")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", f.userId).eq("status", "active"),
      )
      .take(300);
    expect([...(await tags.activeIds(300))]).toEqual(
      canonical.map((tag) => tag._id),
    );
    for (const tag of canonical.slice(0, 10))
      expect(await tags.name(tag._id)).toBe(tag.name);
    expect(await tags.name(f.tagIds[3])).toBeNull();
    expect(await tags.name(f.tagIds[4])).toBeNull();
    expect(
      await (await reportingTags(ctx, "other-reader")).name(f.tagIds[0]),
    ).toBeNull();
  });
  await f.t.run((ctx) => ctx.db.delete(f.state._id));
  await f.t.run(async (ctx) => {
    const tags = await reportingTags(ctx, f.userId);
    expect(await tags.name(f.tagIds[0])).toBe("Renamed");
    expect((await tags.activeIds(300)).size).toBe(300);
  });
});

it("keeps all four current reports identical across ready/legacy/overflow states, zones and windows", async () => {
  const f = await fixture();
  for (const timeZone of ["America/New_York", "Pacific/Auckland", "UTC"])
    for (const period of ["month", "30days", "90days"] as const) {
      const args = { timeZone, period, today: "2026-11-02" };
      const read = () =>
        Promise.all([
          f.client.query(api.stats.readingTopics, args),
          f.client.query(api.readingHabits.readingLinger, args),
          f.client.query(api.stats.readingRoom, args),
          f.client.query(api.readingHabits.readingHabits, args),
        ]);
      await f.t.run((ctx) =>
        ctx.db.patch(f.state._id, { ready: true, overflow: 0 }),
      );
      const current = await read();
      expect(current[0].length).toBeGreaterThan(0);
      expect(current[1].topics.length).toBeGreaterThan(0);
      await f.t.run((ctx) => ctx.db.patch(f.state._id, { ready: false }));
      expect(await read()).toEqual(current);
      await f.t.run((ctx) =>
        ctx.db.patch(f.state._id, { ready: true, overflow: 1 }),
      );
      expect(await read()).toEqual(current);
    }
});

it("physically bounds vector-free Topics and Linger with full visit arrays and large alias payloads", async () => {
  const f = await fixture(true);
  const headings = await f.t.run(async (ctx) => {
    const tags = await reportingTags(ctx, f.userId);
    const ids = [...(await tags.activeIds(300))];
    const names = await Promise.all(
      ids.slice(0, 30).map((id) => tags.name(id)),
    );
    return { ids, names, metrics: await ctx.meta.getTransactionMetrics() };
  });
  expect(headings.ids).toHaveLength(300);
  expect(headings.names[0]).toBe("Topic 0");
  expect(headings.metrics.bytesRead.used).toBeLessThan(1_000_000);
  console.log(
    "C06 heading-only native fixture",
    JSON.stringify(headings.metrics),
  );
  for (const endpoint of [
    api.stats.readingTopics,
    api.readingHabits.readingLinger,
  ]) {
    const read = () =>
      f.client.run(async (ctx) => {
        const result = await ctx.runQuery(endpoint, {
          timeZone: "America/New_York",
          period: "90days",
        });
        return { result, metrics: await ctx.meta.getTransactionMetrics() };
      });
    await f.t.run((ctx) => ctx.db.patch(f.state._id, { ready: false }));
    const legacy = await read();
    await f.t.run((ctx) => ctx.db.patch(f.state._id, { ready: true }));
    const factory = reportingTags;
    const serialized = vi
      .spyOn(reportingTagModule, "reportingTags")
      .mockImplementation(async (ctx, userId) => ({
        ...(await factory(ctx, userId)),
        prefetchNodes: async () => {},
      }));
    const previous = await read().finally(() => serialized.mockRestore());
    const measured = await read();
    expect(measured.result).toEqual(legacy.result);
    expect(measured.result).toEqual(previous.result);
    console.log(
      "C06 native physical fixture",
      JSON.stringify({
        legacy: legacy.metrics,
        serialized: previous.metrics,
        current: measured.metrics,
      }),
    );
    expect(measured.metrics.bytesRead.used).toBeLessThan(16 * 1024 * 1024);
    expect(measured.metrics.bytesRead.used).toBeLessThan(
      legacy.metrics.bytesRead.used,
    );
    expect(measured.metrics.bytesWritten.used).toBe(0);
  }
  // Exercise the cumulative budgets together, not isolated projection sizes:
  // 20 links/article, >20 dwell visits/article, full annotation arrays and both
  // byte-capped outcome streams. The ready path must stay below native 16 MiB.
  for (let start = 0; start < 100; start += 10)
    await f.t.run(async (ctx) => {
      for (let i = start; i < start + 10; i++) {
        const articleId = f.articles[i];
        for (let tag = 100; tag < 116; tag++)
          await ctx.db.insert("articleTags", {
            userId: f.userId,
            articleId,
            tagId: f.tagIds[tag],
            createdAt: 0,
          });
        for (let visit = 0; visit < 7; visit++)
          await ctx.db.insert("paragraphDwell", {
            userId: f.userId,
            articleId,
            visitId: `extra-${visit}`,
            day: "2026-11-01",
            updatedAt: Date.UTC(2026, 10, 1, 18),
            dwell: Object.fromEntries(
              Array.from({ length: 300 }, (_, p) => [String(p), 2000]),
            ),
          });
        for (let event = 0; event < 6; event++)
          await ctx.db.insert("articleInteractions", {
            userId: f.userId,
            articleId,
            action: event % 2 ? "finished" : "skipped",
            createdAt: Date.UTC(2026, 10, 1, 18),
            annotationsOpened: Array.from(
              { length: 128 },
              (_, n) => `${n}-${"x".repeat(30)}`,
            ),
          });
      }
    });
  const args = { timeZone: "America/New_York", period: "90days" } as const;
  const topics = await f.client.run(async (ctx) => {
    const result = await ctx.runQuery(api.stats.readingTopics, args);
    return { result, metrics: await ctx.meta.getTransactionMetrics() };
  });
  expect(topics.result.length).toBe(30);
  expect(
    topics.result.every(
      (topic) => topic.outcomesPartial && topic.skipped === 0,
    ),
  ).toBe(true);
  const linger = await f.client.run(async (ctx) => {
    const result = await ctx.runQuery(api.readingHabits.readingLinger, args);
    return { result, metrics: await ctx.meta.getTransactionMetrics() };
  });
  expect(linger.result.partial).toBe(true);
  expect(linger.result.topics.length).toBe(8);
  console.log(
    "C06 cumulative native maxima fixture",
    JSON.stringify({ topics: topics.metrics, linger: linger.metrics }),
  );
  for (const measured of [topics, linger]) {
    expect(measured.metrics.bytesRead.used).toBeLessThan(16 * 1024 * 1024);
    expect(measured.metrics.bytesWritten.used).toBe(0);
  }
});

it("overlaps only the public Linger query's first 40 small nodes and stops payloads at eight names", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    for (let i = 0; i < f.articles.length; i++)
      for (let tag = 100 + i * 16; tag < 116 + i * 16; tag++)
        await ctx.db.insert("articleTags", {
          userId: f.userId,
          articleId: f.articles[i],
          tagId: f.tagIds[tag],
          createdAt: 0,
        });
  });
  const args = { timeZone: "America/New_York", period: "90days" } as const;
  await f.t.run((ctx) => ctx.db.patch(f.state._id, { ready: false }));
  let canonical = await f.client.query(api.readingHabits.readingLinger, args);
  expect(canonical.topics).toHaveLength(8);
  // Leave a top-ranked dangling link: a missing node must be cached too, not
  // queried again by the lazy display loop after prefetch finishes.
  const first = canonical.topics[0].name;
  const deletedId = f.tagIds.find((_, i) => `Topic ${i}` === first);
  if (!deletedId) throw new Error("Missing first-ranked fixture tag");
  await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    await db.delete(deletedId);
  });
  canonical = await f.client.query(api.readingHabits.readingLinger, args);
  await f.t.run((ctx) => ctx.db.patch(f.state._id, { ready: true }));

  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstStarted = () => {};
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  let structures = 0;
  let payloads = 0;
  let canonicalGets = 0;
  const factory = reportingTags;
  vi.spyOn(reportingTagModule, "reportingTags").mockImplementation(
    async (ctx, userId) => {
      const query = ctx.db.query.bind(ctx.db);
      vi.spyOn(ctx.db, "query").mockImplementation((table) => {
        const result = query(table);
        if (table === "tagVocabulary") {
          const withIndex = result.withIndex.bind(result);
          vi.spyOn(result, "withIndex").mockImplementation((...args) => {
            const indexed = withIndex(...args);
            const unique = indexed.unique.bind(indexed);
            vi.spyOn(indexed, "unique").mockImplementation(async () => {
              structures++;
              if (structures === 1) firstStarted();
              await held;
              return unique();
            });
            return indexed;
          });
        }
        return result;
      });
      const get = ctx.db.get.bind(ctx.db);
      vi.spyOn(ctx.db, "get").mockImplementation((...args) => {
        if (args[0] === "tags") canonicalGets++;
        else payloads++;
        return get(...args);
      });
      return factory(ctx, userId);
    },
  );
  const pending = f.client.run(async (ctx) => {
    const result = await ctx.runQuery(api.readingHabits.readingLinger, args);
    return { result, metrics: await ctx.meta.getTransactionMetrics() };
  });
  await started;
  const whileHeld = { structures, payloads, canonicalGets };
  release();
  const measured = await pending;
  expect(whileHeld).toEqual({ structures: 40, payloads: 0, canonicalGets: 0 });
  expect(measured.result).toEqual(canonical);
  expect(structures).toBe(40);
  expect(payloads).toBe(8);
  expect(canonicalGets).toBe(0);
  expect(measured.metrics.bytesWritten.used).toBe(0);
  const dispatch = { structures, payloads, canonicalGets };
  for (const state of [
    { ready: false, overflow: 0 },
    { ready: true, overflow: 1 },
  ]) {
    await f.t.run((ctx) => ctx.db.patch(f.state._id, state));
    structures = payloads = canonicalGets = 0;
    const fallback = await f.client.query(
      api.readingHabits.readingLinger,
      args,
    );
    expect(fallback).toEqual(canonical);
    expect(structures).toBe(0);
    expect(payloads).toBe(0);
    // A missing tag and one candidate may be filtered; stop canonical bodies
    // lazily too, rather than hydrating all 40 vectors on an unready library.
    expect(canonicalGets).toBeGreaterThanOrEqual(8);
    expect(canonicalGets).toBeLessThanOrEqual(10);
  }
  console.log(
    "C06 held public Linger fixture",
    JSON.stringify({ dispatch, metrics: measured.metrics }),
  );
});

it("keeps public Linger names identical to serialized metadata and canonical fallbacks after edits", async () => {
  const f = await fixture();
  const args = { timeZone: "America/New_York", period: "90days" } as const;
  const read = () => f.client.query(api.readingHabits.readingLinger, args);
  const factory = reportingTags;
  const parity = async () => {
    await f.t.run((ctx) =>
      ctx.db.patch(f.state._id, { ready: true, overflow: 0 }),
    );
    const current = await read();
    // The deployed pre-followup path performs exactly the same lazy name reads,
    // without a preceding structure phase. Exercise that via the public query.
    const serialized = vi
      .spyOn(reportingTagModule, "reportingTags")
      .mockImplementation(async (ctx, userId) => ({
        ...(await factory(ctx, userId)),
        prefetchNodes: async () => {},
      }));
    try {
      expect(await read()).toEqual(current);
    } finally {
      serialized.mockRestore();
    }
    for (const state of [
      { ready: false, overflow: 0 },
      { ready: true, overflow: 1 },
    ]) {
      await f.t.run((ctx) => ctx.db.patch(f.state._id, state));
      expect(await read()).toEqual(current);
    }
    return current;
  };
  await parity();
  await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    await db.patch(f.tagIds[0], { name: "Renamed Linger topic" });
    await db.patch(f.tagIds[1], { status: "active" });
    await db.patch(f.tagIds[2], { status: "candidate" });
    await db.delete(f.tagIds[3]);
    await db.patch(f.tagIds[4], { userId: "foreign-reader" });
    // The foreign link itself must be discarded before ranking, independently
    // of the foreign-tag name fence. A deleted tag leaves a dangling own link.
    await db.insert("articleTags", {
      userId: "foreign-reader",
      articleId: f.articles[0],
      tagId: f.tagIds[200],
      createdAt: 0,
    });
  });
  const edited = await parity();
  expect(edited.topics.map((topic) => topic.name)).toContain(
    "Renamed Linger topic",
  );
  expect(edited.topics.map((topic) => topic.name)).toContain("Topic 1");
  for (const name of ["Topic 2", "Topic 3", "Topic 4", "Topic 200"])
    expect(edited.topics.map((topic) => topic.name)).not.toContain(name);

  // Incomplete/unsupported payloads must still take the old canonical fallback,
  // rather than reading every later candidate or inventing an empty name.
  await f.t.run(async (ctx) => {
    for (const [index, tagId] of [
      f.tagIds[0],
      f.tagIds[1],
      f.tagIds[299],
    ].entries()) {
      const node = await ctx.db
        .query("tagVocabulary")
        .withIndex("by_tagId", (q) => q.eq("tagId", tagId))
        .unique();
      if (!node) throw new Error("Missing fixture node");
      if (index === 0) await ctx.db.delete(node.payloadId);
      else if (index === 1)
        await ctx.db.patch(node.payloadId, { userId: "foreign-reader" });
      else await ctx.db.patch(node.payloadId, { tagId: f.tagIds[200] });
    }
  });
  expect(await parity()).toEqual(edited);
  await f.t.run((ctx) => ctx.db.delete(f.state._id));
  expect(await read()).toEqual(edited);
});
