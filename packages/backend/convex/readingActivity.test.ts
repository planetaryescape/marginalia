/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { ownerTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
async function fixture() {
  const t = await ownerTest(modules);
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "checkpoint",
      url: "https://example.com/checkpoint",
      title: "Checkpoint fixture",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: Date.now(),
    }),
  );
  const startedAt = Date.now() - 20000;
  return {
    t,
    articleId,
    checkpoint: {
      articleId,
      visitId: "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e",
      day: new Date(startedAt).toISOString().slice(0, 10),
      startedAt,
      updatedAt: startedAt + 10000,
      activeTimeMs: 6000,
      visibleTimeMs: 8000,
      timeSpentMs: 10000,
      maxScrollPercent: 40,
      annotationsOpened: ["one"],
    },
  };
}
describe("reading checkpoints", () => {
  it("counts unfinished reading once across duplicate and out-of-order checkpoints", async () => {
    const { t, checkpoint } = await fixture();
    await t.mutation(api.readingActivity.checkpoint, checkpoint);
    await t.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      updatedAt: checkpoint.updatedAt + 5000,
      activeTimeMs: 10000,
      visibleTimeMs: 13000,
      timeSpentMs: 15000,
      maxScrollPercent: 80,
      annotationsOpened: ["one", "two"],
    });
    await t.mutation(api.readingActivity.checkpoint, checkpoint);
    const stats = await t.query(api.stats.getDashboard, {
      range: "7days",
      timeZone: "UTC",
    });
    expect(stats.thisWeek).toMatchObject({
      articlesFinished: 0,
      articlesStarted: 1,
      totalActiveTimeMs: 10000,
      annotationsOpenedCount: 2,
      untrackedOpens: 0,
    });
    expect(
      await t.run((ctx) => ctx.db.query("readingActivity").take(10)),
    ).toHaveLength(1);
    expect(await t.query(api.sessions.getInProgress, {})).toMatchObject({
      article: { _id: checkpoint.articleId },
    });
  });
  it("makes completion idempotent and doesn't add checkpoint time again to legacy history", async () => {
    const { t, checkpoint } = await fixture();
    await t.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      finished: true,
    });
    await t.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      finished: true,
    });
    await t.mutation(api.readingActivity.checkpoint, checkpoint);
    const stats = await t.query(api.stats.getDashboard, {
      range: "7days",
      timeZone: "UTC",
    });
    expect(stats.thisWeek).toMatchObject({
      articlesFinished: 1,
      totalActiveTimeMs: 6000,
    });
    expect(
      await t.run((ctx) => ctx.db.query("articleInteractions").take(10)),
    ).toHaveLength(2);
  });
  it("rejects inconsistent durations and visit reuse for a different article", async () => {
    const { t, checkpoint } = await fixture();
    await expect(
      t.mutation(api.readingActivity.checkpoint, {
        ...checkpoint,
        activeTimeMs: 9000,
      }),
    ).rejects.toThrow("durations");
    await t.mutation(api.readingActivity.checkpoint, checkpoint);
    const other = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: "default_user",
        guid: "other",
        url: "https://example.com/other",
        title: "Other",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      }),
    );
    await expect(
      t.mutation(api.readingActivity.checkpoint, {
        ...checkpoint,
        articleId: other,
      }),
    ).rejects.toThrow("another article");
  });
});
