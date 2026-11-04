/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "../schema";
import { bookFormat } from "./bookFormat";

const modules = import.meta.glob("../**/*.ts");

it.each(["epub", "pdf"])("retains %s identity", async (format) => {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const fixture = await t.run(async (ctx) => {
    const fileName = "x".repeat(200);
    const articleId = await ctx.db.insert("articles", {
      userId: "reader",
      guid: "fixture",
      url: "fixture",
      title: "Generated book",
      uploadedFileName: fileName,
      bookUnitCount: 1,
      extractionStatus: "extracted",
      annotationStatus: "skipped",
      createdAt: 0,
    });
    const content = "x".repeat(100_000);
    await ctx.db.insert("bookUnits", {
      userId: "reader",
      articleId,
      index: 0,
      title: "Learning to Notice",
      content,
      contentHtml: `<p>${content}</p>`,
      wordCount: 1,
      estimatedReadMinutes: 1,
      annotationStatus: "pending",
      ...(format === "epub"
        ? { sourceSpans: [{ spineIndex: 0, start: 0, end: content.length }] }
        : {}),
    });
    const storageId = await ctx.storage.store(new Blob(["generated fixture"]));
    const importId = await ctx.db.insert("documentImports", {
      userId: "reader",
      storageId,
      fileName,
      format: format === "epub" ? "epub" : "pdf",
      status: "ready",
      step: "point",
      articleId,
      createdAt: 0,
      updatedAt: 0,
    });
    return {
      articleId,
      importId,
      source: { url: `upload:${importId}`, uploadedFileName: fileName },
    };
  });
  const measured = await t.run(async (ctx) => ({
    format: await bookFormat(
      ctx,
      "reader",
      fixture.articleId,
      fixture.source,
      0,
    ),
    metrics: await ctx.meta.getTransactionMetrics(),
  }));
  expect(measured.format).toBe(format);
  expect(measured.metrics.bytesRead.used).toBeLessThan(10_000);
  await t.run((ctx) => ctx.db.delete(fixture.importId));
  expect(
    await t.run((ctx) =>
      bookFormat(ctx, "reader", fixture.articleId, fixture.source, 0),
    ),
  ).toBe(format);
});
