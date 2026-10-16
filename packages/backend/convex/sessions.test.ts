/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { ownerTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";

async function reopenedArticle(finished: boolean) {
  const t = await ownerTest(modules);
  await t.run(async (ctx) => {
    const now = Date.now();
    const articleId = await ctx.db.insert("articles", {
      userId: OWNER,
      guid: "g",
      url: "https://example.com/a",
      title: "A paper",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      estimatedReadMinutes: 20,
      wordCount: 4000,
      finishedAt: finished ? now - 60_000 : undefined,
      createdAt: now - 120_000,
    });
    const sessionId = await ctx.db.insert("sessions", {
      userId: OWNER,
      requestedMinutes: 20,
      startedAt: now - 120_000,
      articleId,
      readingStatus: "reading",
    });
    const row = { userId: OWNER, articleId, sessionId };
    // Read, finished, then opened again
    await ctx.db.insert("articleInteractions", {
      ...row,
      action: "opened",
      maxScrollPercent: 40,
      createdAt: now - 110_000,
    });
    await ctx.db.insert("articleInteractions", {
      ...row,
      action: "finished",
      createdAt: now - 60_000,
    });
    await ctx.db.insert("articleInteractions", {
      ...row,
      action: "opened",
      maxScrollPercent: 5,
      createdAt: now - 1_000,
    });
  });
  return t;
}

describe("Continue", () => {
  it("never offers an article that is finished, even after it is reopened", async () => {
    const t = await reopenedArticle(true);
    expect(await t.query(api.sessions.getInProgress, {})).toBeNull();
  });

  it("offers it again once it is no longer finished", async () => {
    const t = await reopenedArticle(false);
    expect(await t.query(api.sessions.getInProgress, {})).toMatchObject({
      article: { title: "A paper" },
    });
  });
});

describe("Continue in a book", () => {
  it("counts the minutes left in the part being read, not the whole book", async () => {
    const t = await ownerTest(modules);
    await t.run(async (ctx) => {
      const now = Date.now();
      const articleId = await ctx.db.insert("articles", {
        userId: OWNER,
        guid: "b",
        url: "https://example.com/b",
        title: "A book",
        extractionStatus: "extracted",
        annotationStatus: "skipped",
        estimatedReadMinutes: 600,
        wordCount: 130_000,
        bookUnitCount: 3,
        createdAt: now,
      });
      await ctx.db.insert("books", {
        userId: OWNER,
        articleId,
        unitCount: 3,
        finishedThrough: 0,
        furthestUnit: 1,
        furthestScroll: 50,
        finished: false,
        createdAt: now,
      });
      await ctx.db.insert("bookUnits", {
        userId: OWNER,
        articleId,
        index: 1,
        title: "Branching",
        content: "text",
        contentHtml: "<p>text</p>",
        wordCount: 2200,
        estimatedReadMinutes: 10,
        annotationStatus: "skipped",
      });
      const sessionId = await ctx.db.insert("sessions", {
        userId: OWNER,
        requestedMinutes: 10,
        startedAt: now,
        articleId,
        readingStatus: "reading",
      });
      await ctx.db.insert("articleInteractions", {
        userId: OWNER,
        articleId,
        sessionId,
        action: "opened",
        maxScrollPercent: 3,
        createdAt: now,
      });
    });
    expect(await t.query(api.sessions.getInProgress, {})).toMatchObject({
      remainingMinutes: 5,
      part: { number: 2, count: 3, title: "Branching" },
    });
  });
});
