/// <reference types="vite/client" />

import type { FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadataContext } from "../test/metadata";
import {
  addReader,
  ownerTest,
  runScheduled,
  saveTestCredential,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import authSchema from "./betterAuth/schema";
import { BATCH_DELAY_MS, JOB_STAGGER_MS, PAGE } from "./catchUp";
import { articleProjection } from "./lib/articleMetadata";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const article = (userId: string, title: string, content = "ordinary text") => ({
  userId,
  title,
  content,
  guid: title,
  url: `https://example.com/${title}`,
  extractionStatus: "extracted" as const,
  annotationStatus: "annotated" as const,
  estimatedReadMinutes: 5,
  wordCount: 800,
  createdAt: 1,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function migrate(
  t: Pick<ReturnType<typeof convexTest>, "mutation">,
  userId: string,
) {
  for (let i = 0; i < 100; i++)
    if (
      (await t.mutation(internal.articleMetadata.backfill, { userId })).complete
    )
      return;
  throw new Error("fixture migration did not complete");
}

function limitedTest(customModules = modules) {
  const t = convexTest({
    schema,
    modules: customModules,
    transactionLimits: true,
  });
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("./betterAuth/**/*.ts"),
  );
  return t;
}

describe("mixed-version library availability", () => {
  it("breaks equal source-time candidate ties by article identity, not derived insertion order", async () => {
    const t = await ownerTest(modules);
    const ids: Id<"articles">[] = [];
    for (let i = 0; i < 20; i++)
      ids.push(
        await t.run((ctx) =>
          ctx.db.insert("articles", article(OWNER, `Tie ${i}`)),
        ),
      );
    const expectedPool = [...ids].sort().reverse().slice(0, 12);
    const saved = expectedPool[10];
    await t.run(async (ctx) => {
      // A historical snapshot can contain equal creation times. Insert the
      // winning source ID first so derived insertion order would exclude it.
      for (const id of [saved, ...ids.filter((id) => id !== saved)]) {
        const source = await ctx.db.get(id);
        if (!source) throw new Error("missing source");
        await ctx.db.insert(
          "articleMetadata",
          articleProjection({ ...source, _creationTime: 1 }),
        );
      }
      await ctx.db.insert("libraryMetadataState", {
        userId: OWNER,
        articlesReady: true,
        phase: "done",
        cursor: null,
      });
      await ctx.db.insert("savedArticles", {
        userId: OWNER,
        articleId: saved,
        shelfCounted: true,
        savedAt: 1,
      });
      await ctx.db.insert("shelfCounts", {
        userId: OWNER,
        saved: 1,
        loved: 0,
        ready: true,
      });
    });
    expect(
      (await t.query(api.suggestions.forWindow, { requestedMinutes: 5 }))[0]
        ._id,
    ).toBe(saved);
  });
  it("bounds cumulative legacy range bytes without losing paged near-limit articles", async () => {
    const t = limitedTest();
    const { client, libraryId } = await addReader(t, {
      email: "legacy-range-bytes@example.com",
    });
    const ids: Id<"articles">[] = [];
    for (let i = 0; i < 16; i++)
      ids.push(
        await t.run((ctx) =>
          ctx.db.insert(
            "articles",
            article(libraryId, `Large legacy ${i}`, "x".repeat(990_000)),
          ),
        ),
      );
    await expect(
      client.query(api.suggestions.forWindow, { requestedMinutes: 5 }),
    ).rejects.toThrow("read budget");
    const seen: Id<"articles">[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: FunctionReturnType<typeof api.home.upNextPage> =
        await client.query(api.home.upNextPage, {
          paginationOpts: { cursor, numItems: 8 },
        });
      seen.push(...page.page.map((row) => row._id));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(seen).toHaveLength(16);
    expect(new Set(seen)).toEqual(new Set(ids));
  });
  it("keeps all twelve ordinary candidates and unfinished books available before, during and after migration", async () => {
    const t = await ownerTest(modules);
    const ids = await t.run(async (ctx) => {
      const ids: Id<"articles">[] = [];
      for (let i = 0; i < 40; i++)
        ids.push(
          await ctx.db.insert("articles", article(OWNER, `Legacy ${i}`)),
        );
      await ctx.db.insert("savedArticles", {
        userId: OWNER,
        articleId: ids[29],
        savedAt: 1,
      });
      for (let i = 0; i < 3; i++) {
        const id = await ctx.db.insert("articles", {
          ...article(OWNER, `Book ${i}`),
          annotationStatus: "skipped",
          bookUnitCount: 1,
          bookOutline: [{ title: "Next part", minutes: 4 }],
        });
        await ctx.db.insert("books", {
          userId: OWNER,
          articleId: id,
          unitCount: 1,
          finishedThrough: -1,
          furthestUnit: -1,
          furthestScroll: 0,
          finished: false,
          createdAt: 1,
        });
        await ctx.db.insert("bookUnits", {
          userId: OWNER,
          articleId: id,
          index: 0,
          title: "Next part",
          estimatedReadMinutes: 4,
          wordCount: 800,
          content: "book text",
          contentHtml: "<p>book text</p>",
          annotationStatus: "deferred",
        });
      }
      return ids;
    });
    const check = async () => {
      const picks = await t.query(api.suggestions.forWindow, {
        requestedMinutes: 5,
      });
      // This saved candidate is eleventh in the twelve-row descending range.
      expect(picks[0]._id).toBe(ids[29]);
      expect(
        (
          await t.query(api.home.upNextPage, {
            paginationOpts: { cursor: null, numItems: 8 },
          })
        ).page,
      ).toHaveLength(11);
      expect((await t.query(api.home.overview, {})).upNext).toHaveLength(10);
      expect(
        await t.query(api.articleMetadata.headers, {
          articleIds: ids.slice(0, 8),
        }),
      ).toHaveLength(8);
      expect(
        await t.query(internal.library.loadArticles, {
          userId: OWNER,
          articleIds: ids,
        }),
      ).toHaveLength(40);
      return picks;
    };
    const before = await check();
    await t.mutation(internal.articleMetadata.backfill, { userId: OWNER });
    expect(await check()).toEqual(before);
    while (
      !(await t.run((ctx) => ctx.db.query("libraryMetadataState").first()))
        ?.articlesReady
    )
      await t.mutation(internal.articleMetadata.backfill, { userId: OWNER });
    expect(await check()).toEqual(before);
    await migrate(t, OWNER);
    expect(await check()).toEqual(before);
  });

  it("resolves valid oversized original URLs/GUIDs only for deferred cards and does not collapse distinct links", async () => {
    const t = await ownerTest(modules);
    const prefix = `https://example.com/article?q=${"a".repeat(9000)}`;
    const urls = [`${prefix}one`, `${prefix}two`, `${prefix}one`];
    const guids = urls.map((_, i) => `${"identity".repeat(1200)}${i}`);
    const ids = [];
    for (let i = 0; i < urls.length; i++)
      ids.push(
        await t.run((raw) =>
          metadataContext(raw).db.insert("articles", {
            ...article(OWNER, `Long link ${i}`),
            url: urls[i],
            guid: guids[i],
          }),
        ),
      );
    await migrate(t, OWNER);
    const stored = await t.run((ctx) =>
      ctx.db.query("articleMetadata").collect(),
    );
    expect(
      stored.every(
        (row) =>
          row.url === "" &&
          row.guid === "" &&
          row.urlDeferred &&
          row.guidDeferred,
      ),
    ).toBe(true);
    const matches = await t.query(api.titleSearch.matchTitles, {
      query: "Long link",
    });
    expect(matches).toHaveLength(2);
    expect(new Set(matches.map((row) => row.url))).toEqual(new Set(urls));
    const cards = await t.query(internal.library.loadArticles, {
      userId: OWNER,
      articleIds: ids,
    });
    expect(cards.map((row) => row?.guid)).toEqual(guids);
    expect(cards.map((row) => row?._id)).toEqual(ids);
    expect(
      (await t.query(api.articleMetadata.headers, { articleIds: ids })).map(
        (row) => row.article?.url,
      ),
    ).toEqual(urls);
    expect(
      (await t.query(api.articles.getById, { articleId: ids[0] }))?.guid,
    ).toBe(guids[0]);
  });

  it.each([
    "savedArticles",
    "lovedArticles",
  ] as const)("preserves %s contribution when generic replacement omits its derived marker", async (shelf) => {
    const t = await ownerTest(modules);
    const id = await t.run((raw) =>
      metadataContext(raw).db.insert(
        "articles",
        article(OWNER, "Replace membership"),
      ),
    );
    await migrate(t, OWNER);
    if (shelf === "savedArticles")
      await t.mutation(api.savedArticles.save, { articleId: id });
    else await t.mutation(api.lovedArticles.love, { articleId: id });
    await t.run(async (raw) => {
      const row = await raw.db.query(shelf).first();
      if (!row) throw new Error("missing membership");
      const { _id, _creationTime, shelfCounted, ...fields } = row;
      await metadataContext(raw).db.replace(_id, fields);
    });
    expect(
      (await t.run((ctx) => ctx.db.query(shelf).first()))?.shelfCounted,
    ).toBe(true);
    if (shelf === "savedArticles")
      await t.mutation(api.savedArticles.unsave, { articleId: id });
    else await t.mutation(api.lovedArticles.unlove, { articleId: id });
    expect(await t.query(api.articleMetadata.counts, {})).toEqual({
      ready: true,
      saved: 0,
      loved: 0,
    });
  });

  it.each([
    "savedArticles",
    "lovedArticles",
  ] as const)("moves %s contribution exactly once on generic ownership replacement", async (shelf) => {
    const f = await secondReaderTest(modules);
    const id = await f.t.run((raw) =>
      metadataContext(raw).db.insert(
        "articles",
        article(OWNER, "Transfer membership"),
      ),
    );
    await migrate(f.t, OWNER);
    if (shelf === "savedArticles")
      await f.owner.mutation(api.savedArticles.save, { articleId: id });
    else await f.owner.mutation(api.lovedArticles.love, { articleId: id });
    await f.t.run(async (raw) => {
      const row = await raw.db.query(shelf).first();
      if (!row) throw new Error("missing membership");
      const { _id, _creationTime, shelfCounted, ...fields } = row;
      await metadataContext(raw).db.replace(_id, {
        ...fields,
        userId: f.readerLibraryId,
      });
    });
    await migrate(f.t, f.readerLibraryId);
    expect(await f.owner.query(api.articleMetadata.counts, {})).toEqual({
      ready: true,
      saved: 0,
      loved: 0,
    });
    expect(await f.reader.query(api.articleMetadata.counts, {})).toEqual({
      ready: true,
      saved: shelf === "savedArticles" ? 1 : 0,
      loved: shelf === "lovedArticles" ? 1 : 0,
    });
    if (shelf === "savedArticles")
      await f.reader.mutation(api.savedArticles.unsave, { articleId: id });
    else await f.reader.mutation(api.lovedArticles.unlove, { articleId: id });
    expect(await f.reader.query(api.articleMetadata.counts, {})).toEqual({
      ready: true,
      saved: 0,
      loved: 0,
    });
  });
});

describe("scheduled body-writer budgets", () => {
  it("does not bunch paid jobs when a claim continuation is delayed", async () => {
    const t = limitedTest();
    const { libraryId } = await addReader(t, {
      email: "delayed-claims@example.com",
    });
    await saveTestCredential(
      t,
      libraryId,
      "openrouter",
      "fixture-openrouter-key",
    );
    for (let i = 0; i < PAGE; i++)
      await t.run((ctx) =>
        ctx.db.insert("articles", article(libraryId, `Delayed ${i}`)),
      );
    await migrate(t, libraryId);
    const start = Date.now();
    await t.mutation(internal.reannotateBackfill.start, { userId: libraryId });
    await t.mutation(internal.reannotateBackfill.step, {
      userId: libraryId,
      runId: 1,
    });
    vi.setSystemTime(start + 20_000);
    await t.mutation(internal.reannotateBackfill.step, {
      userId: libraryId,
      runId: 1,
    });
    await t.mutation(internal.reannotateBackfill.step, {
      userId: libraryId,
      runId: 1,
    });
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(100),
    );
    expect(
      jobs
        .filter((job) => job.name.includes("generateForArticle"))
        .map((job) => job.scheduledTime)
        .sort((a, b) => a - b),
    ).toEqual([start, start + 20_000, start + 20_000 + JOB_STAGGER_MS]);
    for (let i = 3; i < PAGE; i++)
      await t.mutation(internal.reannotateBackfill.step, {
        userId: libraryId,
        runId: 1,
      });
    const state = await t.run((ctx) => ctx.db.query("reannotateState").first());
    expect(state?.nextBatchAt).toBe(
      start + 20_000 - JOB_STAGGER_MS + BATCH_DELAY_MS,
    );
  });
  it("initializes near-limit queue rows and mirrors historical finishes after metadata is already ready", async () => {
    const t = limitedTest();
    const { client, libraryId } = await addReader(t, {
      email: "queue-bytes@example.com",
    });
    const finished: Id<"articles">[] = [];
    for (let i = 0; i < 13; i++)
      await t.run(async (ctx) => {
        const id = await ctx.db.insert(
          "articles",
          article(libraryId, `Queue ${i}`, "x".repeat(990_000)),
        );
        if (i % 3 === 0) {
          finished.push(id);
          await ctx.db.insert("articleInteractions", {
            userId: libraryId,
            articleId: id,
            action: "finished",
            annotationsOpened: ["f".repeat(900_000)],
            createdAt: 42,
          });
        }
      });
    await migrate(t, libraryId);
    await t.mutation(internal.readingQueue.initialize, { userId: libraryId });
    await runScheduled(t);
    const stats = await t.run((ctx) =>
      ctx.db.query("readingQueueStats").first(),
    );
    expect(stats).toMatchObject({ ready: true, annotated: 13, waiting: 8 });
    const cards = await t.run((ctx) =>
      ctx.db.query("articleMetadata").collect(),
    );
    expect(
      cards
        .filter((row) => row.finishedAt === 42)
        .map((row) => row.articleId)
        .sort(),
    ).toEqual(finished.sort());
    const picks = await client.query(api.suggestions.forWindow, {
      requestedMinutes: 5,
    });
    expect(picks.every((row) => !finished.includes(row._id))).toBe(true);
  });

  it("removes feed articles through scheduled pages without deleting large protected user material", async () => {
    const t = limitedTest();
    const { client, libraryId } = await addReader(t, {
      email: "feed-bytes@example.com",
    });
    const feedId = await client.mutation(api.feeds.add, {
      url: "https://example.com/feed.xml",
      title: "Byte fixture",
    });
    const ids: Id<"articles">[] = [];
    for (let i = 0; i < 6; i++)
      ids.push(
        await t.run(async (ctx) => {
          const articleId = await ctx.db.insert("articles", {
            ...article(libraryId, `Feed ${i}`, "x".repeat(990_000)),
            feedId,
          });
          await ctx.db.insert("annotations", {
            userId: libraryId,
            articleId,
            type: "context",
            anchorText: "x",
            anchorStartOffset: 0,
            anchorEndOffset: 1,
            content: "a".repeat(900_000),
            relevanceScore: 1,
            wasViewed: false,
            wasDismissed: false,
            createdAt: 1,
          });
          return articleId;
        }),
      );
    const protectedId = ids[5];
    const noteIds = [];
    for (let i = 0; i < 20; i++)
      noteIds.push(
        await t.run((ctx) =>
          ctx.db.insert("userNotes", {
            userId: libraryId,
            articleId: protectedId,
            selectedText: "x",
            content: "n".repeat(900_000),
            contentPlain: "mine",
            createdAt: i,
            updatedAt: i,
          }),
        ),
      );
    await migrate(t, libraryId);
    for (const articleId of [ids[0], protectedId]) {
      await client.mutation(api.savedArticles.save, { articleId });
      await client.mutation(api.lovedArticles.love, { articleId });
    }
    await client.mutation(api.feeds.remove, { feedId, articles: "all" });
    await runScheduled(t);
    expect(
      (await t.run((ctx) => ctx.db.query("articles").collect())).map(
        (row) => row._id,
      ),
    ).toEqual([protectedId]);
    expect(await client.query(api.articleMetadata.counts, {})).toEqual({
      ready: true,
      saved: 1,
      loved: 1,
    });
    for (const id of noteIds)
      expect((await t.run((ctx) => ctx.db.get(id)))?.content.length).toBe(
        900_000,
      );
  });

  it.each([
    false,
    true,
  ])("claims near-limit reannotation rows in bounded transactions with unchanged provider windows (metadata=%s)", async (ready) => {
    const times: { articleId: Id<"articles">; at: number }[] = [];
    const scheduledModules = {
      ...modules,
      "./actions/generateAnnotations.ts": async () => ({
        generateForArticle: internalAction({
          args: { articleId: v.id("articles"), claim: v.optional(v.number()) },
          handler: async (_ctx, args) => {
            times.push({ articleId: args.articleId, at: Date.now() });
          },
        }),
      }),
    };
    const t = limitedTest(scheduledModules);
    const { libraryId } = await addReader(t, {
      email: "reannotate-bytes@example.com",
    });
    await saveTestCredential(
      t,
      libraryId,
      "openrouter",
      "fixture-openrouter-key",
    );
    const ids: Id<"articles">[] = [];
    for (let i = 0; i < PAGE + 3; i++)
      ids.push(
        await t.run((ctx) =>
          ctx.db.insert(
            "articles",
            article(libraryId, `Reannotate ${i}`, "x".repeat(990_000)),
          ),
        ),
      );
    const protectedId = await t.run((ctx) =>
      ctx.db.insert(
        "articles",
        article(libraryId, "Protected response", "x".repeat(990_000)),
      ),
    );
    const annotationId = await t.run((ctx) =>
      ctx.db.insert("annotations", {
        userId: libraryId,
        articleId: protectedId,
        type: "question",
        anchorText: "x",
        anchorStartOffset: 0,
        anchorEndOffset: 1,
        content: "question",
        relevanceScore: 1,
        wasViewed: false,
        wasDismissed: false,
        createdAt: 1,
      }),
    );
    for (let i = 0; i < 20; i++)
      await t.run((ctx) =>
        ctx.db.insert("userNotes", {
          userId: libraryId,
          articleId: protectedId,
          annotationId: i === 19 ? annotationId : undefined,
          selectedText: "x",
          content: "n".repeat(900_000),
          contentPlain: "mine",
          createdAt: i,
          updatedAt: i,
        }),
      );
    if (ready) await migrate(t, libraryId);
    expect(
      await t.mutation(internal.reannotateBackfill.start, {
        userId: libraryId,
      }),
    ).toBe("started");
    await runScheduled(t);
    expect(times.map((row) => row.articleId).sort()).toEqual(ids.sort());
    expect(new Set(times.map((row) => row.articleId)).size).toBe(PAGE + 3);
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(1000),
    );
    expect(jobs.every((job) => job.state.kind === "success")).toBe(true);
    const due = jobs
      .filter((job) => job.name.includes("generateForArticle"))
      .map((job) => job.scheduledTime)
      .sort((a, b) => a - b);
    expect(due).toHaveLength(PAGE + 3);
    for (let i = 1; i < due.length; i++)
      expect(due[i] - due[i - 1]).toBeGreaterThanOrEqual(JOB_STAGGER_MS);
    expect(due[PAGE] - due[0]).toBeGreaterThanOrEqual(BATCH_DELAY_MS);
    expect(
      await t.query(internal.reannotateBackfill.status, { userId: libraryId }),
    ).toMatchObject({ running: false, queued: PAGE + 3 });
  });
});
