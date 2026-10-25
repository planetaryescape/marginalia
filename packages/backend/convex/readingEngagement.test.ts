/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { addReader, secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.UTC(2026, 9, 25, 12);
const period = { timeZone: "UTC", period: "month" as const };
afterEach(() => vi.useRealTimers());

describe("article engagement report", () => {
  it("keeps reader marks, notes, imports and distinct AI opens separate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const f = await secondReaderTest(modules);
    const articleId = await f.t.run(async (ctx) => {
      const articleId = await ctx.db.insert("articles", {
        userId: f.readerLibraryId,
        guid: "engagement",
        url: "https://example.com/engagement",
        title: "Engaged article",
        wordCount: 2000,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: NOW,
      });
      const annotationId = await ctx.db.insert("annotations", {
        articleId,
        userId: f.readerLibraryId,
        type: "question",
        anchorText: "question",
        anchorStartOffset: 0,
        anchorEndOffset: 8,
        content: "A margin note",
        relevanceScore: 1,
        wasViewed: false,
        wasDismissed: false,
        createdAt: NOW,
      });
      const secondAnnotationId = await ctx.db.insert("annotations", {
        articleId,
        userId: f.readerLibraryId,
        type: "question",
        anchorText: "connection",
        anchorStartOffset: 9,
        anchorEndOffset: 19,
        content: "Another margin note",
        relevanceScore: 1,
        wasViewed: false,
        wasDismissed: false,
        createdAt: NOW,
      });
      for (const [kind, source] of [
        ["highlight", "marginalia"],
        ["highlight", "marginalia"],
        ["underline", "marginalia"],
        ["highlight", "reader"],
      ] as const)
        await ctx.db.insert("highlights", {
          userId: f.readerLibraryId,
          articleId,
          kind,
          source,
          text: "marked passage",
          createdAt: NOW - 1000,
        });
      await ctx.db.insert("userNotes", {
        userId: f.readerLibraryId,
        articleId,
        selectedText: "passage",
        content: "<p>personal note</p>",
        contentPlain: "personal note",
        createdAt: NOW - 2000,
        updatedAt: NOW,
      });
      await ctx.db.insert("userNotes", {
        userId: f.readerLibraryId,
        articleId,
        selectedText: "another passage",
        content: "<p>another personal note</p>",
        contentPlain: "another personal note",
        createdAt: NOW - 3000,
        updatedAt: NOW,
      });
      await ctx.db.insert("userNotes", {
        userId: f.readerLibraryId,
        articleId,
        selectedText: "blank passage",
        content: "<p> </p>",
        contentPlain: "   ",
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.insert("userNotes", {
        userId: f.readerLibraryId,
        articleId,
        selectedText: "passage",
        content: "<p>old note edited now</p>",
        contentPlain: "old note edited now",
        createdAt: NOW - 40 * 86_400_000,
        updatedAt: NOW,
      });
      for (const visit of [
        { visitId: "visit-one", startedAt: NOW - 1000 },
        { visitId: "visit-two", startedAt: NOW - 500 },
      ])
        await ctx.db.insert("readingActivity", {
          userId: f.readerLibraryId,
          articleId,
          visitId: visit.visitId,
          day: "2026-10-25",
          startedAt: visit.startedAt,
          updatedAt: visit.startedAt,
          activeTimeMs: 60_000,
          visibleTimeMs: 60_000,
          timeSpentMs: 60_000,
          maxScrollPercent: 50,
          annotationsOpened:
            visit.visitId === "visit-one"
              ? [String(annotationId), String(annotationId)]
              : [
                  String(annotationId),
                  String(annotationId),
                  String(secondAnnotationId),
                ],
        });
      await ctx.db.insert("articleInteractions", {
        userId: f.readerLibraryId,
        articleId,
        action: "opened",
        annotationsOpened: [
          String(annotationId),
          String(secondAnnotationId),
          "not-an-id",
        ],
        createdAt: NOW,
      });
      return articleId;
    });

    const report = await f.reader.query(api.stats.readingEngagement, period);
    expect(report.articles).toMatchObject([
      {
        articleId,
        title: "Engaged article",
        personalHighlights: 2,
        personalUnderlines: 1,
        notes: 2,
        importedHighlights: 1,
        importedUnderlines: 0,
        aiMarginNotes: 2,
        personalMarksPerThousandWords: 1.5,
      },
    ]);
    expect(report.partial).toBe(false);
    expect(report.articles[0].lastPersonalAt).toBe(NOW - 1000);
  });

  it("uses server timezone period boundaries and excludes foreign, stale and invalid records", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const f = await secondReaderTest(modules);
    await f.t.run(async (ctx) => {
      const own = await ctx.db.insert("articles", {
        userId: f.readerLibraryId,
        guid: "own",
        url: "https://example.com/own",
        title: "Owned",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: NOW,
      });
      const foreign = await ctx.db.insert("articles", {
        userId: "default_user",
        guid: "foreign",
        url: "https://example.com/foreign",
        title: "Foreign",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: NOW,
      });
      await ctx.db.insert("highlights", {
        userId: f.readerLibraryId,
        articleId: own,
        kind: "highlight",
        text: "outside month",
        createdAt: Date.UTC(2026, 8, 30, 23),
      });
      await ctx.db.insert("highlights", {
        userId: f.readerLibraryId,
        articleId: foreign,
        kind: "highlight",
        text: "foreign article",
        createdAt: NOW,
      });
      await ctx.db.insert("highlights", {
        userId: "default_user",
        articleId: foreign,
        kind: "underline",
        text: "owner's private mark",
        createdAt: NOW,
      });
      const foreignAnnotation = await ctx.db.insert("annotations", {
        articleId: foreign,
        userId: "default_user",
        type: "question",
        anchorText: "foreign",
        anchorStartOffset: 0,
        anchorEndOffset: 7,
        content: "Foreign note",
        relevanceScore: 1,
        wasViewed: false,
        wasDismissed: false,
        createdAt: NOW,
      });
      await ctx.db.insert("readingActivity", {
        userId: f.readerLibraryId,
        articleId: own,
        visitId: "invalid-open",
        day: "2026-10-25",
        startedAt: NOW,
        updatedAt: NOW,
        activeTimeMs: 1,
        visibleTimeMs: 1,
        timeSpentMs: 1,
        maxScrollPercent: 1,
        annotationsOpened: [String(foreignAnnotation), "not-an-id"],
      });
    });
    expect(
      await f.reader.query(api.stats.readingEngagement, period),
    ).toMatchObject({ articles: [], partial: false });
    await expect(
      f.owner.query(api.stats.readingEngagement, period),
    ).resolves.toMatchObject({
      articles: [{ title: "Foreign", personalUnderlines: 1 }],
    });
  });

  it("keeps disabled and deleting readers behind the public query guard", async () => {
    const f = await secondReaderTest(modules);
    const disabled = await addReader(f.t, {
      email: "disabled-engagement@example.com",
      status: "disabled",
    });
    await expect(
      disabled.client.query(api.stats.readingEngagement, period),
    ).rejects.toThrow("Sign in");

    await f.t.run(async (ctx) => {
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.readerLibraryId))
        .unique();
      if (!reader) throw new Error("Missing reader fixture");
      await ctx.db.patch(reader._id, { status: "disabled", deletingAt: NOW });
    });
    await expect(
      f.reader.query(api.stats.readingEngagement, period),
    ).rejects.toThrow("Sign in");
  });

  it("orders equally active article titles independently of insertion order", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const f = await secondReaderTest(modules);
    await f.t.run(async (ctx) => {
      for (const title of ["Beta", "Alpha"]) {
        const articleId = await ctx.db.insert("articles", {
          userId: f.readerLibraryId,
          guid: title,
          url: `https://example.com/${title}`,
          title,
          extractionStatus: "extracted",
          annotationStatus: "annotated",
          createdAt: NOW,
        });
        await ctx.db.insert("highlights", {
          userId: f.readerLibraryId,
          articleId,
          kind: "highlight",
          text: "one mark",
          createdAt: NOW,
        });
      }
    });
    const report = await f.reader.query(api.stats.readingEngagement, period);
    expect(report.articles.map((article) => article.title)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("returns a byte-bounded partial report for large prose and vector marks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const f = await secondReaderTest(modules);
    await f.t.run(async (ctx) => {
      const articleId = await ctx.db.insert("articles", {
        userId: f.readerLibraryId,
        guid: "large-marks",
        url: "https://example.com/large-marks",
        title: "Large marks",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: NOW,
      });
      for (let index = 0; index < 3; index++)
        await ctx.db.insert("highlights", {
          userId: f.readerLibraryId,
          articleId,
          kind: "highlight",
          text: "x".repeat(550_000),
          embedding: Array.from({ length: 1536 }, () => 0.25),
          createdAt: NOW - index,
        });
    });
    const result = await f.reader.run(async (ctx) => {
      const report = await ctx.runQuery(api.stats.readingEngagement, period);
      return { report, metrics: await ctx.meta.getTransactionMetrics() };
    });
    expect(result.report.partial).toBe(true);
    expect(result.report.articles[0].personalHighlights).toBe(2);
    expect(result.metrics.bytesRead.used).toBeLessThan(8_000_000);
  });
});
