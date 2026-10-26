/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerTest } from "../test/owner";
import { api, internal } from "./_generated/api";

vi.mock("./lib/router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/router")>()),
  embedForLibrary: vi.fn().mockResolvedValue(null),
}));
const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// A two-minute article: auto-finish needs the end plus 48s of active reading
async function fixture() {
  const t = await ownerTest(modules);
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: OWNER,
      guid: "archive",
      url: "https://example.com/archive",
      title: "Archive fixture",
      content: "Synthetic readable article.",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      estimatedReadMinutes: 2,
      readerDocumentId: "reader-1",
      createdAt: Date.now(),
    }),
  );
  return { t, articleId };
}

const startedAt = Date.now() - 120_000;

function visit(
  articleId: string,
  visitId: string,
  reading: { activeTimeMs: number; maxScrollPercent: number },
) {
  return {
    articleId,
    visitId,
    day: new Date(startedAt).toISOString().slice(0, 10),
    startedAt,
    updatedAt: startedAt + 100_000,
    activeTimeMs: reading.activeTimeMs,
    visibleTimeMs: reading.activeTimeMs,
    timeSpentMs: reading.activeTimeMs,
    maxScrollPercent: reading.maxScrollPercent,
    annotationsOpened: [],
  };
}

const VISIT_A = "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e";
const VISIT_B = "5b0f7a52-55a4-4f0e-8a51-0c1f3c9b2d61";

async function upNextIds(t: Awaited<ReturnType<typeof fixture>>["t"]) {
  return (await t.query(api.home.overview, {})).upNext.map((a) => a._id);
}

describe("auto-finish", () => {
  it("doesn't archive a quick skim to the bottom", async () => {
    const { t, articleId } = await fixture();
    await t.mutation(
      api.readingActivity.checkpoint,
      visit(articleId, VISIT_A, {
        activeTimeMs: 10_000,
        maxScrollPercent: 100,
      }),
    );
    expect(
      (await t.query(api.articles.getById, { articleId }))?.finishedAt,
    ).toBeUndefined();
    expect(await upNextIds(t)).toContain(articleId);
  });

  it("archives an article read to the end and counts it as finished", async () => {
    const { t, articleId } = await fixture();
    await t.mutation(
      api.readingActivity.checkpoint,
      visit(articleId, VISIT_A, { activeTimeMs: 50_000, maxScrollPercent: 96 }),
    );
    expect(
      (await t.query(api.articles.getById, { articleId }))?.finishedAt,
    ).toBeTypeOf("number");
    expect(await upNextIds(t)).not.toContain(articleId);
    expect(await t.query(api.articles.listUnread, {})).toEqual([]);
    const stats = await t.query(api.stats.getDashboard, {
      range: "7days",
      timeZone: "UTC",
    });
    expect(stats.thisWeek.articlesFinished).toBe(1);
  });

  it("adds reading time across visits", async () => {
    const { t, articleId } = await fixture();
    await t.mutation(
      api.readingActivity.checkpoint,
      visit(articleId, VISIT_A, { activeTimeMs: 30_000, maxScrollPercent: 50 }),
    );
    await t.mutation(
      api.readingActivity.checkpoint,
      visit(articleId, VISIT_B, {
        activeTimeMs: 30_000,
        maxScrollPercent: 100,
      }),
    );
    expect(
      (await t.query(api.articles.getById, { articleId }))?.finishedAt,
    ).toBeTypeOf("number");
  });

  it("keeps an article unread after Mark unread for the rest of that visit", async () => {
    const { t, articleId } = await fixture();
    const reading = { activeTimeMs: 50_000, maxScrollPercent: 100 };
    await t.mutation(
      api.readingActivity.checkpoint,
      visit(articleId, VISIT_A, reading),
    );
    await t.mutation(api.articles.restore, { articleId });
    await t.mutation(
      api.readingActivity.checkpoint,
      visit(articleId, VISIT_A, { ...reading, activeTimeMs: 60_000 }),
    );
    expect(
      (await t.query(api.articles.getById, { articleId }))?.finishedAt,
    ).toBeUndefined();
    expect(await upNextIds(t)).toContain(articleId);
  });
});

it("keeps a re-read article unread after Mark unread", async () => {
  const { t, articleId } = await fixture();
  await t.mutation(api.articles.archive, { articleId });
  const reading = { activeTimeMs: 50_000, maxScrollPercent: 100 };
  await t.mutation(
    api.readingActivity.checkpoint,
    visit(articleId, VISIT_A, reading),
  );
  await t.mutation(api.articles.restore, { articleId });
  await t.mutation(
    api.readingActivity.checkpoint,
    visit(articleId, VISIT_A, { ...reading, activeTimeMs: 60_000 }),
  );
  expect(
    (await t.query(api.articles.getById, { articleId }))?.finishedAt,
  ).toBeUndefined();
});

describe("manual archive", () => {
  it("leaves the queue without counting as read, and restores", async () => {
    const { t, articleId } = await fixture();
    await t.mutation(api.articles.archive, { articleId });
    expect(await upNextIds(t)).not.toContain(articleId);
    expect(await t.query(api.articles.listUnread, {})).toEqual([]);
    const stats = await t.query(api.stats.getDashboard, {
      range: "7days",
      timeZone: "UTC",
    });
    expect(stats.thisWeek.articlesFinished).toBe(0);

    await t.mutation(api.articles.restore, { articleId });
    expect(await upNextIds(t)).toContain(articleId);
  });

  it("keeps the queue counts in step", async () => {
    const { t, articleId } = await fixture();
    await t.mutation(internal.readingQueue.initialize, { userId: OWNER });
    await t.mutation(internal.readingQueue.initialize, { userId: OWNER });
    const waiting = async () => (await t.query(api.home.overview, {})).waiting;
    expect(await waiting()).toBe(1);
    await t.mutation(api.articles.archive, { articleId });
    await t.mutation(api.articles.archive, { articleId });
    expect(await waiting()).toBe(0);
    await t.mutation(api.articles.restore, { articleId });
    expect(await waiting()).toBe(1);
  });
});

describe("Reader archive sync", () => {
  it("archives articles that were archived in Reader since the last sync", async () => {
    vi.stubEnv("READWISE_TOKEN", "isolated-test-token");
    const lists: URL[] = [];
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      // Archive/restore moves scheduled by earlier tests can land here too
      if (!url.pathname.includes("/list/")) return new Response("{}");
      lists.push(url);
      return new Response(
        JSON.stringify({
          results: [
            { id: "reader-1", category: "article", parent_id: null },
            { id: "unknown", category: "article", parent_id: null },
          ],
          nextPageCursor: null,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const { t, articleId } = await fixture();
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("readwiseSyncState", {
        userId: OWNER,
        active: true,
        backfilledAt: now - 86_400_000,
        startedAt: now,
        updatedAfter: new Date(now - 3_600_000).toISOString(),
        phase: 4,
        pageProcessedIds: [],
        leaseUntil: 0,
        nextRunAt: 0,
        scanned: 0,
        imported: 0,
        linked: 0,
        skipped: 0,
        highlights: 0,
        updatedAt: now,
      }),
    );
    await t.action(internal.actions.readwiseSync.sync, { userId: OWNER });
    expect(lists).toHaveLength(1);
    expect(lists[0]?.searchParams.get("location")).toBe("archive");
    expect(lists[0]?.searchParams.has("withHtmlContent")).toBe(false);
    expect(
      (await t.query(api.articles.getById, { articleId }))?.finishedAt,
    ).toBeTypeOf("number");
    expect((await t.query(api.readwise.status, {})).progress).toMatchObject({
      active: false,
      phase: "Complete",
      imported: 0,
    });
  });
});
