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
