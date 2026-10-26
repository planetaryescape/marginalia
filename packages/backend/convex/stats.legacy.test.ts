/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { getFunctionName, type TransactionMetrics } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { legacyReportingOracle } from "../test/legacyReportingOracle";
import { addReader } from "../test/owner";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import authSchema from "./betterAuth/schema";
import { articleProjection } from "./lib/articleMetadata";
import {
  noteReportingProjection,
  reflectionReportingProjection,
} from "./lib/legacyReporting";
import { metadataTriggers } from "./lib/metadataTriggers";
import * as statsDates from "./lib/statsPeriod";
import { statsPeriod } from "./lib/statsPeriod";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
type NativeEvidence =
  | TransactionMetrics
  | { message: string; metrics: TransactionMetrics }
  | string;
function evidence(label: string, value: NativeEvidence) {
  if (process.env.LEGACY_REPORT_EVIDENCE)
    appendFileSync(
      process.env.LEGACY_REPORT_EVIDENCE,
      `${JSON.stringify({ label, value })}\n`,
    );
}
async function nativeLimit<T>(label: string, read: () => Promise<T>) {
  const error = await read().then(
    () => null,
    (error) => String(error),
  );
  if (error === null) throw new Error("Expected native read limit failure");
  expect(error).toContain("Read too much data");
  evidence(label, error);
}
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

// Test-only explicit readiness. Production activation belongs to main's
// bounded backfill + same-snapshot source/order/count equality gate.
async function reportingReady(
  f: Awaited<ReturnType<typeof fixture>>,
  ready: boolean,
  backfill = false,
) {
  await f.t.run(async (ctx) => {
    if (backfill) {
      for (const row of await ctx.db
        .query("userNotes")
        .withIndex("by_user_created", (q) => q.eq("userId", f.libraryId))
        .take(5002))
        await ctx.db.insert(
          "noteReportingMetadata",
          noteReportingProjection(row),
        );
      for (const row of await ctx.db
        .query("reflections")
        .withIndex("by_user_responded", (q) => q.eq("userId", f.libraryId))
        .take(5002))
        if (row.respondedAt !== undefined)
          await ctx.db.insert(
            "reflectionReportingMetadata",
            reflectionReportingProjection(row),
          );
    }
    for (const kind of ["notes", "reflections"] as const) {
      const old = await ctx.db
        .query("legacyReportingState")
        .withIndex("by_userId_and_kind", (q) =>
          q.eq("userId", f.libraryId).eq("kind", kind),
        )
        .unique();
      if (old) await ctx.db.patch(old._id, { ready });
      else
        await ctx.db.insert("legacyReportingState", {
          userId: f.libraryId,
          kind,
          ready,
          overflow: 0,
          cursor: null,
        });
    }
  });
}

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
    const linked = await f.note(id, Date.now(), "\u00a0A linked thought\u00a0");
    const blankLinked = await f.note(id, Date.now(), "\u00a0\n\t");
    await f.t.run(async (ctx) => {
      const annotationId = await ctx.db.insert("annotations", {
        userId: f.libraryId,
        articleId: id,
        type: "question",
        anchorText: "A passage",
        anchorStartOffset: 0,
        anchorEndOffset: 9,
        content: "Why?",
        relevanceScore: 1,
        wasViewed: false,
        wasDismissed: false,
        createdAt: 1,
      });
      await ctx.db.patch(linked, { annotationId });
      await ctx.db.patch(blankLinked, { annotationId });
    });
    await reportingReady(f, false, true);
    for (const range of [undefined, "week", "7days", "30days"] as const) {
      const options = { timeZone, range };
      await reportingReady(f, false);
      const report = await f.client.query(api.stats.getDashboard, options);
      await reportingReady(f, true);
      const projected = await f.client.query(api.stats.getDashboard, options);
      expect(projected).toEqual(report);
      evidence(
        "fixed-clock-forced-path-parity",
        JSON.stringify({
          clock: Date.now(),
          options,
          legacySha256: createHash("sha256")
            .update(JSON.stringify(report))
            .digest("hex"),
          compactSha256: createHash("sha256")
            .update(JSON.stringify(projected))
            .digest("hex"),
        }),
      );
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
      "Reporting data exceeds this request's read budget",
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
      "Reporting data exceeds this request's read budget",
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
    const period = statsPeriod(Date.now());
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
              selectedText: `passage-${i}`,
              content: "x",
              contentPlain: "x",
              createdAt:
                i < 4998
                  ? period.previousStart
                  : Date.now() - (i === 5001 ? 1 : 2),
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
    await reportingReady(f, true, true);
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
    ).toBe(table === "userNotes" ? 3 : 5001);
    if (table === "userNotes") {
      expect(result.value.lastWeek.notesTaken).toBe(4998);
      expect(result.value.recentNotes.map((n) => n.selectedText)).toEqual([
        "passage-4998",
        "passage-4999",
        "passage-5000",
      ]);
    }
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

  it("counts 18 near-990KB notes and responses using real generic hooks, hydrating only three full notes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    const f = await fixture();
    const id = await f.article();
    await f.visit(id, Date.now() - 1);
    const prose = "界".repeat(330_000);
    for (let i = 0; i < 18; i++) {
      const writer = await f.t.run(async (ctx) => {
        const { db } = metadataTriggers.wrapDB(ctx);
        await db.insert("userNotes", {
          userId: f.libraryId,
          articleId: id,
          selectedText: `passage-${i}`,
          content: "",
          contentPlain: prose,
          createdAt: Date.now() - 100 + i,
          updatedAt: 1,
        });
        await db.insert("reflections", {
          userId: f.libraryId,
          articleId: id,
          strongestPoint: "",
          weakestAssumption: "",
          credibleCounterview: "",
          questionForYou: "",
          userResponse: prose,
          respondedAt: Date.now() - 100 + i,
          createdAt: 1,
        });
        return ctx.meta.getTransactionMetrics();
      });
      if (i === 0) evidence("generic-writer-native", writer);
    }
    await reportingReady(f, true);
    for (const endpoint of endpoints) {
      const result = await f.client.run(async (ctx) => ({
        value: await ctx.runQuery(endpoint, {}),
        metrics: await ctx.meta.getTransactionMetrics(),
      }));
      expect(result.metrics.documentsWritten.used).toBe(0);
      expect(result.metrics.bytesRead.used).toBeLessThan(3_100_000);
      console.info("legacy-report-compact-native", endpoint, result.metrics);
      evidence(`compact-native:${getFunctionName(endpoint)}`, result.metrics);
    }
    const report = await f.client.query(api.stats.getDashboard, {});
    expect(report.thisWeek.notesTaken).toBe(18);
    expect(report.thisWeek.reflectionsWritten).toBe(18);
    expect(report.partial).toBe(false);
    expect(report.articles[0].notesCount).toBe(18);
    expect(
      report.recentNotes.map((n) => [n.selectedText, n.contentPlain]),
    ).toEqual([
      ["passage-17", prose],
      ["passage-16", prose],
      ["passage-15", prose],
    ]);
    await nativeLimit("old-whole-notes-native-failure", () =>
      f.t.run((ctx) =>
        ctx.db
          .query("userNotes")
          .withIndex("by_user_created", (q) => q.eq("userId", f.libraryId))
          .take(5001),
      ),
    );
    await nativeLimit("old-whole-reflections-native-failure", () =>
      f.t.run((ctx) =>
        ctx.db
          .query("reflections")
          .withIndex("by_user_responded", (q) => q.eq("userId", f.libraryId))
          .take(5001),
      ),
    );
    await reportingReady(f, false);
    await expect(f.client.query(api.stats.getDashboard, {})).rejects.toThrow(
      "Reporting data exceeds this request's read budget",
    );
  });

  it("refuses cumulative full-ID visit/event scans before native limits, including empty other sources", async () => {
    const f = await fixture();
    const id = await f.article();
    const annotationsOpened = Array.from({ length: 128 }, (_, i) =>
      `${i}`.padEnd(32, "a"),
    );
    for (let batch = 0; batch < 11; batch++)
      await f.t.run(async (ctx) => {
        for (let i = batch * 500; i < Math.min(5001, (batch + 1) * 500); i++) {
          await ctx.db.insert("readingActivity", {
            userId: f.libraryId,
            articleId: id,
            visitId: `v-${i}`,
            day: "ignored",
            startedAt: Date.now() - 1,
            updatedAt: 1,
            activeTimeMs: 1,
            visibleTimeMs: 1,
            timeSpentMs: 1,
            maxScrollPercent: 1,
            annotationsOpened,
          });
          await ctx.db.insert("articleInteractions", {
            userId: f.libraryId,
            articleId: id,
            action: "opened",
            annotationsOpened,
            createdAt: Date.now() - 1,
          });
        }
      });
    for (const endpoint of [
      api.stats.getDashboard,
      api.stats.getArticleDetails,
      api.stats.getWeeklyStats,
      api.stats.getReadingPatterns,
    ]) {
      const result = await f.client.run(async (ctx) => {
        let message = "";
        try {
          await ctx.runQuery(endpoint, {});
        } catch (error) {
          message = String(error);
        }
        return { message, metrics: await ctx.meta.getTransactionMetrics() };
      });
      expect(result.message).toContain(
        "Reporting data exceeds this request's read budget",
      );
      expect(result.metrics.bytesRead.used).toBeLessThan(13 * 1024 * 1024);
      expect(result.metrics.documentsWritten.used).toBe(0);
      console.info("legacy-report-bounded-refusal-native", endpoint, result);
      evidence(`bounded-refusal-native:${getFunctionName(endpoint)}`, result);
    }
    await nativeLimit("old-full-ID-activity-native-failure", () =>
      f.t.run((ctx) =>
        ctx.db
          .query("readingActivity")
          .withIndex("by_user_started", (q) => q.eq("userId", f.libraryId))
          .take(5001),
      ),
    );
  });

  it("charges unready note scans and unready/deferred title bodies to the SAME physical allowance", async () => {
    const f = await fixture();
    for (let i = 0; i < 9; i++) {
      const id = await f.article(`Fallback ${i}`, f.libraryId, false);
      await f.visit(id, Date.now() - 1);
      await f.note(id, Date.now() - 1, "界".repeat(330_000));
    }
    const result = await f.client.run(async (ctx) => {
      let message = "";
      try {
        await ctx.runQuery(api.stats.getArticleDetails, {});
      } catch (error) {
        message = String(error);
      }
      return { message, metrics: await ctx.meta.getTransactionMetrics() };
    });
    expect(result.message).toContain(
      "Reporting data exceeds this request's read budget",
    );
    expect(result.metrics.bytesRead.used).toBeGreaterThan(10 * 1024 * 1024);
    expect(result.metrics.bytesRead.used).toBeLessThan(13 * 1024 * 1024);
    expect(result.metrics.documentsWritten.used).toBe(0);
    evidence("source-plus-title-shared-native", result);
  });

  it("uses exact legacy fallback for overflow/unready metadata and refuses missing/foreign ready prose", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    const f = await fixture();
    const id = await f.article();
    const noteId = await f.note(id, Date.now() - 1, "An exact thought");
    await reportingReady(f, false, true);
    const legacy = await f.client.query(api.stats.getDashboard, {});
    await f.t.run(async (ctx) => {
      for (const state of await ctx.db
        .query("legacyReportingState")
        .withIndex("by_userId", (q) => q.eq("userId", f.libraryId))
        .collect())
        await ctx.db.patch(state._id, { ready: true, overflow: 1 });
    });
    expect(await f.client.query(api.stats.getDashboard, {})).toEqual(legacy);
    await f.t.run(async (ctx) => {
      for (const state of await ctx.db
        .query("legacyReportingState")
        .withIndex("by_userId", (q) => q.eq("userId", f.libraryId))
        .collect())
        await ctx.db.patch(state._id, { overflow: 0 });
      // Deliberately corrupt the fixture outside generic hooks to exercise the
      // authority guard. Production generic ownership moves replace metadata.
      await ctx.db.patch(noteId, {
        userId: "foreign-library",
        contentPlain: "private",
      });
    });
    await expect(f.client.query(api.stats.getRecentNotes, {})).rejects.toThrow(
      "Reporting note metadata is incomplete",
    );
    await f.t.run((ctx) => ctx.db.delete(noteId));
    await expect(f.client.query(api.stats.getRecentNotes, {})).rejects.toThrow(
      "Reporting note metadata is incomplete",
    );
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
