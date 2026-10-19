/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { addReader } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import authSchema from "./betterAuth/schema";
import { metadataTriggers } from "./lib/metadataTriggers";
import { reportingTags } from "./lib/reportingTags";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());

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
    const measured = await read();
    expect(measured.result).toEqual(legacy.result);
    console.log(
      "C06 native physical fixture",
      JSON.stringify({ legacy: legacy.metrics, current: measured.metrics }),
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
