/// <reference types="vite/client" />

import { getDocumentSize } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { metadataContext } from "../test/metadata";
import { addReader } from "../test/owner";
import { api, internal } from "./_generated/api";
import authSchema from "./betterAuth/schema";
import "./functions";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const smallRead = { transactionLimits: { bytesRead: 64_000 } };
const content = `${"x".repeat(989_990)}END`;

async function fixture() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("./betterAuth/**/*.ts"),
  );
  const { client, libraryId } = await addReader(t, {
    email: "ownership-reader@example.com",
  });
  const other = await addReader(t, { email: "other-reader@example.com" });
  const fields = {
    userId: libraryId,
    guid: "near-limit",
    url: "https://example.com/near-limit",
    title: "Near-limit source",
    content,
    extractionStatus: "extracted" as const,
    annotationStatus: "annotated" as const,
    createdAt: 1,
  };
  // Installed generic metadata hooks, not a hand-built authority row.
  const articleId = await t.run((ctx) =>
    metadataContext(ctx).db.insert("articles", fields),
  );
  const ids = await t.run(async (ctx) => {
    const summaryId = await ctx.db.insert("summaries", {
      userId: libraryId,
      articleId,
      gist: "A small requested gist",
      thesis: "A small thesis",
      model: "fixture",
      createdAt: 2,
    });
    const reflectionId = await ctx.db.insert("reflections", {
      userId: libraryId,
      articleId,
      strongestPoint: "Strong",
      weakestAssumption: "Weak",
      credibleCounterview: "Counterview",
      questionForYou: "Why?",
      userResponse: "Private saved response",
      respondedAt: 3,
      createdAt: 2,
    });
    await ctx.db.insert("userNotes", {
      userId: libraryId,
      articleId,
      selectedText: "A passage",
      content: "<p>Private answer</p>",
      contentPlain: "Private answer",
      createdAt: 2,
      updatedAt: 2,
    });
    await ctx.db.insert("books", {
      userId: libraryId,
      articleId,
      unitCount: 2,
      finishedThrough: 0,
      furthestUnit: 1,
      furthestScroll: 35,
      furthestParagraph: 7,
      createdAt: 2,
    });
    await ctx.db.insert("readingActivity", {
      userId: libraryId,
      articleId,
      visitId: "visit",
      day: "2026-10-19",
      startedAt: 1,
      updatedAt: 2,
      activeTimeMs: 10,
      visibleTimeMs: 10,
      timeSpentMs: 10,
      maxScrollPercent: 42,
      paragraphIndex: 9,
      annotationsOpened: [],
    });
    await ctx.db.insert("lookups", {
      userId: libraryId,
      articleId,
      word: "Small",
      wordKey: "small",
      sentence: "A small payload",
      sense: "Not large",
      createdAt: 2,
    });
    await ctx.db.insert("highlights", {
      userId: libraryId,
      articleId,
      kind: "highlight",
      text: "Private citation",
      createdAt: 2,
    });
    await ctx.db.insert("marginaliaPasses", {
      userId: libraryId,
      articleId,
      sectionIndex: 2,
      status: "running",
      claim: Date.now(),
      leaseUntil: Date.now() + 60_000,
      fingerprint: {
        notesMax: 0,
        threadsMax: 0,
        highlightsMax: 0,
        highlightsCount: 0,
        vaultIndexedMax: 0,
        passAt: 1,
      },
      calls: 1,
      notesAdded: 0,
      updatedAt: 2,
    });
    return { summaryId, reflectionId };
  });
  return { t, client, libraryId, other, articleId, fields, ...ids };
}

describe("ownership-only physical article reads", () => {
  it("reads companion background under 64 KB and cannot expose a previous owner's summary", async () => {
    const f = await fixture();
    expect(
      await f.t.run((ctx) =>
        ctx.runQuery(
          internal.summaries.forCompanion,
          { articleId: f.articleId, userId: f.libraryId },
          smallRead,
        ),
      ),
    ).toEqual({ thesis: "A small thesis", gist: "A small requested gist" });
    await f.t.run((ctx) =>
      metadataContext(ctx).db.patch(f.articleId, { userId: f.other.libraryId }),
    );
    expect(
      await f.t.query(internal.summaries.forCompanion, {
        articleId: f.articleId,
        userId: f.other.libraryId,
      }),
    ).toBeNull();
    expect((await f.t.run((ctx) => ctx.db.get(f.summaryId)))?.gist).toBe(
      "A small requested gist",
    );
  });
  it("uses the existing small estimated-minutes card for legacy visits in readingRoom", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      await metadataContext(ctx).db.patch(f.articleId, {
        estimatedReadMinutes: 5,
      });
      const at = Date.now() - 1000;
      await ctx.db.insert("readingActivity", {
        userId: f.libraryId,
        articleId: f.articleId,
        visitId: "current-legacy-visit",
        day: "ignored",
        startedAt: at,
        updatedAt: at,
        activeTimeMs: 60_000,
        visibleTimeMs: 60_000,
        timeSpentMs: 60_000,
        maxScrollPercent: 50,
        annotationsOpened: [],
      });
    });
    const result = await f.client.run((ctx) =>
      ctx.runQuery(
        api.stats.readingRoom,
        { timeZone: "UTC", period: "month" },
        smallRead,
      ),
    );
    expect(result.shortSlots.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(result.longSlots.every((count) => count === 0)).toBe(true);
    expect(result.activeTimeMs).toBe(60_000);
    expect(result.readsPartial).toBe(false);
  });
  it.each([
    "summary",
    "reflection",
  ] as const)("reads an existing small %s with a near-limit source under 64 KB", async (kind) => {
    const f = await fixture();
    const row = await f.client.run(async (ctx) =>
      kind === "summary"
        ? await ctx.runQuery(
            api.summaries.getByArticle,
            { articleId: f.articleId },
            smallRead,
          )
        : await ctx.runQuery(
            api.reflections.getByArticle,
            { articleId: f.articleId },
            smallRead,
          ),
    );
    expect(row?._id).toBe(kind === "summary" ? f.summaryId : f.reflectionId);
  });
  it("serves actual public summary/reflection/preview/progress/header reads under 64 KB; full source authorization cannot fit", async () => {
    const f = await fixture();
    const sizes = await f.t.run(async (ctx) => {
      const source = await ctx.db.get(f.articleId);
      const card = await ctx.db
        .query("articleMetadata")
        .withIndex("by_articleId", (q) => q.eq("articleId", f.articleId))
        .unique();
      const summary = await ctx.db.get(f.summaryId);
      const reflection = await ctx.db.get(f.reflectionId);
      if (!source || !card || !summary || !reflection)
        throw new Error("Missing byte fixture");
      return {
        source: getDocumentSize(source),
        card: getDocumentSize(card),
        summary: getDocumentSize(summary),
        reflection: getDocumentSize(reflection),
      };
    });
    expect(sizes.source).toBeGreaterThan(989_993);
    expect(sizes.source).toBeLessThan(1024 * 1024);
    expect(sizes.card).toBeLessThan(2_000);
    expect(sizes.summary).toBeLessThan(1_000);
    expect(sizes.reflection).toBeLessThan(1_000);
    await expect(
      f.client.run((ctx) =>
        ctx.runQuery(
          api.articles.getById,
          { articleId: f.articleId },
          smallRead,
        ),
      ),
    ).rejects.toThrow("Read too much data");
    expect(
      await f.client.run((ctx) =>
        ctx.runQuery(
          api.summaries.getByArticle,
          { articleId: f.articleId },
          smallRead,
        ),
      ),
    ).toMatchObject({ _id: f.summaryId, gist: "A small requested gist" });
    expect(
      await f.client.run((ctx) =>
        ctx.runQuery(
          api.reflections.getByArticle,
          { articleId: f.articleId },
          smallRead,
        ),
      ),
    ).toMatchObject({
      _id: f.reflectionId,
      userResponse: "Private saved response",
    });
    const previews = await f.client.run((ctx) =>
      ctx.runQuery(
        api.userNotes.listPreviewsByArticle,
        {
          articleId: f.articleId,
          paginationOpts: { cursor: null, numItems: 25 },
        },
        smallRead,
      ),
    );
    expect(previews.page).toHaveLength(1);
    expect(JSON.stringify(previews)).toContain("Private answer");
    expect(JSON.stringify(previews)).not.toContain("<p>");
    expect(
      await f.client.run((ctx) =>
        ctx.runQuery(
          api.alongside.workingSections,
          { articleId: f.articleId },
          smallRead,
        ),
      ),
    ).toEqual([2]);
    expect(
      await f.client.run((ctx) =>
        ctx.runQuery(
          api.readerBootstrap.progress,
          { articleId: f.articleId },
          smallRead,
        ),
      ),
    ).toEqual({ unit: 1, scroll: 35, paragraph: 7 });
    expect(
      await f.client.run((ctx) =>
        ctx.runQuery(
          api.readingActivity.furthest,
          { articleId: f.articleId },
          smallRead,
        ),
      ),
    ).toBe(42);
    expect(
      await f.client.run((ctx) =>
        ctx.runQuery(
          api.readingActivity.furthestPlace,
          { articleId: f.articleId },
          smallRead,
        ),
      ),
    ).toEqual({ percent: 42, paragraphIndex: 9 });
    expect(
      await f.client.run((ctx) =>
        ctx.runQuery(
          api.articles.headers,
          { articleIds: [f.articleId] },
          smallRead,
        ),
      ),
    ).toEqual([
      {
        articleId: f.articleId,
        article: { title: f.fields.title, url: f.fields.url },
      },
    ]);
    for (const page of [
      await f.client.run((ctx) =>
        ctx.runQuery(
          api.dictionary.page,
          { paginationOpts: { cursor: null, numItems: 4 } },
          smallRead,
        ),
      ),
      await f.client.run((ctx) =>
        ctx.runQuery(
          api.dictionary.senses,
          { wordKey: "small", paginationOpts: { cursor: null, numItems: 4 } },
          smallRead,
        ),
      ),
    ]) {
      expect(page.page).toHaveLength(1);
      expect(page.page[0].articleTitle).toBe(f.fields.title);
    }
    expect(
      (
        await f.t.run((ctx) =>
          ctx.runQuery(
            internal.externalApi.highlightsForArticle,
            {
              userId: f.libraryId,
              articleId: f.articleId,
            },
            smallRead,
          ),
        )
      )?.highlights.map((row) => row.text),
    ).toEqual(["Private citation"]);
    // Intentionally body-returning endpoints remain complete, never card DTOs.
    expect(
      (await f.client.query(api.articles.getById, { articleId: f.articleId }))
        ?.content,
    ).toBe(content);
    expect(
      (
        await f.client.query(api.readerBootstrap.get, {
          articleId: f.articleId,
        })
      )?.article?.content,
    ).toBe(content);
    expect(
      await f.other.client.query(api.articles.getById, {
        articleId: f.articleId,
      }),
    ).toBeNull();
  });

  it("keeps body edits and generic replacement authoritative; transfer never exposes the old reader's summary/reflection", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
      metadataContext(ctx).db.patch(f.articleId, { content: "Changed body" }),
    );
    expect(
      (
        await f.client.query(api.summaries.getByArticle, {
          articleId: f.articleId,
        })
      )?._id,
    ).toBe(f.summaryId);
    await f.t.run((ctx) =>
      metadataContext(ctx).db.replace(f.articleId, {
        ...f.fields,
        userId: f.other.libraryId,
        title: "Transferred source",
      }),
    );
    for (const query of [
      api.summaries.getByArticle,
      api.reflections.getByArticle,
    ]) {
      expect(
        await f.client.query(query, { articleId: f.articleId }),
      ).toBeNull();
      expect(
        await f.other.client.query(query, { articleId: f.articleId }),
      ).toBeNull();
    }
    expect(
      (
        await f.other.client.query(api.articles.headers, {
          articleIds: [f.articleId],
        })
      )[0].article?.title,
    ).toBe("Transferred source");
    expect(
      (
        await f.t.query(internal.externalApi.highlightsForArticle, {
          userId: f.other.libraryId,
          articleId: f.articleId,
        })
      )?.highlights,
    ).toEqual([]);
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.reflectionId)))?.userResponse,
    ).toBe("Private saved response");
    await f.t.run((ctx) => metadataContext(ctx).db.delete(f.articleId));
    expect(
      await f.other.client.query(api.summaries.getByArticle, {
        articleId: f.articleId,
      }),
    ).toBeNull();
    expect(
      await f.other.client.query(api.reflections.getByArticle, {
        articleId: f.articleId,
      }),
    ).toBeNull();
  });

  it("retains detached KEEP/pause reads and book-unit previews without requiring source activity", async () => {
    const f = await fixture();
    // A KEEP result is a detached article; paused feeds do not revoke ownership.
    const feedId = await f.t.run((ctx) =>
      ctx.db.insert("feeds", {
        userId: f.libraryId,
        title: "Paused",
        url: "https://example.com/feed",
        isActive: false,
        createdAt: 1,
      }),
    );
    await f.t.run((ctx) =>
      metadataContext(ctx).db.patch(f.articleId, { feedId, bookUnitCount: 2 }),
    );
    const note = await f.t.run((ctx) =>
      ctx.db.insert("userNotes", {
        userId: f.libraryId,
        articleId: f.articleId,
        unitIndex: 1,
        selectedText: "Part two",
        content: "<p>Book answer</p>",
        contentPlain: "Book answer",
        createdAt: 3,
        updatedAt: 3,
      }),
    );
    const page = await f.client.query(api.userNotes.listPreviewsByArticle, {
      articleId: f.articleId,
      unitIndex: 1,
      paginationOpts: { cursor: null, numItems: 25 },
    });
    expect(page.page.map((row) => row._id)).toEqual([note]);
    await f.t.run((ctx) =>
      metadataContext(ctx).db.patch(f.articleId, { feedId: undefined }),
    );
    expect(
      (
        await f.client.query(api.reflections.getByArticle, {
          articleId: f.articleId,
        })
      )?._id,
    ).toBe(f.reflectionId);
  });

  it("denies foreign, disabled, deleting and absent readers", async () => {
    const f = await fixture();
    expect(
      await f.other.client.query(api.summaries.getByArticle, {
        articleId: f.articleId,
      }),
    ).toBeNull();
    expect(
      await f.other.client.query(api.reflections.getByArticle, {
        articleId: f.articleId,
      }),
    ).toBeNull();
    const reader = await f.t.run((ctx) =>
      ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.libraryId))
        .unique(),
    );
    if (!reader) throw new Error("Missing fixture reader");
    for (const deletingAt of [undefined, 1]) {
      await f.t.run((ctx) =>
        ctx.db.patch(reader._id, { status: "disabled", deletingAt }),
      );
      await expect(
        f.client.query(api.summaries.getByArticle, { articleId: f.articleId }),
      ).rejects.toThrow("Sign in");
      await expect(
        f.client.query(api.reflections.getByArticle, {
          articleId: f.articleId,
        }),
      ).rejects.toThrow("Sign in");
    }
    await f.t.run((ctx) => ctx.db.delete(reader._id));
    await expect(
      f.client.query(api.summaries.getByArticle, { articleId: f.articleId }),
    ).rejects.toThrow("Sign in");
  });

  it("keeps explicit legacy fallback cost and ready missing-card denial", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const card = await ctx.db
        .query("articleMetadata")
        .withIndex("by_articleId", (q) => q.eq("articleId", f.articleId))
        .unique();
      if (!card) throw new Error("Installed hook did not create authority");
      await ctx.db.delete(card._id);
    });
    expect(
      (
        await f.client.query(api.summaries.getByArticle, {
          articleId: f.articleId,
        })
      )?._id,
    ).toBe(f.summaryId);
    await expect(
      f.client.run((ctx) =>
        ctx.runQuery(
          api.summaries.getByArticle,
          { articleId: f.articleId },
          smallRead,
        ),
      ),
    ).rejects.toThrow("Read too much data");
    await f.t.run((ctx) =>
      ctx.db.insert("libraryMetadataState", {
        userId: f.libraryId,
        articlesReady: true,
        phase: "done",
        cursor: null,
      }),
    );
    expect(
      await f.client.run((ctx) =>
        ctx.runQuery(
          api.summaries.getByArticle,
          { articleId: f.articleId },
          smallRead,
        ),
      ),
    ).toBeNull();
  });

  it("does not treat deferred URL metadata as exact identity or silently drop its guarded source fallback", async () => {
    const f = await fixture();
    const url = `https://example.com/${"u".repeat(8200)}`;
    await f.t.run((ctx) => metadataContext(ctx).db.patch(f.articleId, { url }));
    expect(
      (
        await f.client.query(api.articles.headers, {
          articleIds: [f.articleId],
        })
      )[0].article?.url,
    ).toBe(url);
    await expect(
      f.client.run((ctx) =>
        ctx.runQuery(
          api.summaries.getByArticle,
          { articleId: f.articleId },
          smallRead,
        ),
      ),
    ).rejects.toThrow("Read too much data");
    expect(
      (
        await f.t.query(internal.externalApi.highlightsForArticle, {
          userId: f.libraryId,
          articleId: f.articleId,
        })
      )?.title,
    ).toBe(f.fields.title);
  });
});
