/// <reference types="vite/client" />

import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());

describe("reading statistics", () => {
  it("doesn't sum cumulative legacy snapshots for the same session or invent missing time", async () => {
    const t = await ownerTest(modules);
    await t.run(async (ctx) => {
      const articleId = await ctx.db.insert("articles", {
        userId: "default_user",
        guid: "legacy",
        url: "https://example.com/legacy",
        title: "Legacy fixture",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      });
      const sessionId = await ctx.db.insert("sessions", {
        userId: "default_user",
        requestedMinutes: 10,
        startedAt: Date.now(),
        readingStatus: "completed",
      });
      for (const activeTimeMs of [6000, 10000])
        await ctx.db.insert("articleInteractions", {
          userId: "default_user",
          articleId,
          sessionId,
          action: "finished",
          activeTimeMs,
          createdAt: Date.now(),
        });
      await ctx.db.insert("articleInteractions", {
        userId: "default_user",
        articleId,
        action: "abandoned",
        timeSpentMs: 120000,
        createdAt: Date.now(),
      });
    });
    const report = await t.query(api.stats.getDashboard, { timeZone: "UTC" });
    expect(report.thisWeek).toMatchObject({
      totalActiveTimeMs: 10000,
      articlesFinished: 1,
    });
    expect(report.articles[0].activeTimeMs).toBe(10000);
    expect(report.daily.reduce((sum, day) => sum + day.activeTimeMs, 0)).toBe(
      10000,
    );
  });

  it("counts notes by creation and reflections by response date, excluding blank drafts", async () => {
    const t = await ownerTest(modules);
    await t.run(async (ctx) => {
      const articleId = await ctx.db.insert("articles", {
        userId: "default_user",
        guid: "dates",
        url: "https://example.com/dates",
        title: "Dates fixture",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      });
      for (const [createdAt, contentPlain] of [
        [1, "Old note edited today"],
        [Date.now(), "   "],
        [Date.now(), "A new thought"],
      ] as const)
        await ctx.db.insert("userNotes", {
          userId: "default_user",
          articleId,
          selectedText: "passage",
          content: contentPlain,
          contentPlain,
          createdAt,
          updatedAt: Date.now(),
        });
      await ctx.db.insert("reflections", {
        userId: "default_user",
        articleId,
        strongestPoint: "A point",
        weakestAssumption: "An assumption",
        credibleCounterview: "Another view",
        questionForYou: "What did you notice?",
        userResponse: "A considered response",
        respondedAt: Date.now(),
        createdAt: 1,
      });
    });
    expect((await t.query(api.stats.getDashboard, {})).thisWeek).toMatchObject({
      notesTaken: 1,
      reflectionsWritten: 1,
    });
  });
  it("counts unique annotation opens rather than repeated cumulative snapshots", async () => {
    const t = await ownerTest(modules);
    await t.run(async (ctx) => {
      const articleId = await ctx.db.insert("articles", {
        userId: "default_user",
        guid: "stats",
        url: "https://example.com/stats",
        title: "Stats fixture",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      });
      for (const action of ["abandoned", "finished"] as const)
        await ctx.db.insert("articleInteractions", {
          userId: "default_user",
          articleId,
          action,
          annotationsOpened: ["annotation-one", "annotation-one"],
          createdAt: Date.now(),
        });
    });
    expect(
      (await t.query(api.stats.getDashboardOverview, {})).thisWeek
        .annotationsOpenedCount,
    ).toBe(1);
  });

  it("does not silently stop counting notes at 200", async () => {
    const t = await ownerTest(modules);
    await t.run(async (ctx) => {
      const articleId = await ctx.db.insert("articles", {
        userId: "default_user",
        guid: "notes",
        url: "https://example.com/notes",
        title: "Notes fixture",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      });
      for (let i = 0; i < 230; i++)
        await ctx.db.insert("userNotes", {
          userId: "default_user",
          articleId,
          selectedText: "passage",
          content: "<p>A thought</p>",
          contentPlain: "A thought",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
    });
    expect(
      (await t.query(api.stats.getDashboardOverview, {})).thisWeek.notesTaken,
    ).toBe(230);
  });
});
