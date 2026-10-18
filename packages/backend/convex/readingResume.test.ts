/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { metadataContext } from "../test/metadata";
import { addReader, ownerTest, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import authSchema from "./betterAuth/schema";
import { articleProjection } from "./lib/articleMetadata";
import type { ReadingCheckpoint } from "./lib/readingActivity";
import { initializeEmptyResume } from "./lib/readingResume";
import { purgeReadingResumes } from "./readingResume";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const article = (userId = "default_user", title = "Saved checkpoint") => ({
  userId,
  title,
  guid: title,
  url: "https://example.com/resume",
  extractionStatus: "extracted" as const,
  annotationStatus: "annotated" as const,
  estimatedReadMinutes: 20,
  createdAt: 1,
});
const snapshot = (
  articleId: string,
  changes: Partial<
    Pick<
      ReadingCheckpoint,
      | "maxScrollPercent"
      | "paragraphIndex"
      | "updatedAt"
      | "day"
      | "visitId"
      | "finished"
    >
  > = {},
) => {
  const startedAt = Date.now() - 100_000;
  return {
    articleId,
    visitId: crypto.randomUUID(),
    day: "2026-10-18",
    startedAt,
    updatedAt: startedAt + 20_000,
    activeTimeMs: 1000,
    visibleTimeMs: 2000,
    timeSpentMs: 3000,
    maxScrollPercent: 45,
    paragraphIndex: 0,
    annotationsOpened: [],
    ...changes,
  };
};
async function migrate(
  t: Pick<Awaited<ReturnType<typeof ownerTest>>, "mutation">,
  userId = "default_user",
) {
  for (let i = 0; i < 200; i++) {
    const result = await t.mutation(internal.readingResume.backfill, {
      userId,
    });
    if (result.complete || result.inactive) return result;
  }
  throw new Error("Bounded fixture migration did not complete");
}

describe("compact Continue", () => {
  it("uses a public persisted checkpoint, not its zero-percent opened interaction, beyond 200 events", async () => {
    const t = await ownerTest(modules);
    const id = await t.run((ctx) =>
      metadataContext(ctx).db.insert("articles", article()),
    );
    const cp = snapshot(id);
    await t.mutation(api.readingActivity.checkpoint, cp);
    await t.run(async (ctx) => {
      for (let i = 0; i < 225; i++)
        await ctx.db.insert("articleInteractions", {
          userId: "default_user",
          articleId: id,
          action: "presented",
          createdAt: Date.now() + i,
        });
    });
    const value = await t.query(api.sessions.getContinue, {});
    expect(value).toEqual({
      ready: true,
      item: {
        article: { _id: id, title: "Saved checkpoint" },
        scrollPercent: 45,
        remainingMinutes: 11,
        paragraphIndex: 0,
      },
    });
    expect(JSON.stringify(value).length).toBeLessThan(400);
    expect(await t.query(api.sessions.getInProgress, {})).toBeNull();
    // The established identity check must run before any derived progress write.
    const foreignArticle = await t.run((ctx) =>
      metadataContext(ctx).db.insert(
        "articles",
        article("default_user", "Other"),
      ),
    );
    await expect(
      t.mutation(api.readingActivity.checkpoint, {
        ...cp,
        articleId: foreignArticle,
      }),
    ).rejects.toThrow("visit belongs");
    expect(await t.query(api.sessions.getContinue, {})).toEqual(value);
  });

  it("merges multiple visits, midnight splits, late replay and exact timestamp/paragraph ties deterministically", async () => {
    const t = await ownerTest(modules);
    const a = await t.run((ctx) =>
      metadataContext(ctx).db.insert("articles", article()),
    );
    const b = await t.run((ctx) =>
      metadataContext(ctx).db.insert(
        "articles",
        article("default_user", "Newer"),
      ),
    );
    const cp = snapshot(a);
    for (const update of [
      { maxScrollPercent: 62, paragraphIndex: 12 },
      {
        maxScrollPercent: 62,
        paragraphIndex: 99,
        updatedAt: cp.updatedAt - 1000,
      },
      { maxScrollPercent: 62, paragraphIndex: 15 },
      { maxScrollPercent: 62, paragraphIndex: 12 },
      {
        maxScrollPercent: 20,
        paragraphIndex: 3,
        updatedAt: cp.updatedAt - 1000,
      },
    ])
      await t.mutation(api.readingActivity.checkpoint, { ...cp, ...update });
    await t.mutation(api.readingActivity.checkpoint, {
      ...cp,
      visitId: crypto.randomUUID(),
      maxScrollPercent: 25,
      paragraphIndex: 2,
    });
    await t.mutation(api.readingActivity.checkpoint, {
      ...cp,
      day: "2026-10-19",
      maxScrollPercent: 30,
    });
    expect((await t.query(api.sessions.getContinue, {})).item).toMatchObject({
      scrollPercent: 62,
      paragraphIndex: 15,
    });
    const laterVisit = snapshot(a, {
      maxScrollPercent: 62,
      paragraphIndex: 4,
      updatedAt: cp.updatedAt + 1000,
    });
    await t.mutation(api.readingActivity.checkpoint, laterVisit);
    expect((await t.query(api.sessions.getContinue, {})).item).toMatchObject({
      scrollPercent: 62,
      paragraphIndex: 4,
    });
    const newer = snapshot(b, { updatedAt: cp.updatedAt + 5000 });
    await t.mutation(api.readingActivity.checkpoint, newer);
    await t.mutation(api.readingActivity.checkpoint, cp);
    expect(
      (await t.query(api.sessions.getContinue, {})).item?.article._id,
    ).toBe(b);
    await t.mutation(api.readingActivity.checkpoint, {
      ...cp,
      updatedAt: newer.updatedAt,
    });
    // Equal timestamps have a stable article-id tie break, independent of delivery.
    const tied = await t.query(api.sessions.getContinue, {});
    await t.mutation(api.readingActivity.checkpoint, newer);
    expect(await t.query(api.sessions.getContinue, {})).toEqual(tied);
  });

  it("honours source finish/reopen/removal and does not let late checkpoints revive finished articles", async () => {
    const t = await ownerTest(modules);
    const id = await t.run((ctx) =>
      metadataContext(ctx).db.insert("articles", article()),
    );
    const cp = snapshot(id);
    await t.mutation(api.readingActivity.checkpoint, cp);
    await t.mutation(api.sessions.recordInteraction, {
      articleId: id,
      action: "finished",
    });
    await t.mutation(api.readingActivity.checkpoint, cp);
    expect((await t.query(api.sessions.getContinue, {})).item).toBeNull();
    await t.run((ctx) =>
      metadataContext(ctx).db.patch(id, { finishedAt: undefined }),
    );
    expect(
      (await t.query(api.sessions.getContinue, {})).item?.scrollPercent,
    ).toBe(45);
    await t.run((ctx) => metadataContext(ctx).db.delete(id));
    expect((await t.query(api.sessions.getContinue, {})).item).toBeNull();
    await expect(
      t.mutation(api.readingActivity.checkpoint, cp),
    ).rejects.toThrow("Article not found");
    expect(
      await t.run((ctx) => ctx.db.query("readingResumes").take(10)),
    ).toHaveLength(0);
  });

  it("refuses foreign checkpoints and excludes disabled/deleting readers from queries, migration and queued writes", async () => {
    const f = await secondReaderTest(modules);
    const id = await f.t.run((ctx) =>
      metadataContext(ctx).db.insert("articles", article()),
    );
    await expect(
      f.reader.mutation(api.readingActivity.checkpoint, snapshot(id)),
    ).rejects.toThrow("Article not found");
    const ownId = await f.t.run((ctx) =>
      metadataContext(ctx).db.insert("articles", article(f.readerLibraryId)),
    );
    await f.reader.mutation(api.readingActivity.checkpoint, snapshot(ownId));
    expect((await f.owner.query(api.sessions.getContinue, {})).item).toBeNull();
    for (const changes of [
      { status: "disabled" as const },
      { status: "active" as const, deletingAt: 1 },
    ]) {
      await f.t.run(async (ctx) => {
        const reader = await ctx.db
          .query("readers")
          .withIndex("by_libraryId", (q) =>
            q.eq("libraryId", f.readerLibraryId),
          )
          .unique();
        if (!reader) throw new Error("Missing reader fixture");
        await ctx.db.patch(reader._id, changes);
      });
      await expect(
        f.reader.query(api.sessions.getContinue, {}),
      ).rejects.toThrow();
      await expect(
        f.t.mutation(internal.readingActivity.record, {
          ...snapshot(ownId),
          userId: f.readerLibraryId,
        }),
      ).rejects.toThrow("no longer active");
      expect(
        await f.t.mutation(internal.readingResume.backfill, {
          userId: f.readerLibraryId,
        }),
      ).toEqual({ complete: false, inactive: true });
    }
    expect(
      await f.t.run((ctx) => purgeReadingResumes(ctx, f.readerLibraryId)),
    ).toBeGreaterThan(0);
    expect(
      await f.t.run((ctx) => purgeReadingResumes(ctx, f.readerLibraryId)),
    ).toBe(1);
    expect(
      await f.t.run((ctx) => purgeReadingResumes(ctx, f.readerLibraryId)),
    ).toBe(0);
    expect(
      await f.t.mutation(internal.readingResume.backfill, {
        userId: f.readerLibraryId,
      }),
    ).toMatchObject({ inactive: true });
  });

  it("backfills every historical checkpoint additively, keeps partial migration honest and protects concurrent new saves", async () => {
    const t = await ownerTest(modules);
    const id = await t.run(async (ctx) => {
      const id = await metadataContext(ctx).db.insert("articles", article());
      for (let i = 0; i < 211; i++)
        await ctx.db.insert("articleInteractions", {
          userId: "default_user",
          articleId: id,
          action: "opened",
          maxScrollPercent: 0,
          createdAt: i,
        });
      const cp = snapshot(id);
      await ctx.db.insert("readingActivity", {
        ...cp,
        articleId: id,
        userId: "default_user",
        maxScrollPercent: 78,
        paragraphIndex: 40,
      });
      return id;
    });
    await t.run((ctx) => initializeEmptyResume(ctx, "default_user"));
    expect(await t.query(api.sessions.getContinue, {})).toEqual({
      ready: false,
      item: null,
    });
    expect(
      await t.mutation(internal.readingResume.backfill, {
        userId: "default_user",
      }),
    ).toMatchObject({ complete: false });
    await t.mutation(
      api.readingActivity.checkpoint,
      snapshot(id, { maxScrollPercent: 50 }),
    );
    expect(await t.query(api.sessions.getContinue, {})).toEqual({
      ready: false,
      item: null,
    });
    expect(await migrate(t)).toMatchObject({ complete: true });
    expect((await t.query(api.sessions.getContinue, {})).item).toMatchObject({
      scrollPercent: 78,
      paragraphIndex: 40,
    });
    await t.mutation(api.sessions.recordInteraction, {
      articleId: id,
      action: "abandoned",
      maxScrollPercent: 2,
    });
    expect(
      (await t.query(api.sessions.getContinue, {})).item?.scrollPercent,
    ).toBe(78);
    await migrate(t);
    expect(
      await t.run((ctx) => ctx.db.query("readingResumes").take(10)),
    ).toHaveLength(1);
  });

  it("uses small part cards with unit zero and the exact 95% next/last-part handoff, without scheduling work", async () => {
    const t = await ownerTest(modules);
    const { id, bookId } = await t.run(async (raw) => {
      const ctx = metadataContext(raw);
      const id = await ctx.db.insert("articles", {
        ...article(),
        bookUnitCount: 2,
      });
      const bookId = await ctx.db.insert("books", {
        userId: "default_user",
        articleId: id,
        unitCount: 2,
        finishedThrough: -1,
        furthestUnit: 0,
        furthestScroll: 40,
        furthestParagraph: 0,
        finished: false,
        createdAt: 1,
      });
      for (let index = 0; index < 2; index++)
        await ctx.db.insert("bookUnits", {
          userId: "default_user",
          articleId: id,
          index,
          title: `Chapter ${index + 1}`,
          estimatedReadMinutes: 10,
          content: "body",
          contentHtml: "<p>body</p>",
          wordCount: 2000,
          annotationStatus: "pending",
        });
      return { id, bookId };
    });
    await t.mutation(api.readingActivity.checkpoint, snapshot(id));
    expect((await t.query(api.sessions.getContinue, {})).item).toMatchObject({
      unitIndex: 0,
      paragraphIndex: 0,
      scrollPercent: 40,
      remainingMinutes: 6,
      part: { number: 1, count: 2, title: "Chapter 1" },
    });
    await t.run((ctx) => ctx.db.patch(bookId, { furthestScroll: 94.9 }));
    expect((await t.query(api.sessions.getContinue, {})).item).toMatchObject({
      unitIndex: 0,
      scrollPercent: 94.9,
    });
    await t.run((ctx) => ctx.db.patch(bookId, { furthestScroll: 95 }));
    expect((await t.query(api.sessions.getContinue, {})).item).toMatchObject({
      unitIndex: 1,
      scrollPercent: 0,
      remainingMinutes: 10,
      part: { number: 2, title: "Chapter 2" },
    });
    await t.run((ctx) =>
      ctx.db.patch(bookId, { furthestUnit: 1, furthestScroll: 95 }),
    );
    expect((await t.query(api.sessions.getContinue, {})).item).toBeNull();
    await t.run((ctx) =>
      ctx.db.patch(bookId, { furthestScroll: 30, finished: true }),
    );
    expect((await t.query(api.sessions.getContinue, {})).item).toBeNull();
    expect(
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").take(10),
      ),
    ).toEqual([]);
  });

  it("physically reads under 128 KB with near-limit prose/part bodies, vectors and deferred oversized URL", async () => {
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
      email: "physical-resume@example.com",
    });
    const id = await t.run(async (ctx) => {
      const fields = {
        ...article(libraryId),
        bookUnitCount: 2,
        url: "u".repeat(9000),
        content: "x".repeat(970_000),
        embedding: [0.2, 0.4],
      };
      const id = await ctx.db.insert("articles", fields);
      await ctx.db.insert(
        "articleMetadata",
        articleProjection({ ...fields, _id: id, _creationTime: 1 }),
      );
      const unitId = await ctx.db.insert("bookUnits", {
        userId: libraryId,
        articleId: id,
        index: 0,
        title: "Part zero",
        content: "x".repeat(990_000),
        contentHtml: "",
        wordCount: 1000,
        estimatedReadMinutes: 8,
        annotationStatus: "pending",
      });
      await ctx.db.insert("bookPartCards", {
        userId: libraryId,
        articleId: id,
        unitId,
        index: 0,
        title: "Part zero",
        minutes: 8,
      });
      await ctx.db.insert("books", {
        userId: libraryId,
        articleId: id,
        unitCount: 2,
        finishedThrough: -1,
        furthestUnit: 0,
        furthestScroll: 50,
        finished: false,
        createdAt: 1,
      });
      await ctx.db.insert("readingResumes", {
        userId: libraryId,
        articleId: id,
        eligible: true,
        lastActivityAt: 1,
        maxScrollPercent: 0,
        hasCheckpoint: true,
        placeUpdatedAt: 1,
        placeKey: "fixture",
      });
      await ctx.db.insert("readingResumeState", {
        userId: libraryId,
        phase: "done",
        cursor: null,
      });
      await ctx.db.insert("articleInteractions", {
        userId: libraryId,
        articleId: id,
        action: "opened",
        createdAt: 1,
      });
      return id;
    });
    await expect(client.query(api.sessions.getInProgress, {})).rejects.toThrow(
      "Read too much data",
    );
    await expect(t.run((ctx) => ctx.db.get(id))).rejects.toThrow(
      "Read too much data",
    );
    const value = await client.query(api.sessions.getContinue, {});
    expect(value.item).toMatchObject({
      unitIndex: 0,
      remainingMinutes: 4,
      part: { title: "Part zero" },
    });
    expect(JSON.stringify(value).length).toBeLessThan(450);
  });

  it("resumes migration under an 8 MB transaction ceiling with near-limit legacy bodies and history rows", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { bytesRead: 8_000_000 },
    });
    const ids = [];
    for (let i = 0; i < 12; i++)
      ids.push(
        await t.run(async (ctx) => {
          const id = await ctx.db.insert("articles", {
            ...article("default_user", `Large ${i}`),
            content: "x".repeat(970_000),
          });
          await ctx.db.insert("articleInteractions", {
            userId: "default_user",
            articleId: id,
            action: "opened",
            createdAt: i,
            annotationsOpened: ["x".repeat(970_000)],
          });
          const cp = snapshot(id);
          await ctx.db.insert("readingActivity", {
            ...cp,
            articleId: id,
            userId: "default_user",
            maxScrollPercent: 45,
            annotationsOpened: ["x".repeat(970_000)],
          });
          return id;
        }),
      );
    expect(await migrate(t)).toMatchObject({ complete: true });
    const resumes = await t.run((ctx) =>
      ctx.db.query("readingResumes").take(20),
    );
    expect(resumes).toHaveLength(12);
    expect(
      resumes.every((row) => row.maxScrollPercent === 45 && row.hasCheckpoint),
    ).toBe(true);
    expect(new Set(resumes.map((row) => row.articleId))).toEqual(new Set(ids));
  });
});
