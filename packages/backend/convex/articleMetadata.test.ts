/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { finishArticleRemoval } from "../test/feedRemoval";
import { metadataContext } from "../test/metadata";
import { addReader, ownerTest, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { purgeArticleMetadata } from "./articleMetadata";
import authSchema from "./betterAuth/schema";
import {
  articleProjection,
  initializeEmptyMetadata,
  ownedArticleCard,
} from "./lib/articleMetadata";
import { deleteArticle } from "./lib/feedRemoval";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const article = (userId = "default_user", title = "Metadata choice") => ({
  userId,
  guid: title,
  url: `https://example.com/${title}`,
  title,
  extractionStatus: "extracted" as const,
  annotationStatus: "annotated" as const,
  estimatedReadMinutes: 10,
  createdAt: 1,
});

async function migrate(
  t: Pick<ReturnType<typeof convexTest>, "mutation">,
  userId = "default_user",
) {
  for (let i = 0; i < 200; i++) {
    const result = await t.mutation(internal.articleMetadata.backfill, {
      userId,
    });
    if (result.complete || result.inactive) return result;
  }
  throw new Error("Migration did not finish within fixture bound");
}

describe("physical article metadata", () => {
  it("bounds adversarial headers without breaking Unicode scalar boundaries", async () => {
    const t = await ownerTest(modules);
    await t.run((raw) =>
      metadataContext(raw).db.insert("articles", {
        ...article(),
        title: `${"x".repeat(2047)}😀`,
        author: `${"x".repeat(511)}😀`,
        url: `${"x".repeat(8191)}😀`,
      }),
    );
    const row = await t.run((ctx) => ctx.db.query("articleMetadata").first());
    expect(row?.title).toBe("x".repeat(2047));
    expect(row?.author).toBe("x".repeat(511));
    expect(row?.url).toBe("");
    expect(row?.urlDeferred).toBe(true);
  });
  it("initializes only truly empty new libraries, not populated legacy or disabled readers", async () => {
    const f = await secondReaderTest(modules);
    expect(
      await f.t.run((ctx) => initializeEmptyMetadata(ctx, f.readerLibraryId)),
    ).toBe(true);
    expect(await f.reader.query(api.articleMetadata.counts, {})).toEqual({
      ready: true,
      saved: 0,
      loved: 0,
    });
    await f.t.run((ctx) => ctx.db.insert("articles", article()));
    expect(
      await f.t.run((ctx) => initializeEmptyMetadata(ctx, "default_user")),
    ).toBe(false);
    expect(
      await f.t.run((ctx) => initializeEmptyMetadata(ctx, "already-purged")),
    ).toBe(false);
  });
  it("serves 40 search hits, desk choices, shelves and eight headings under 128 KB while a body join fails", async () => {
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
      email: "byte-reader@example.com",
    });
    const ids: Id<"articles">[] = [];
    for (let i = 0; i < 40; i++) {
      ids.push(
        await t.run(async (ctx) => {
          const annotationStatus =
            i >= 32 && i < 36
              ? ("failed" as const)
              : i >= 24 && i < 32
                ? ("deferred" as const)
                : ("annotated" as const);
          const estimatedReadMinutes =
            i < 12 || (i >= 24 && i < 28) || (i >= 32 && i < 34)
              ? 9
              : i < 36
                ? 11
                : 10;
          const fields = {
            ...article(libraryId, `Metadata choice ${i}`),
            annotationStatus,
            estimatedReadMinutes,
            content: "x".repeat(990_000),
          };
          const id = await ctx.db.insert("articles", fields);
          // Seed the post-migration state without reading a body in this deliberately
          // tiny read-budget fixture. Lifecycle/backfill are tested separately.
          await ctx.db.insert(
            "articleMetadata",
            articleProjection({ ...fields, _id: id, _creationTime: i }),
          );
          return id;
        }),
      );
    }
    await t.run(async (ctx) => {
      await ctx.db.insert("libraryMetadataState", {
        userId: libraryId,
        articlesReady: true,
        phase: "done",
        cursor: null,
      });
      await ctx.db.insert("shelfCounts", {
        userId: libraryId,
        saved: 0,
        loved: 0,
        ready: true,
      });
    });
    await expect(
      client.query(api.articles.getById, { articleId: ids[0] }),
    ).rejects.toThrow("Read too much data");
    await expect(
      t.run((ctx) => Promise.all(ids.map((id) => ctx.db.get(id)))),
    ).rejects.toThrow("Read too much data");
    expect(
      await t.query(internal.library.findArticles, {
        userId: libraryId,
        articleIds: ids,
      }),
    ).toHaveLength(40);
    expect(
      await t.query(internal.library.loadArticles, {
        userId: libraryId,
        articleIds: ids.slice(0, 24),
      }),
    ).toHaveLength(24);
    expect(
      await client.query(api.suggestions.forWindow, { requestedMinutes: 10 }),
    ).toHaveLength(3);
    expect(
      await client.query(api.articleMetadata.headers, {
        articleIds: ids.slice(0, 8),
      }),
    ).toHaveLength(8);
    expect(
      await client.query(api.titleSearch.matchTitles, { query: "Metadata" }),
    ).toHaveLength(5);
    expect(
      (
        await client.query(api.home.upNextPage, {
          paginationOpts: { cursor: null, numItems: 8 },
        })
      ).page,
    ).toHaveLength(8);
    for (const id of ids.slice(0, 12))
      await client.mutation(api.savedArticles.save, { articleId: id });
    expect(
      (
        await client.query(api.savedArticles.page, {
          paginationOpts: { cursor: null, numItems: 12 },
        })
      ).page,
    ).toHaveLength(12);
    expect(await client.query(api.articleMetadata.counts, {})).toMatchObject({
      saved: 12,
      loved: 0,
      ready: true,
    });
    expect(
      await client.query(api.userNotes.listByArticle, { articleId: ids[0] }),
    ).toEqual([]);
  });

  it("mirrors generic-ID patch/replace/delete atomically, with no derived write for vectors or leases", async () => {
    const t = await ownerTest(modules);
    const id = await t.run((raw) =>
      metadataContext(raw).db.insert("articles", article()),
    );
    const read = () =>
      t.run((ctx) =>
        ctx.db
          .query("articleMetadata")
          .withIndex("by_articleId", (q) => q.eq("articleId", id))
          .unique(),
      );
    const before = await read();
    expect(before).toMatchObject({ articleId: id, title: "Metadata choice" });
    await t.mutation(internal.articles.setEmbedding, {
      articleId: id,
      embedding: [0.1, 0.2],
    });
    await t.run(async (raw) => {
      const replace = vi.spyOn(raw.db, "replace");
      await metadataContext(raw).db.patch(id, { reannotateClaimedAt: 42 });
      expect(replace).not.toHaveBeenCalled();
      replace.mockRestore();
    });
    expect(await read()).toEqual(before);
    await t.run((raw) =>
      metadataContext(raw).db.patch(id, { title: "Changed", finishedAt: 12 }),
    );
    expect(await read()).toMatchObject({ title: "Changed", finishedAt: 12 });
    await t.run((raw) =>
      metadataContext(raw).db.replace(
        id,
        article("default_user", "Replacement"),
      ),
    );
    expect(await read()).toMatchObject({ title: "Replacement" });
    expect(await read()).not.toHaveProperty("finishedAt");
    await expect(
      t.run(async (raw) => {
        await metadataContext(raw).db.patch(id, { title: "Rolled back" });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await read()).toMatchObject({ title: "Replacement" });
    await t.run((raw) => metadataContext(raw).db.delete(id));
    expect(await read()).toBeNull();
  });

  it("characterizes the trigger writer byte cost and keeps a four-row near-limit deletion batch atomic", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    for (let i = 0; i < 6; i++)
      await t.run((raw) =>
        metadataContext(raw).db.insert("articles", {
          ...article("default_user", `Delete ${i}`),
          content: "x".repeat(990_000),
        }),
      );
    // Operational raw patches fit; the trigger helper additionally reads its
    // before/after documents, even when the projection does not change.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("articles").take(6);
      for (const row of rows)
        await ctx.db.patch(row._id, { reannotateClaimedAt: 1 });
    });
    await expect(
      t.run(async (ctx) => {
        const rows = await ctx.db.query("articles").take(6);
        for (const row of rows) await ctx.db.delete(row._id);
        throw new Error("rollback successful raw-delete control");
      }),
    ).rejects.toThrow("rollback successful raw-delete control");
    await expect(
      t.run(async (raw) => {
        const ctx = metadataContext(raw);
        const rows = await ctx.db.query("articles").take(6);
        for (const row of rows) await ctx.db.delete(row._id);
      }),
    ).rejects.toThrow("Read too much data");
    expect(
      await t.run((ctx) => ctx.db.query("articleMetadata").collect()),
    ).toHaveLength(6);
    for (let i = 0; i < 2; i++)
      await t.run(async (raw) => {
        const ctx = metadataContext(raw);
        const rows = await ctx.db.query("articles").take(4);
        for (const row of rows) await ctx.db.delete(row._id);
      });
    expect(
      await t.run((ctx) => ctx.db.query("articleMetadata").collect()),
    ).toEqual([]);
  });

  it("has truthful legacy ownership before/during/after resumable backfill, including write/delete races", async () => {
    const f = await secondReaderTest(modules);
    const ids = await f.t.run(async (ctx) => {
      const result = [];
      for (let i = 0; i < 14; i++)
        result.push(
          await ctx.db.insert(
            "articles",
            article("default_user", `Legacy ${i}`),
          ),
        );
      return result;
    });
    expect(
      (
        await f.owner.query(api.articleMetadata.headers, {
          articleIds: [ids[13]],
        })
      )[0].article?.title,
    ).toBe("Legacy 13");
    expect(
      (
        await f.reader.query(api.articleMetadata.headers, {
          articleIds: [ids[13]],
        })
      )[0].article,
    ).toBeNull();
    await f.t.mutation(internal.articleMetadata.backfill, {
      userId: "default_user",
    });
    await Promise.all([
      f.t.run((raw) =>
        metadataContext(raw).db.patch(ids[13], { title: "Concurrent title" }),
      ),
      f.t.mutation(internal.articleMetadata.backfill, {
        userId: "default_user",
      }),
    ]);
    await Promise.all([
      f.t.run((raw) => metadataContext(raw).db.delete(ids[0])),
      f.t.mutation(internal.articleMetadata.backfill, {
        userId: "default_user",
      }),
    ]);
    await migrate(f.t);
    expect(
      (
        await f.owner.query(api.articleMetadata.headers, {
          articleIds: [ids[0], ids[13]],
        })
      ).map((r) => r.article?.title ?? null),
    ).toEqual([null, "Concurrent title"]);
    const rows = await f.t.run((ctx) =>
      ctx.db.query("articleMetadata").collect(),
    );
    expect(rows).toHaveLength(13);
    expect(new Set(rows.map((r) => r.articleId)).size).toBe(13);
  });

  it("pauses disabled readers' migration and fences deleting or already-purged readers", async () => {
    const f = await secondReaderTest(modules);
    await f.t.run((ctx) =>
      ctx.db.insert("articles", article(f.readerLibraryId)),
    );
    await f.t.mutation(internal.articleMetadata.backfill, {
      userId: f.readerLibraryId,
    });
    await f.t.run(async (raw) => {
      const ctx = metadataContext(raw);
      for (let i = 0; i < 128; i++)
        await ctx.db.insert(
          "articles",
          article(f.readerLibraryId, `Purge ${i}`),
        );
    });
    const reader = await f.t.run((ctx) => ctx.db.query("readers").first());
    if (!reader) throw new Error("reader fixture missing");
    await expect(
      f.t.run((ctx) => purgeArticleMetadata(ctx, f.readerLibraryId)),
    ).rejects.toThrow("retained library");
    await f.t.run((ctx) => ctx.db.patch(reader._id, { status: "disabled" }));
    await expect(
      f.reader.query(api.articleMetadata.headers, { articleIds: [] }),
    ).rejects.toThrow("Sign in");
    expect(
      await f.t.mutation(internal.articleMetadata.backfill, {
        userId: f.readerLibraryId,
      }),
    ).toMatchObject({ inactive: true });
    await expect(
      f.t.run((ctx) => purgeArticleMetadata(ctx, f.readerLibraryId)),
    ).rejects.toThrow("retained library");
    await f.t.run((ctx) =>
      ctx.db.patch(reader._id, { status: "active", deletingAt: 1 }),
    );
    expect(
      await f.t.mutation(internal.articleMetadata.backfill, {
        userId: f.readerLibraryId,
      }),
    ).toMatchObject({ inactive: true });
    expect(
      await f.t.run((ctx) => purgeArticleMetadata(ctx, f.readerLibraryId)),
    ).toBe(64);
    expect(
      await f.t.run((ctx) => ctx.db.query("articleMetadata").collect()),
    ).toHaveLength(65);
    for (let i = 0; i < 10; i++)
      if (
        (await f.t.run((ctx) =>
          purgeArticleMetadata(ctx, f.readerLibraryId),
        )) === 0
      )
        break;
    await f.t.run((ctx) => ctx.db.delete(reader._id));
    expect(
      await f.t.mutation(internal.articleMetadata.backfill, {
        userId: f.readerLibraryId,
      }),
    ).toMatchObject({ inactive: true });
    expect(
      await f.t.run((ctx) => ctx.db.query("articleMetadata").collect()),
    ).toEqual([]);
  });

  it("keeps retained disabled libraries coherent without authorizing them or running their backfill", async () => {
    const f = await secondReaderTest(modules);
    await f.t.run((ctx) => initializeEmptyMetadata(ctx, f.readerLibraryId));
    const id = await f.t.run((raw) =>
      metadataContext(raw).db.insert("articles", article(f.readerLibraryId)),
    );
    const reader = await f.t.run((ctx) => ctx.db.query("readers").first());
    if (!reader) throw new Error("reader fixture missing");
    await f.t.run((ctx) => ctx.db.patch(reader._id, { status: "disabled" }));
    await expect(
      f.reader.query(api.articleMetadata.counts, {}),
    ).rejects.toThrow("Sign in");
    expect(
      await f.t.mutation(internal.articleMetadata.backfill, {
        userId: f.readerLibraryId,
      }),
    ).toMatchObject({ inactive: true });
    await f.t.run(async (raw) => {
      const ctx = metadataContext(raw);
      await ctx.db.patch(id, { title: "Late acknowledged title" });
      await ctx.db.insert("savedArticles", {
        userId: f.readerLibraryId,
        articleId: id,
        savedAt: 1,
      });
    });
    await f.t.run((ctx) => ctx.db.patch(reader._id, { status: "active" }));
    expect(await f.reader.query(api.articleMetadata.counts, {})).toEqual({
      ready: true,
      saved: 1,
      loved: 0,
    });
    expect(
      (
        await f.reader.query(api.articleMetadata.headers, { articleIds: [id] })
      )[0].article?.title,
    ).toBe("Late acknowledged title");
  });

  it("uses one fallback budget across nested identity helpers, never a false not-owned result", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const ids: Id<"articles">[] = [];
    for (let i = 0; i < 12; i++)
      ids.push(
        await t.run((ctx) =>
          ctx.db.insert("articles", {
            ...article("default_user", `old ${i}`),
            content: "x".repeat(990_000),
          }),
        ),
      );
    await expect(
      t.run(async (ctx) => {
        for (const id of ids) await ownedArticleCard(ctx, id, "default_user");
      }),
    ).rejects.toThrow("read budget");
  });

  it("pins existing opaque and versioned pagination cursors to their physical source across readiness", async () => {
    const t = await ownerTest(modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 12; i++)
        await ctx.db.insert("articles", article("default_user", `Cursor ${i}`));
    });
    const raw = await t.run((ctx) =>
      ctx.db
        .query("articles")
        .withIndex("by_user_finishedAt", (q) =>
          q.eq("userId", "default_user").eq("finishedAt", undefined),
        )
        .order("desc")
        .paginate({ cursor: null, numItems: 4 }),
    );
    const first = await t.query(api.home.upNextPage, {
      paginationOpts: { cursor: null, numItems: 4 },
    });
    const window = await t.query(api.suggestions.moreForWindow, {
      requestedMinutes: 10,
      paginationOpts: { cursor: null, numItems: 4 },
    });
    await migrate(t);
    const second = await t.query(api.home.upNextPage, {
      paginationOpts: { cursor: raw.continueCursor, numItems: 4 },
    });
    const pinned = await t.query(api.home.upNextPage, {
      paginationOpts: {
        cursor: null,
        endCursor: first.continueCursor,
        numItems: 4,
      },
    });
    expect(second.continueCursor).toContain("legacy");
    expect(pinned.continueCursor).toContain("legacy");
    expect(pinned.page.map((r) => r._id)).toEqual(first.page.map((r) => r._id));
    expect(
      new Set([...first.page, ...second.page].map((r) => r._id)).size,
    ).toBe(8);
    const newPage = await t.query(api.home.upNextPage, {
      paginationOpts: { cursor: null, numItems: 4 },
    });
    expect(newPage.continueCursor).toContain("metadata");
    expect(newPage.page.map((r) => r._id)).toEqual(
      first.page.map((r) => r._id),
    );
    const nextWindow = await t.query(api.suggestions.moreForWindow, {
      requestedMinutes: 10,
      paginationOpts: { cursor: window.continueCursor, numItems: 4 },
    });
    expect(nextWindow.continueCursor).toContain("legacy");
    expect(
      new Set([...window.page, ...nextWindow.page].map((r) => r._id)).size,
    ).toBe(8);
  });

  it("backfills near-limit outlines/parts in bounded pages and offers only the next book part", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    t.registerComponent(
      "betterAuth",
      authSchema,
      import.meta.glob("./betterAuth/**/*.ts"),
    );
    const { client, libraryId } = await addReader(t, {
      email: "book-byte-reader@example.com",
    });
    const id = await t.run((ctx) =>
      ctx.db.insert("articles", {
        ...article(libraryId),
        annotationStatus: "skipped",
        bookUnitCount: 3200,
        bookOutline: Array.from({ length: 3200 }, () => ({
          title: "Long outline heading ".repeat(10),
          minutes: 4,
        })),
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("books", {
        userId: libraryId,
        articleId: id,
        unitCount: 3200,
        finishedThrough: 1,
        furthestUnit: 1,
        furthestScroll: 95,
        finished: false,
        createdAt: 1,
      });
      for (let index = 0; index < 3; index++)
        await ctx.db.insert("bookUnits", {
          userId: libraryId,
          articleId: id,
          index,
          title: `Part ${index}`,
          content: "x".repeat(990_000),
          contentHtml: "",
          wordCount: 880,
          estimatedReadMinutes: 4,
          annotationStatus: "deferred",
        });
    });
    await migrate(t, libraryId);
    const picks = await client.query(api.suggestions.forWindow, {
      requestedMinutes: 5,
    });
    expect(picks[0]).toMatchObject({
      book: { unitIndex: 2, unitTitle: "Part 2" },
    });
    const card = await t.run((ctx) => ctx.db.query("articleMetadata").first());
    expect(card).not.toHaveProperty("bookOutline");
    expect(card).not.toHaveProperty("content");
    expect(JSON.stringify(card).length).toBeLessThan(2000);
  });
});

describe("exact stored shelf membership counts", () => {
  it("does not change memberships on finish/unread, and decrements through the actual feed-removal helper", async () => {
    const t = await ownerTest(modules);
    const id = await t.run((raw) =>
      metadataContext(raw).db.insert("articles", article()),
    );
    await migrate(t);
    await t.mutation(api.savedArticles.save, { articleId: id });
    await t.mutation(api.lovedArticles.love, { articleId: id });
    await t.mutation(api.articles.archive, { articleId: id });
    await t.mutation(api.articles.restore, { articleId: id });
    expect(await t.query(api.articleMetadata.counts, {})).toEqual({
      ready: true,
      saved: 1,
      loved: 1,
    });
    await t.run(async (raw) => {
      const ctx = metadataContext(raw);
      const row = await ctx.db.get(id);
      if (!row) throw new Error("article fixture missing");
      await deleteArticle(ctx, row);
    });
    await finishArticleRemoval(t, id);
    expect(await t.query(api.articleMetadata.counts, {})).toEqual({
      ready: true,
      saved: 0,
      loved: 0,
    });
    expect(
      (await t.query(api.articleMetadata.headers, { articleIds: [id] }))[0]
        .article,
    ).toBeNull();
  });
  it("counts beyond the old bound, includes missing/foreign rows, and stays exact across initialization and retries", async () => {
    const f = await secondReaderTest(modules);
    const [own, foreign, removed] = await f.t.run(async (raw) => {
      const ctx = metadataContext(raw);
      return Promise.all([
        ctx.db.insert("articles", article()),
        ctx.db.insert("articles", article(f.readerLibraryId)),
        ctx.db.insert("articles", article("default_user", "removed")),
      ]);
    });
    await f.owner.mutation(api.savedArticles.save, { articleId: own });
    await f.owner.mutation(api.lovedArticles.love, { articleId: own });
    await f.t.run(async (raw) => {
      const ctx = metadataContext(raw);
      await ctx.db.delete(removed);
      // Historical duplicates are eligible stored memberships, not hydrated cards.
      for (let i = 0; i < 2017; i++) {
        await raw.db.insert("savedArticles", {
          userId: "default_user",
          articleId: i % 2 ? foreign : removed,
          savedAt: i,
        });
        await raw.db.insert("lovedArticles", {
          userId: "default_user",
          articleId: i % 2 ? foreign : removed,
          lovedAt: i,
          reviewIndex: 0,
          nextReviewAt: 1,
          reviewCount: 0,
        });
      }
    });
    expect(await f.owner.query(api.articleMetadata.counts, {})).toEqual({
      ready: false,
      saved: null,
      loved: null,
    });
    await f.t.mutation(internal.articleMetadata.backfill, {
      userId: "default_user",
    });
    await Promise.all([
      f.owner.mutation(api.savedArticles.save, { articleId: own }),
      f.owner.mutation(api.savedArticles.save, { articleId: own }),
    ]);
    await f.owner.mutation(api.lovedArticles.love, { articleId: own });
    await migrate(f.t);
    expect(await f.owner.query(api.articleMetadata.counts, {})).toEqual({
      ready: true,
      saved: 2018,
      loved: 2018,
    });
    expect(await f.owner.query(api.savedArticles.count, {})).toBe(2018);
    expect(
      await f.owner.query(api.savedArticles.isSaved, { articleId: own }),
    ).toBe(true);
    expect(await f.owner.query(api.savedArticles.savedIds, {})).not.toContain(
      own,
    );
    expect(
      await f.reader.query(api.savedArticles.isSaved, { articleId: own }),
    ).toBe(false);
    expect(await f.owner.query(api.lovedArticles.count, {})).toBe(2018);
    await Promise.all([
      f.owner.mutation(api.savedArticles.unsave, { articleId: own }),
      f.owner.mutation(api.savedArticles.unsave, { articleId: own }),
    ]);
    await f.owner.mutation(api.lovedArticles.unlove, { articleId: own });
    await f.owner.mutation(api.savedArticles.unsave, { articleId: removed });
    await f.owner.mutation(api.lovedArticles.unlove, { articleId: foreign });
    expect(await f.owner.query(api.articleMetadata.counts, {})).toEqual({
      ready: true,
      saved: 2016,
      loved: 2016,
    });
    expect(await f.reader.query(api.articleMetadata.counts, {})).toEqual({
      ready: false,
      saved: null,
      loved: null,
    });
  });
});
