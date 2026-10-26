/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { addReader } from "../test/owner";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import authSchema from "./betterAuth/schema";
import { articleUse, removes } from "./lib/feedRemoval";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("./betterAuth/**/*.ts"),
  );
  const { client, libraryId } = await addReader(t, {
    email: "preview-budget@example.com",
  });
  const feedId = await t.run((ctx) =>
    ctx.db.insert("feeds", {
      userId: libraryId,
      url: "https://example.com/feed",
      title: "Preview fixture",
      isActive: false,
      createdAt: 1,
    }),
  );
  const article = (content = "", userId = libraryId) =>
    t.run((ctx) =>
      ctx.db.insert("articles", {
        userId,
        feedId,
        guid: "fixture",
        url: "https://example.com/article",
        title: "Fixture",
        content,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        readerDocumentId: "fixture-reader-id",
        createdAt: 1,
      }),
    );
  const reflection = (
    articleId: Id<"articles">,
    text: string,
    answered = false,
  ) =>
    t.run((ctx) =>
      ctx.db.insert("reflections", {
        userId: libraryId,
        articleId,
        strongestPoint: text,
        weakestAssumption: "",
        credibleCounterview: "",
        questionForYou: "",
        userResponse: answered ? "" : undefined,
        createdAt: 1,
      }),
    );
  const preview = () =>
    client.run(async (ctx) => ({
      value: await ctx.runQuery(api.feeds.removalPreview, { feedId }),
      metrics: await ctx.meta.getTransactionMetrics(),
    }));
  return { t, client, libraryId, feedId, article, reflection, preview };
}

describe("byte-bounded unsubscribe preview", () => {
  it("opens on 18 near-limit multibyte articles without reading their combined bodies", async () => {
    const f = await fixture();
    for (let i = 0; i < 18; i++) {
      const id = await f.article("😀".repeat(247_500));
      if (i % 2 === 0)
        await f.t.run((ctx) =>
          ctx.db.patch(id, {
            content: undefined,
            bookUnitCount: 1,
            bookOutline: [{ title: "😀".repeat(247_500), minutes: 1 }],
          }),
        );
    }
    await f.t.run((ctx) =>
      ctx.db.patch(f.feedId, { description: "界".repeat(330_000) }),
    );
    const result = await f.preview();
    expect(result.value).toMatchObject({ partial: true });
    expect(result.value?.total).toBeGreaterThan(0);
    expect(result.value?.total).toBeLessThan(18);
    expect(result.value?.all).toBeGreaterThan(0);
    expect(result.value?.all).toBeLessThanOrEqual(result.value?.total ?? 0);
    expect(result.value?.unread).toBe(result.value?.all);
    expect(result.value?.allInReader).toBe(result.value?.all);
    expect(result.value?.unreadInReader).toBe(result.value?.unread);
    expect(result.metrics.bytesRead.used).toBeLessThan(10 * 1024 * 1024);
    console.info("feed-preview-large-articles", result);
    // The deployed preview's first step cannot fit this valid fixture.
    await expect(
      f.client.run((ctx) =>
        ctx.db
          .query("articles")
          .withIndex("by_feed", (q) => q.eq("feedId", f.feedId))
          .take(301),
      ),
    ).rejects.toThrow("Read too much data");
  });

  it("does not count a protected article when an answered reflection is beyond the byte cutoff", async () => {
    const f = await fixture();
    const id = await f.article("😀".repeat(247_500));
    for (let i = 0; i < 18; i++) await f.reflection(id, "界".repeat(330_000));
    await f.reflection(id, "last", true);
    const result = await f.preview();
    expect(result.value).toEqual({
      total: 1,
      unread: 0,
      unreadInReader: 0,
      all: 0,
      allInReader: 0,
      partial: true,
    });
    expect(result.metrics.bytesRead.used).toBeLessThan(10 * 1024 * 1024);
    console.info("feed-preview-long-protected-reflections", result);
    await expect(
      f.client.run(async (ctx) => {
        const source = await ctx.db.get(id);
        if (!source) throw new Error("Missing fixture source");
        return articleUse(ctx, source);
      }),
    ).rejects.toThrow("Read too much data");
  });

  it("cuts off a long small-row child scan rather than claiming the unscanned answer is absent", async () => {
    const f = await fixture();
    const id = await f.article();
    // Separate fixture writes also stay inside the production row/write limits.
    for (let batch = 0; batch < 8; batch++)
      await f.t.run(async (ctx) => {
        for (let i = 0; i < 500; i++)
          await ctx.db.insert("reflections", {
            userId: f.libraryId,
            articleId: id,
            strongestPoint: "",
            weakestAssumption: "",
            credibleCounterview: "",
            questionForYou: "",
            createdAt: 1,
          });
      });
    await f.reflection(id, "", true);
    expect((await f.preview()).value).toMatchObject({
      total: 1,
      all: 0,
      unread: 0,
      partial: true,
    });
  });

  it("keeps the 300-row boundary and exact legacy counts for representable inputs", async () => {
    const f = await fixture();
    const ids: Id<"articles">[] = [];
    for (let i = 0; i < 300; i++) ids.push(await f.article());
    await f.t.run(async (ctx) => {
      await ctx.db.insert("savedArticles", {
        userId: f.libraryId,
        articleId: ids[0],
        savedAt: 1,
      });
      await ctx.db.insert("articleInteractions", {
        userId: f.libraryId,
        articleId: ids[1],
        action: "opened",
        createdAt: 1,
      });
      await ctx.db.insert("userNotes", {
        userId: f.libraryId,
        articleId: ids[2],
        selectedText: "",
        content: "😀".repeat(247_500),
        contentPlain: "mine",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("companionThreads", {
        userId: f.libraryId,
        articleId: ids[3],
        mode: "ask",
        selection: "",
        turns: [{ role: "user", content: "界".repeat(330_000) }],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("impressions", {
        userId: f.libraryId,
        articleId: ids[4],
        tags: [],
        note: "mine",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await f.reflection(ids[5], "generated");
    await f.reflection(ids[5], "generated", true);
    const expected = {
      total: 300,
      all: 296,
      allInReader: 296,
      unread: 294,
      unreadInReader: 294,
      partial: false,
    };
    expect((await f.preview()).value).toEqual(expected);
    // Independent legacy implementation on the same unchanged fixture.
    const legacy = await f.client.run(async (ctx) => {
      let all = 0;
      let unread = 0;
      for (const id of ids) {
        const source = await ctx.db.get(id);
        if (!source) throw new Error("Missing fixture source");
        const use = await articleUse(ctx, source);
        if (removes("all", use)) all++;
        if (removes("unread", use)) unread++;
      }
      return { all, unread };
    });
    expect(legacy).toEqual({ all: expected.all, unread: expected.unread });
    await f.article();
    expect((await f.preview()).value).toEqual({ ...expected, partial: true });
  });

  it("returns exact empty counts, ignores foreign parents and observes new personal marks", async () => {
    const f = await fixture();
    expect((await f.preview()).value).toEqual({
      total: 0,
      all: 0,
      unread: 0,
      allInReader: 0,
      unreadInReader: 0,
      partial: false,
    });
    await f.article("", "another-library");
    const id = await f.article();
    expect((await f.preview()).value).toMatchObject({
      total: 1,
      all: 1,
      unread: 1,
      partial: false,
    });
    await f.reflection(id, "", true);
    expect((await f.preview()).value).toMatchObject({
      total: 1,
      all: 0,
      unread: 0,
      partial: false,
    });
    await f.t.run((ctx) => ctx.db.patch(id, { userId: "another-library" }));
    expect((await f.preview()).value).toMatchObject({
      total: 0,
      all: 0,
      unread: 0,
      partial: false,
    });
  });

  it.each([
    false,
    true,
  ])("denies disabled/deleting libraries (deleting=%s)", async (deleting) => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.libraryId))
        .unique();
      if (!reader) throw new Error("Missing fixture reader");
      await ctx.db.patch(reader._id, {
        status: "disabled",
        deletingAt: deleting ? 1 : undefined,
      });
    });
    await expect(f.preview()).rejects.toThrow("Sign in");
  });
});
