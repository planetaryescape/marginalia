/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownerTest, secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { updateQueueStats } from "./readingQueue";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Records Reader API calls; the owner's token comes from the deployment. */
function stubReader(status = 204) {
  vi.stubEnv("READWISE_TOKEN", "isolated-test-token");
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${new URL(input).pathname}`);
      return new Response(null, { status });
    }),
  );
  return calls;
}
const OWNER = "default_user";

type Use =
  | "untouched"
  | "opened"
  | "finished"
  | "saved"
  | "highlighted"
  | "noted"
  | "inReader";

async function addArticle(
  ctx: MutationCtx,
  feedId: Id<"feeds">,
  use: Use,
  userId = OWNER,
) {
  const now = Date.now();
  const articleId = await ctx.db.insert("articles", {
    userId,
    feedId,
    guid: use,
    url: `https://example.com/${use}`,
    title: use,
    extractionStatus: "extracted",
    annotationStatus: "annotated",
    estimatedReadMinutes: 4,
    finishedAt: use === "finished" ? now : undefined,
    readerDocumentId: use === "inReader" ? "reader-1" : undefined,
    createdAt: now,
  });
  const article = await ctx.db.get("articles", articleId);
  if (article) await updateQueueStats(ctx, null, article);
  await ctx.db.insert("annotations", {
    articleId,
    userId,
    type: "context",
    anchorText: "a",
    anchorStartOffset: 0,
    anchorEndOffset: 1,
    content: "generated",
    relevanceScore: 1,
    wasViewed: false,
    wasDismissed: false,
    createdAt: now,
  });
  if (use === "opened")
    await ctx.db.insert("articleInteractions", {
      userId,
      articleId,
      action: "opened",
      createdAt: now,
    });
  if (use === "saved")
    await ctx.db.insert("savedArticles", { userId, articleId, savedAt: now });
  if (use === "highlighted")
    await ctx.db.insert("highlights", {
      userId,
      articleId,
      kind: "highlight",
      text: "a",
      createdAt: now,
    });
  if (use === "noted")
    await ctx.db.insert("userNotes", {
      userId,
      articleId,
      selectedText: "a",
      content: "mine",
      contentPlain: "mine",
      createdAt: now,
      updatedAt: now,
    });
  return articleId;
}

const USES: Use[] = [
  "untouched",
  "opened",
  "finished",
  "saved",
  "highlighted",
  "noted",
  "inReader",
];

async function fixture() {
  const t = await ownerTest(modules);
  const feedId = await t.run(async (ctx) => {
    const feedId = await ctx.db.insert("feeds", {
      userId: OWNER,
      url: "https://example.com/feed.xml",
      title: "Example",
      isActive: true,
      createdAt: Date.now(),
    });
    for (const use of USES) await addArticle(ctx, feedId, use);
    return feedId;
  });
  const remaining = () =>
    t.run(async (ctx) =>
      (await ctx.db.query("articles").collect()).map((a) => a.title).sort(),
    );
  const stats = () =>
    t.run((ctx) => ctx.db.query("readingQueueStats").unique());
  return { t, feedId, remaining, stats };
}

describe("removing a feed", () => {
  it("previews what each choice would delete", async () => {
    const { t, feedId } = await fixture();
    expect(await t.query(api.feeds.removalPreview, { feedId })).toEqual({
      total: 7,
      unread: 2,
      unreadInReader: 1,
      all: 5,
      allInReader: 1,
      partial: false,
    });
  });

  it("keeps every article by default", async () => {
    const { t, feedId, remaining } = await fixture();
    await t.mutation(api.feeds.remove, { feedId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await remaining()).toEqual([...USES].sort());
    expect(await t.query(api.feeds.list, {})).toEqual([]);
  });

  it("removes only articles never opened, with what was generated for them", async () => {
    stubReader();
    const { t, feedId, remaining, stats } = await fixture();
    const before = await stats();
    await t.mutation(api.feeds.remove, { feedId, articles: "unread" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await remaining()).toEqual(
      USES.filter((u) => u !== "untouched" && u !== "inReader").sort(),
    );
    expect(
      await t.run(
        async (ctx) => (await ctx.db.query("annotations").collect()).length,
      ),
    ).toBe(5);
    // Both were annotated and unfinished, so they were waiting
    expect((await stats())?.waiting).toBe((before?.waiting ?? 0) - 2);
    expect((await stats())?.annotated).toBe((before?.annotated ?? 0) - 2);
  });

  it("removes everything except articles with your highlights or notes", async () => {
    stubReader();
    const { t, feedId, remaining } = await fixture();
    await t.mutation(api.feeds.remove, { feedId, articles: "all" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await remaining()).toEqual(["highlighted", "noted"]);
    expect(
      await t.run(
        async (ctx) => (await ctx.db.query("savedArticles").collect()).length,
      ),
    ).toBe(0);
  });

  it("works through feeds with more articles than one page", async () => {
    const { t, feedId, remaining } = await fixture();
    await t.run(async (ctx) => {
      for (let i = 0; i < 45; i++) await addArticle(ctx, feedId, "untouched");
    });
    await t.mutation(api.feeds.remove, { feedId, articles: "all" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await remaining()).toEqual(["highlighted", "noted"]);
  });

  it("deletes removed articles from Readwise Reader too", async () => {
    const calls = stubReader();
    const { t, feedId } = await fixture();
    await t.mutation(api.feeds.remove, { feedId, articles: "unread" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toEqual(["DELETE /api/v3/delete/reader-1/"]);
  });

  it("retries a Reader delete that hit the rate limit", async () => {
    const calls = stubReader(429);
    const { t, feedId } = await fixture();
    await t.mutation(api.feeds.remove, { feedId, articles: "unread" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // Four tries per attempt inside the client, five scheduled attempts
    expect(calls.length).toBe(20);
  });

  it("won't let another reader remove or preview the feed", async () => {
    const { t, reader } = await secondReaderTest(modules);
    const feedId = await t.run((ctx) =>
      ctx.db.insert("feeds", {
        userId: OWNER,
        url: "https://example.com/feed.xml",
        title: "Example",
        isActive: true,
        createdAt: Date.now(),
      }),
    );
    expect(await reader.query(api.feeds.removalPreview, { feedId })).toBeNull();
    await expect(
      reader.mutation(api.feeds.remove, { feedId, articles: "all" }),
    ).rejects.toThrow("Feed not found");
  });
});
