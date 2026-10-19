/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { legacyReportingOracle } from "../test/legacyReportingOracle";
import { addReader } from "../test/owner";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import authSchema from "./betterAuth/schema";
import { articleProjection } from "./lib/articleMetadata";
import * as statsDates from "./lib/statsPeriod";
import { statsPeriod } from "./lib/statsPeriod";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const endpoints = [
  api.stats.getDashboard,
  api.stats.getDashboardOverview,
  api.stats.getArticleDetails,
  api.stats.getRecentNotes,
  api.stats.getReadingPatterns,
  api.stats.getWeeklyStats,
];

async function fixture() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("./betterAuth/**/*.ts"),
  );
  const { client, libraryId } = await addReader(t, {
    email: "legacy-stats@example.com",
  });
  const article = async (
    title = "Legacy title",
    userId = libraryId,
    projected = true,
    url = "https://example.com/legacy",
  ) =>
    t.run(async (ctx) => {
      const id = await ctx.db.insert("articles", {
        userId,
        guid: title,
        url,
        title,
        author: "Fixture author",
        content: "界".repeat(300_000),
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
      const row = await ctx.db.get(id);
      if (projected && row)
        await ctx.db.insert("articleMetadata", articleProjection(row));
      return id;
    });
  const note = (
    articleId: Id<"articles">,
    createdAt: number,
    contentPlain = "A thought",
  ) =>
    t.run((ctx) =>
      ctx.db.insert("userNotes", {
        userId: libraryId,
        articleId,
        selectedText: "A passage",
        content: "<p>draft</p>",
        contentPlain,
        createdAt,
        updatedAt: createdAt,
      }),
    );
  const visit = (
    articleId: Id<"articles">,
    startedAt: number,
    visitId = `visit-${startedAt}`,
    activeTimeMs = 60_000,
  ) =>
    t.run((ctx) =>
      ctx.db.insert("readingActivity", {
        userId: libraryId,
        articleId,
        visitId,
        day: "ignored-client-date",
        startedAt,
        updatedAt: startedAt + 1,
        activeTimeMs,
        visibleTimeMs: 90_000,
        timeSpentMs: 120_000,
        maxScrollPercent: 42,
        annotationsOpened: ["one", "one"],
      }),
    );
  return { t, client, libraryId, article, note, visit };
}

describe("retained reporting", () => {
  it.each([
    ["2026-03-29T12:34:56Z", "Europe/London"],
    ["2026-10-25T12:34:56Z", "Europe/London"],
    ["2026-11-01T12:34:56Z", "America/New_York"],
  ])("matches the deployed CPU oracle around DST at %s in %s", async (now, timeZone) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const f = await fixture();
    const id = await f.article();
    const foreign = await f.article("Foreign secret", "someone-else");
    const missing = await f.article("Deleted");
    await f.t.run(async (ctx) => {
      await ctx.db.delete(missing);
      const card = await ctx.db
        .query("articleMetadata")
        .withIndex("by_articleId", (q) => q.eq("articleId", missing))
        .unique();
      if (card) await ctx.db.delete(card._id);
    });
    const period = statsPeriod(Date.now(), timeZone, "30days");
    const times = [
      period.previousStart - 1,
      period.previousStart,
      period.previousEnd - 1,
      period.previousEnd,
      period.start - 1,
      period.start,
      Date.now(),
      period.end,
      period.end + 1,
    ];
    for (const at of times) {
      await f.visit(id, at);
      await f.note(id, at);
      await f.t.run(async (ctx) => {
        for (const visitId of [`visit-${at}`, "unmatched", undefined])
          await ctx.db.insert("articleInteractions", {
            userId: f.libraryId,
            articleId: id,
            action: "opened",
            visitId,
            createdAt: at,
          });
        await ctx.db.insert("reflections", {
          userId: f.libraryId,
          articleId: id,
          strongestPoint: "",
          weakestAssumption: "",
          credibleCounterview: "",
          questionForYou: "",
          userResponse: at % 2 ? " \n " : "Answered",
          respondedAt: at,
          createdAt: 1,
        });
      });
    }
    await f.visit(id, period.start + 10, "zero-active", 0);
    await f.t.run(async (ctx) => {
      const sessionId = await ctx.db.insert("sessions", {
        userId: f.libraryId,
        requestedMinutes: 10,
        startedAt: period.start,
        readingStatus: "completed",
      });
      for (const [createdAt, activeTimeMs, maxScrollPercent] of [
        [period.start - 1, 90_000, 120],
        [period.start, 60_000, 50],
        [period.start, Number.NaN, -1],
      ])
        await ctx.db.insert("articleInteractions", {
          userId: f.libraryId,
          articleId: id,
          sessionId,
          action: "finished",
          activeTimeMs,
          maxScrollPercent,
          createdAt,
        });
      await ctx.db.insert("articleInteractions", {
        userId: f.libraryId,
        articleId: id,
        action: "abandoned",
        timeSpentMs: 99_000,
        createdAt: period.start,
      });
      await ctx.db.insert("articleInteractions", {
        userId: f.libraryId,
        articleId: id,
        action: "skipped",
        createdAt: period.start,
      });
    });
    await f.note(id, Date.now(), " \n ");
    await f.note(foreign, Date.now(), "Foreign parent, own note");
    await f.note(missing, Date.now(), "Missing parent, own note");
    await f.visit(foreign, Date.now());
    await f.visit(missing, Date.now());
    for (const range of [undefined, "week", "7days", "30days"] as const) {
      const options = { timeZone, range };
      const report = await f.client.query(api.stats.getDashboard, options);
      const oracle = await f.t.run(async (ctx) => {
        const p = statsPeriod(Date.now(), timeZone, range);
        return legacyReportingOracle(
          await ctx.db
            .query("readingActivity")
            .withIndex("by_user_started", (q) =>
              q
                .eq("userId", f.libraryId)
                .gte("startedAt", p.previousStart)
                .lt("startedAt", p.end),
            )
            .take(5001),
          await ctx.db
            .query("articleInteractions")
            .withIndex("by_user_created", (q) =>
              q
                .eq("userId", f.libraryId)
                .gte("createdAt", p.previousStart)
                .lt("createdAt", p.end),
            )
            .take(5001),
          await ctx.db
            .query("userNotes")
            .withIndex("by_user_created", (q) =>
              q
                .eq("userId", f.libraryId)
                .gte("createdAt", p.previousStart)
                .lt("createdAt", p.end),
            )
            .take(5001),
          await ctx.db
            .query("reflections")
            .withIndex("by_user_responded", (q) =>
              q
                .eq("userId", f.libraryId)
                .gte("respondedAt", p.previousStart)
                .lt("respondedAt", p.end),
            )
            .take(5001),
          p,
        );
      });
      expect(report.thisWeek).toEqual(oracle.thisWeek);
      expect(report.lastWeek).toEqual(oracle.lastWeek);
      expect(report.daily).toEqual(oracle.daily);
      expect(
        await f.client.query(api.stats.getDashboardOverview, options),
      ).toEqual(report);
      expect(
        await f.client.query(api.stats.getArticleDetails, options),
      ).toEqual(report.articles);
      expect(await f.client.query(api.stats.getRecentNotes, options)).toEqual(
        report.recentNotes,
      );
      expect(
        (await f.client.query(api.stats.getReadingPatterns, options)).daily,
      ).toEqual(report.daily);
      expect(await f.client.query(api.stats.getWeeklyStats, options)).toEqual({
        articlesReadCount: oracle.thisWeek.articlesFinished,
        totalActiveTimeMinutes: Math.round(
          oracle.thisWeek.totalActiveTimeMs / 60_000,
        ),
        avgScrollDepth: oracle.thisWeek.avgScrollDepth,
        annotationsOpenedCount: oracle.thisWeek.annotationsOpenedCount,
      });
      expect(report.articles.map((a) => a.articleId)).toEqual([id]);
      expect(
        report.recentNotes
          .filter((n) => n.articleId !== id)
          .map((n) => n.articleTitle),
      ).toEqual(["Unavailable article", "Unavailable article"]);
    }
  });

  it("does not read unrelated large note/reflection rows or article bodies for weekly/pattern scalars", async () => {
    const f = await fixture();
    const id = await f.article();
    await f.visit(id, Date.now() - 10);
    for (let i = 0; i < 18; i++) {
      await f.note(id, Date.now() - 10, "界".repeat(300_000));
      await f.t.run((ctx) =>
        ctx.db.insert("reflections", {
          userId: f.libraryId,
          articleId: id,
          strongestPoint: "界".repeat(300_000),
          weakestAssumption: "",
          credibleCounterview: "",
          questionForYou: "",
          userResponse: "yes",
          respondedAt: Date.now() - 10,
          createdAt: 1,
        }),
      );
    }
    for (const endpoint of [
      api.stats.getWeeklyStats,
      api.stats.getReadingPatterns,
    ]) {
      const result = await f.client.run(async (ctx) => ({
        value: await ctx.runQuery(endpoint, { timeZone: "UTC" }),
        metrics: await ctx.meta.getTransactionMetrics(),
      }));
      expect(result.metrics.bytesRead.used).toBeLessThan(20_000);
      expect(result.metrics.documentsWritten.used).toBe(0);
      console.info("legacy-lazy-native", endpoint, result);
    }
    expect(await f.client.query(api.stats.getWeeklyStats, {})).toEqual({
      articlesReadCount: 0,
      totalActiveTimeMinutes: 1,
      avgScrollDepth: 42,
      annotationsOpenedCount: 1,
    });
    await expect(f.client.query(api.stats.getDashboard, {})).rejects.toThrow(
      "Read too much data",
    );
  });

  it("uses owned display cards for near-limit titles, and explicitly retains legacy/deferred fallback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    const f = await fixture();
    const ids = [];
    for (let i = 0; i < 26; i++) {
      const id = await f.article(`Title ${i}`);
      ids.push(id);
      await f.visit(id, Date.now() - 100);
    }
    const result = await f.client.run(async (ctx) => ({
      value: await ctx.runQuery(api.stats.getArticleDetails, {}),
      metrics: await ctx.meta.getTransactionMetrics(),
    }));
    expect(result.value.map((a) => a.articleId)).toEqual(ids.slice(0, 25));
    expect(result.metrics.bytesRead.used).toBeLessThan(100_000);
    expect(result.metrics.documentsWritten.used).toBe(0);
    console.info("legacy-cards-native", result.metrics);
    const legacy = await f.article("Legacy fallback", f.libraryId, false);
    const deferred = await f.article(
      "Deferred fallback",
      f.libraryId,
      true,
      `https://example.com/${"x".repeat(9000)}`,
    );
    await f.note(legacy, Date.now() - 10);
    await f.note(deferred, Date.now() - 5);
    const notes = await f.client.run(async (ctx) => ({
      value: await ctx.runQuery(api.stats.getRecentNotes, {}),
      metrics: await ctx.meta.getTransactionMetrics(),
    }));
    expect(notes.value.map((n) => n.articleTitle)).toEqual([
      "Deferred fallback",
      "Legacy fallback",
    ]);
    expect(notes.metrics.bytesRead.used).toBeGreaterThan(1_800_000);
    expect(notes.metrics.documentsWritten.used).toBe(0);
  });

  it("includes the 5,001st capped record and marks only dashboards partial", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    const f = await fixture();
    const id = await f.article();
    for (let batch = 0; batch < 10; batch++)
      await f.t.run(async (ctx) => {
        for (let i = 0; i < 500; i++)
          await ctx.db.insert("articleInteractions", {
            userId: f.libraryId,
            articleId: id,
            action: "opened",
            createdAt: Date.now() - 1,
          });
      });
    expect((await f.client.query(api.stats.getDashboard, {})).partial).toBe(
      false,
    );
    await f.t.run((ctx) =>
      ctx.db.insert("articleInteractions", {
        userId: f.libraryId,
        articleId: id,
        action: "finished",
        activeTimeMs: 60_000,
        createdAt: Date.now(),
      }),
    );
    await f.t.run((ctx) =>
      ctx.db.insert("articleInteractions", {
        userId: f.libraryId,
        articleId: id,
        action: "finished",
        activeTimeMs: 900_000,
        createdAt: Date.now(),
      }),
    );
    const report = await f.client.query(api.stats.getDashboard, {});
    expect(report.partial).toBe(true);
    expect(report.thisWeek).toMatchObject({
      totalActiveTimeMs: 60_000,
      legacyReadings: 1,
      articlesFinished: 1,
      untrackedOpens: 5000,
    });
    expect(await f.client.query(api.stats.getWeeklyStats, {})).toEqual({
      articlesReadCount: 1,
      totalActiveTimeMinutes: 1,
      avgScrollDepth: null,
      annotationsOpenedCount: 0,
    });
  });

  it("buckets each visit once rather than reformatting it for every day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    const f = await fixture();
    const id = await f.article();
    for (let i = 0; i < 80; i++) await f.visit(id, Date.now() - i * 60_000);
    const format = vi.spyOn(statsDates, "dayKey");
    const options = { timeZone: "Europe/London", range: "30days" as const };
    const result = await f.client.query(api.stats.getReadingPatterns, options);
    const queryFormats = format.mock.calls.length;
    expect(queryFormats).toBeLessThanOrEqual(82);
    format.mockClear();
    const oracle = await f.t.run(async (ctx) =>
      legacyReportingOracle(
        await ctx.db
          .query("readingActivity")
          .withIndex("by_user_started", (q) => q.eq("userId", f.libraryId))
          .take(5001),
        [],
        [],
        [],
        statsPeriod(Date.now(), options.timeZone, options.range),
      ),
    );
    const oracleFormats = format.mock.calls.length;
    expect(result.daily).toEqual(oracle.daily);
    expect(oracleFormats).toBeGreaterThan(2400);
    console.info("legacy-daily-format-work", {
      visits: 80,
      days: 30,
      queryFormats,
      oracleFormats,
    });
    format.mockClear();
    await f.client.query(api.stats.getWeeklyStats, options);
    expect(format.mock.calls.length).toBe(0);
  });

  it("keeps details/recent notes independent of unused large reflections", async () => {
    const f = await fixture();
    const id = await f.article();
    await f.visit(id, Date.now() - 10);
    await f.note(id, Date.now() - 10);
    for (let i = 0; i < 19; i++)
      await f.t.run((ctx) =>
        ctx.db.insert("reflections", {
          userId: f.libraryId,
          articleId: id,
          strongestPoint: "界".repeat(300_000),
          weakestAssumption: "",
          credibleCounterview: "",
          questionForYou: "",
          userResponse: "yes",
          respondedAt: Date.now() - 10,
          createdAt: 1,
        }),
      );
    for (const endpoint of [
      api.stats.getArticleDetails,
      api.stats.getRecentNotes,
    ]) {
      const result = await f.client.run(async (ctx) => ({
        value: await ctx.runQuery(endpoint, {}),
        metrics: await ctx.meta.getTransactionMetrics(),
      }));
      expect(result.value).toHaveLength(1);
      expect(result.metrics.bytesRead.used).toBeLessThan(10_000);
      expect(result.metrics.documentsWritten.used).toBe(0);
      console.info("legacy-small-native", endpoint, result.metrics);
    }
    await expect(f.client.query(api.stats.getDashboard, {})).rejects.toThrow(
      "Read too much data",
    );
  });

  it.each([
    "readingActivity",
    "userNotes",
    "reflections",
  ] as const)("preserves 5,001 inclusion for %s", async (table) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    const f = await fixture();
    const id = await f.article();
    for (let batch = 0; batch < 11; batch++)
      await f.t.run(async (ctx) => {
        for (let i = batch * 500; i < Math.min(5002, (batch + 1) * 500); i++) {
          if (table === "readingActivity")
            await ctx.db.insert(table, {
              userId: f.libraryId,
              articleId: id,
              visitId: `v-${i}`,
              day: "ignored",
              startedAt: Date.now(),
              updatedAt: Date.now(),
              activeTimeMs: 1,
              visibleTimeMs: 2,
              timeSpentMs: 3,
              maxScrollPercent: 10,
              annotationsOpened: [],
            });
          else if (table === "userNotes")
            await ctx.db.insert(table, {
              userId: f.libraryId,
              articleId: id,
              selectedText: "",
              content: "x",
              contentPlain: "x",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          else
            await ctx.db.insert(table, {
              userId: f.libraryId,
              articleId: id,
              strongestPoint: "",
              weakestAssumption: "",
              credibleCounterview: "",
              questionForYou: "",
              userResponse: "x",
              respondedAt: Date.now(),
              createdAt: 1,
            });
        }
      });
    const result = await f.client.run(async (ctx) => ({
      value: await ctx.runQuery(api.stats.getDashboard, {}),
      metrics: await ctx.meta.getTransactionMetrics(),
    }));
    expect(result.value.partial).toBe(true);
    expect(
      result.value.thisWeek[
        table === "readingActivity"
          ? "totalActiveTimeMs"
          : table === "userNotes"
            ? "notesTaken"
            : "reflectionsWritten"
      ],
    ).toBe(5001);
    expect(result.metrics.documentsWritten.used).toBe(0);
  });

  it("treats transferred cards and ready missing cards as unavailable without reading full sources", async () => {
    const f = await fixture();
    const transferred = await f.article("Previously mine");
    const unprojected = await f.article(
      "Ready missing card",
      f.libraryId,
      false,
    );
    const kept = await f.article(`${"k".repeat(2047)}😀`, f.libraryId);
    await f.t.run(async (ctx) => {
      const card = await ctx.db
        .query("articleMetadata")
        .withIndex("by_articleId", (q) => q.eq("articleId", transferred))
        .unique();
      if (!card) throw new Error("Missing fixture card");
      await ctx.db.patch(transferred, { userId: "other-library" });
      await ctx.db.patch(card._id, { userId: "other-library" });
      await ctx.db.insert("libraryMetadataState", {
        userId: f.libraryId,
        articlesReady: true,
        phase: "done",
        cursor: null,
      });
      // Kept/paused articles have no additional saved/feed-active access gate.
      await ctx.db.insert("savedArticles", {
        userId: f.libraryId,
        articleId: kept,
        savedAt: 1,
      });
    });
    for (const id of [transferred, unprojected, kept]) {
      await f.note(id, Date.now() - 10);
      await f.visit(id, Date.now() - 10);
    }
    const result = await f.client.run(async (ctx) => ({
      value: await ctx.runQuery(api.stats.getDashboard, {}),
      metrics: await ctx.meta.getTransactionMetrics(),
    }));
    expect(result.value.articles.map((a) => a.articleId)).toEqual([kept]);
    expect(result.value.articles[0].title).toBe("k".repeat(2047));
    expect(
      result.value.recentNotes
        .filter((n) => n.articleId !== kept)
        .map((n) => n.articleTitle),
    ).toEqual(["Unavailable article", "Unavailable article"]);
    expect(result.metrics.bytesRead.used).toBeLessThan(40_000);
    expect(result.metrics.documentsWritten.used).toBe(0);
  });

  it("keeps absent/disabled/deleting authorization fences for every retained endpoint", async () => {
    const f = await fixture();
    const disabled = await addReader(f.t, {
      email: "disabled-stats@example.com",
      status: "disabled",
    });
    const absent = await addReader(f.t, {
      email: "absent-stats@example.com",
      register: false,
    });
    await f.t.run(async (ctx) => {
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.libraryId))
        .unique();
      if (!reader) throw new Error("Missing fixture reader");
      await ctx.db.patch(reader._id, {
        status: "disabled",
        deletingAt: Date.now(),
      });
    });
    for (const endpoint of endpoints)
      for (const client of [f.t, disabled.client, absent.client, f.client])
        await expect(client.query(endpoint, {})).rejects.toThrow();
  });
});
