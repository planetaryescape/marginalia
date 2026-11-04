/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { metadataContext } from "../test/metadata";
import { addReader } from "../test/owner";
import { api } from "./_generated/api";
import authSchema from "./betterAuth/schema";
import {
  bookPartCard,
  limitLegacyReadBytes,
  ownedArticleCard,
} from "./lib/articleMetadata";
import { bookFormat } from "./lib/bookFormat";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

it.each([
  "epub",
  "pdf",
])("suggests a compact %s part after its import expires without reading prose", async (format) => {
  const t = convexTest({
    schema,
    modules,
    transactionLimits: { bytesRead: 128_000 },
  });
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("./betterAuth/**/*.ts"),
  );
  const { client, libraryId } = await addReader(t, {
    email: `compact-${format}@example.com`,
  });
  const fixture = await t.run(async (raw) => {
    const ctx = metadataContext(raw);
    await ctx.db.insert("libraryMetadataState", {
      userId: libraryId,
      articlesReady: true,
      phase: "done",
      cursor: null,
    });
    const storageId = await raw.storage.store(new Blob(["synthetic book"]));
    const fileName = `${"x".repeat(600)}.${format}`;
    const importId = await ctx.db.insert("documentImports", {
      userId: libraryId,
      storageId,
      fileName,
      format: format === "epub" ? "epub" : "pdf",
      status: "ready",
      step: "point",
      createdAt: 0,
      updatedAt: 0,
    });
    const articleId = await ctx.db.insert("articles", {
      userId: libraryId,
      guid: "synthetic-book",
      url: `upload:${importId}`,
      title: "Synthetic book",
      uploadedFileName: fileName,
      bookUnitCount: 1,
      extractionStatus: "extracted",
      annotationStatus: "skipped",
      createdAt: 0,
    });
    await ctx.db.patch(importId, { articleId });
    const unitId = await ctx.db.insert("bookUnits", {
      userId: libraryId,
      articleId,
      index: 0,
      title: "Learning to Notice",
      content: "Synthetic text",
      contentHtml: "<p>Synthetic text</p>",
      wordCount: 2,
      estimatedReadMinutes: 10,
      annotationStatus: "pending",
      ...(format === "epub"
        ? { sourceSpans: [{ spineIndex: 0, start: 0, end: 14 }] }
        : {}),
    });
    await ctx.db.insert("books", {
      userId: libraryId,
      articleId,
      unitCount: 1,
      finishedThrough: -1,
      furthestUnit: -1,
      furthestScroll: 0,
      finished: false,
      createdAt: 0,
    });
    await ctx.db.patch(unitId, {
      sourceSpans: format === "pdf" ? [] : undefined,
    });
    expect(await bookPartCard(ctx, libraryId, articleId, 0)).toMatchObject({
      format: format === "pdf" ? "epub" : "pdf",
    });
    await ctx.db.patch(unitId, {
      sourceSpans: format === "epub" ? [] : undefined,
    });
    return { articleId, unitId, importId };
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(fixture.articleId, { content: "x".repeat(200_000) });
    await ctx.db.patch(fixture.unitId, { content: "x".repeat(200_000) });
    await ctx.db.delete(fixture.importId);
  });
  await expect(t.run((ctx) => ctx.db.get(fixture.articleId))).rejects.toThrow(
    "Read too much data",
  );
  await expect(t.run((ctx) => ctx.db.get(fixture.unitId))).rejects.toThrow(
    "Read too much data",
  );
  const compact = await t.run(async (ctx) => {
    limitLegacyReadBytes(ctx, 0);
    const article = await ownedArticleCard(ctx, fixture.articleId, libraryId);
    const part = await bookPartCard(ctx, libraryId, fixture.articleId, 0);
    if (!article || !part) throw new Error("Missing synthetic compact card");
    return {
      fileName: article.uploadedFileName,
      part,
      format: await bookFormat(
        ctx,
        libraryId,
        fixture.articleId,
        article,
        0,
        part.format,
      ),
      importRow: await ctx.db.get(fixture.importId),
      metrics: await ctx.meta.getTransactionMetrics(),
    };
  });
  expect(compact.importRow).toBeNull();
  expect(compact.fileName).toBe("x".repeat(512));
  expect(compact.part).toMatchObject({ format });
  expect(compact.format).toBe(format);
  expect(compact.metrics.bytesRead.used).toBeLessThan(10_000);
  const expectedTitle =
    format === "epub"
      ? "Synthetic book · Learning to Notice"
      : "Synthetic book · Part 1 of 1";
  expect(
    await client.query(api.suggestions.forWindow, { requestedMinutes: 10 }),
  ).toMatchObject([{ title: expectedTitle, book: { unitIndex: 0 } }]);
  expect(
    await client.query(api.suggestions.moreForWindow, {
      requestedMinutes: 10,
      paginationOpts: { cursor: null, numItems: 8 },
    }),
  ).toMatchObject({
    page: [{ title: expectedTitle, book: { unitIndex: 0 } }],
  });
});
