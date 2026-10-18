/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { ownerTest } from "../test/owner";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

describe("whole-library reading queue counts", () => {
  it("counts beyond 200 articles and honours finishes older than 500 interactions", async () => {
    const t = await ownerTest(modules);
    const ids = await t.run(async (ctx) => {
      const ids = [];
      for (let i = 0; i < 250; i++) {
        ids.push(
          await ctx.db.insert("articles", {
            userId: "default_user",
            guid: `item-${i}`,
            url: `https://example.com/${i}`,
            title: `Piece ${i}`,
            extractionStatus: "extracted",
            annotationStatus: "annotated",
            estimatedReadMinutes: i % 2 ? 15 : 4,
            createdAt: i,
          }),
        );
      }
      await ctx.db.insert("articleInteractions", {
        userId: "default_user",
        articleId: ids[249],
        action: "finished",
        createdAt: 0,
      });
      for (let i = 0; i < 510; i++)
        await ctx.db.insert("articleInteractions", {
          userId: "default_user",
          articleId: ids[0],
          action: "opened",
          createdAt: i + 1,
        });
      return ids;
    });
    expect((await t.query(api.home.counts, {})).waiting).toBeNull();
    for (let i = 0; i < 40; i++)
      await t.mutation(internal.readingQueue.initialize, {
        userId: "default_user",
      });
    // The card migration is independent of the pre-existing queue counter scan.
    for (let i = 0; i < 50; i++) {
      if (
        (
          await t.mutation(internal.articleMetadata.backfill, {
            userId: "default_user",
          })
        ).complete
      )
        break;
    }
    const overview = await t.query(api.home.overview, {});
    expect(overview).toMatchObject({
      countsReady: true,
      annotatedTotal: 250,
      waiting: 249,
      fits: { 5: 125, 10: 125, 20: 249, 30: 249 },
    });
    expect(overview.upNext).toHaveLength(10);
    expect(overview.upNext.map((a) => a._id)).not.toContain(ids[249]);
    await t.mutation(internal.readingQueue.initialize, {
      userId: "default_user",
    });
    expect((await t.query(api.home.overview, {})).waiting).toBe(249);
  });

  it("updates counts transactionally for annotation, length changes, reannotation and repeated finishes", async () => {
    const t = await ownerTest(modules);
    await t.mutation(internal.readingQueue.initialize, {
      userId: "default_user",
    });
    const args = {
      userId: "default_user",
      guid: "one",
      url: "https://example.com/one",
      title: "One",
      content: "text",
      contentHtml: "<p>text</p>",
      excerpt: "text",
      wordCount: 1,
      estimatedReadMinutes: 4,
    };
    const articleId = await t.mutation(internal.articles.insertExtracted, args);
    expect((await t.query(api.home.overview, {})).pending).toBe(1);
    expect(
      await t.mutation(internal.articles.insertExtracted, {
        ...args,
        title: "Replacement",
        content: "Replacement text",
        readerDocumentId: "reader-one",
      }),
    ).toBe(articleId);
    expect(await t.query(api.articles.getById, { articleId })).toMatchObject({
      title: "One",
      content: "text",
      readerDocumentId: "reader-one",
    });
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(20),
    );
    expect(
      scheduled.filter((job) => job.name.includes("generateAnnotations")),
    ).toHaveLength(1);
    await t.mutation(internal.articles.updateAnnotationStatus, {
      articleId,
      status: "annotated",
    });
    await t.mutation(internal.articles.updateAnnotationStatus, {
      articleId,
      status: "annotated",
    });
    expect(await t.query(api.home.overview, {})).toMatchObject({
      waiting: 1,
      pending: 0,
      fits: { 5: 1 },
    });
    await t.mutation(internal.articles.updateExtracted, {
      articleId,
      content: "longer",
      contentHtml: "<p>longer</p>",
      excerpt: "longer",
      wordCount: 1000,
      estimatedReadMinutes: 15,
    });
    expect((await t.query(api.home.overview, {})).fits).toMatchObject({
      5: 0,
      10: 0,
      20: 1,
    });
    await t.mutation(api.sessions.recordInteraction, {
      articleId,
      action: "finished",
    });
    await t.mutation(api.sessions.recordInteraction, {
      articleId,
      action: "finished",
    });
    expect(await t.query(api.home.overview, {})).toMatchObject({
      annotatedTotal: 1,
      waiting: 0,
      fits: { 20: 0 },
    });
    await t.mutation(internal.articles.updateAnnotationStatus, {
      articleId,
      status: "pending",
    });
    expect(await t.query(api.home.overview, {})).toMatchObject({
      annotatedTotal: 0,
      waiting: 0,
      pending: 1,
    });
    await t.mutation(internal.articles.updateAnnotationStatus, {
      articleId,
      status: "annotated",
    });
    expect((await t.query(api.home.overview, {})).waiting).toBe(0);
  });
});
