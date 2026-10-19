/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "./_generated/api";
import { ownedArticle } from "./access";
import { articleProjection } from "./lib/articleMetadata";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
it("authorizes and exactly ranks 32 physical vectors below 500 KB where a near-limit body authorization fails", async () => {
  const t = convexTest({
    schema,
    modules,
    transactionLimits: { bytesRead: 500_000 },
  });
  const userId = "default_user";
  const articleId = await t.run(async (ctx) => {
    const fields = {
      userId,
      guid: "large",
      url: "https://example.com/large",
      title: "Large",
      content: "x".repeat(990_000),
      extractionStatus: "extracted" as const,
      annotationStatus: "annotated" as const,
      createdAt: 0,
    };
    const id = await ctx.db.insert("articles", fields);
    await ctx.db.insert(
      "articleMetadata",
      articleProjection({ ...fields, _id: id, _creationTime: 0 }),
    );
    return id;
  });
  await expect(
    t.run((ctx) => ownedArticle(ctx, articleId, userId)),
  ).rejects.toThrow("Read too much data");
  expect(
    await t.query(internal.articlePassages.authorized, { userId, articleId }),
  ).toBe(true);
  const cache = await t.mutation(internal.articlePassages.prepare, {
    userId,
    articleId,
    contentHash: "exact",
    model: "fixture",
    total: 64,
  });
  if (!cache) throw new Error("Expected authorized cache");
  const query = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
  for (const offset of [0, 32]) {
    expect(
      await t.mutation(internal.articlePassages.append, {
        userId,
        articleId,
        generation: cache.generation,
        offset,
        passages: Array.from({ length: 32 }, (_, i) => ({
          startParagraph: offset + i,
          endParagraph: offset + i,
          fromOffset: 0,
          toOffset: 1000,
          embedding: query,
        })),
      }),
    ).toBe(true);
  }
  const first = await t.query(internal.articlePassages.rankPage, {
    userId,
    articleId,
    generation: cache.generation,
    query,
    cursor: null,
  });
  expect(first?.ranked).toHaveLength(32);
  expect(first?.ranked.map((p) => p.start)).toEqual(
    Array.from({ length: 32 }, (_, i) => i),
  );
  expect(first?.ranked.every((p) => p.score === 1)).toBe(true);
  expect(first?.cursor).toBeTruthy();
  const second = await t.query(internal.articlePassages.rankPage, {
    userId,
    articleId,
    generation: cache.generation,
    query,
    cursor: first!.cursor,
  });
  expect(second?.ranked).toHaveLength(32);
  expect(second?.cursor).toBeNull();
  expect(JSON.stringify(first)).not.toContain("embedding");
});
