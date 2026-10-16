/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { addReader, saveTestCredential, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const embedding = Array.from({ length: 1536 }, () => 1);
const READER_KEY = "sk-or-reader-own-key-fixture-0001";
const DEPLOYMENT_KEY = "owner-deployment-key-fixture";
const OWNER_KEY = "owner-openrouter-test-key";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;

function article(userId: string, guid: string, title: string) {
  return {
    userId,
    guid,
    url: `https://example.com/${guid}`,
    title,
    excerpt: title,
    content: `${title}. ${"Words to read. ".repeat(40)}`,
    wordCount: 120,
    estimatedReadMinutes: 1,
    embedding,
    extractionStatus: "extracted" as const,
    annotationStatus: "annotated" as const,
    createdAt: Date.now(),
  };
}

/** A small but complete owner library under the original "default_user" ID. */
async function seedOwnerLibrary({ t }: Fixture) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const feedId = await ctx.db.insert("feeds", {
      userId: OWNER,
      url: "https://owner.example/feed",
      title: "Owner feed",
      isActive: true,
      createdAt: now,
    });
    const articleId = await ctx.db.insert("articles", {
      ...article(OWNER, "owner-secret", "Owner secret essay"),
      feedId,
    });
    const annotationId = await ctx.db.insert("annotations", {
      articleId,
      userId: OWNER,
      type: "context",
      anchorText: "Owner",
      anchorStartOffset: 0,
      anchorEndOffset: 5,
      content: "Owner annotation",
      relevanceScore: 0.9,
      wasViewed: false,
      wasDismissed: false,
      createdAt: now,
    });
    const reflectionId = await ctx.db.insert("reflections", {
      articleId,
      userId: OWNER,
      strongestPoint: "Owner strongest point",
      weakestAssumption: "w",
      credibleCounterview: "c",
      questionForYou: "q",
      createdAt: now,
    });
    const noteId = await ctx.db.insert("userNotes", {
      userId: OWNER,
      articleId,
      selectedText: "Owner passage",
      content: "<p>Owner private note</p>",
      contentPlain: "Owner private note",
      embedding,
      createdAt: now,
      updatedAt: now,
    });
    const highlightId = await ctx.db.insert("highlights", {
      userId: OWNER,
      articleId,
      kind: "highlight",
      text: "Owner highlighted passage",
      embedding,
      readerHighlightId: "reader-highlight-1",
      source: "reader",
      createdAt: now,
    });
    const threadId = await ctx.db.insert("companionThreads", {
      userId: OWNER,
      articleId,
      mode: "ask",
      selection: "Owner selection",
      question: "Owner private question",
      turns: [{ role: "assistant", content: "Owner answer" }],
      embedding,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("summaries", {
      userId: OWNER,
      articleId,
      gist: "Owner gist",
      model: "fixture",
      createdAt: now,
    });
    const impressionId = await ctx.db.insert("impressions", {
      userId: OWNER,
      articleId,
      rating: 5,
      tags: ["owner-tag"],
      note: "Owner impression",
      embedding,
      createdAt: now,
      updatedAt: now,
    });
    const sessionId = await ctx.db.insert("sessions", {
      userId: OWNER,
      requestedMinutes: 10,
      startedAt: now,
      articleId,
      readingStatus: "reading",
    });
    await ctx.db.insert("articleInteractions", {
      userId: OWNER,
      articleId,
      sessionId,
      action: "opened",
      scrollPercentage: 10,
      createdAt: now,
    });
    await ctx.db.insert("readingActivity", {
      userId: OWNER,
      visitId: "owner-visit",
      day: new Date(now).toISOString().slice(0, 10),
      articleId,
      startedAt: now - 1000,
      updatedAt: now,
      activeTimeMs: 500,
      visibleTimeMs: 800,
      timeSpentMs: 1000,
      maxScrollPercent: 10,
      annotationsOpened: [],
    });
    await ctx.db.insert("savedArticles", {
      userId: OWNER,
      articleId,
      savedAt: now,
    });
    await ctx.db.insert("lovedArticles", {
      userId: OWNER,
      articleId,
      lovedAt: now - 10 * 86400000,
      reviewIndex: 0,
      nextReviewAt: now - 1,
      reviewCount: 0,
    });
    await ctx.db.insert("userSettings", {
      userId: OWNER,
      quickModel: "google/gemini-3.8-flash",
      updatedAt: now,
    });
    await ctx.db.insert("noteChunks", {
      userId: OWNER,
      filePath: "Owner vault.md",
      fileName: "Owner vault",
      chunkIndex: 0,
      content: "Owner vault secret",
      embedding,
      fileHash: "hash",
      indexedAt: now,
    });
    return {
      feedId,
      articleId,
      annotationId,
      reflectionId,
      noteId,
      highlightId,
      threadId,
      impressionId,
      sessionId,
    };
  });
}

describe("separate reader libraries", () => {
  it("hides every owner document from a second reader's reads", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", DEPLOYMENT_KEY);
    const fixture = await secondReaderTest(modules);
    await saveTestCredential(
      fixture.t,
      "default_user",
      "openrouter",
      OWNER_KEY,
    );
    const { reader } = fixture;
    const owner = await seedOwnerLibrary(fixture);
    const { articleId } = owner;

    expect(await reader.query(api.articles.getById, { articleId })).toBeNull();
    expect(await reader.query(api.articles.listAnnotated, {})).toEqual([]);
    expect(
      await reader.query(api.articles.listByFeed, { feedId: owner.feedId }),
    ).toEqual([]);
    expect(
      await reader.query(api.annotations.listByArticle, { articleId }),
    ).toEqual([]);
    expect(
      await reader.query(api.reflections.getByArticle, { articleId }),
    ).toBeNull();
    expect(
      await reader.query(api.summaries.getByArticle, { articleId }),
    ).toBeNull();
    expect(
      await reader.query(api.highlights.listByArticle, { articleId }),
    ).toEqual([]);
    expect(
      await reader.query(api.companionThreads.listByArticle, { articleId }),
    ).toEqual([]);
    expect(
      await reader.query(api.impressions.getByArticle, { articleId }),
    ).toBeNull();
    expect(await reader.query(api.impressions.listRecent, {})).toEqual([]);
    expect(
      await reader.query(api.userNotes.listByArticle, { articleId }),
    ).toEqual([]);
    expect(await reader.query(api.userNotes.listAll, {})).toEqual([]);
    expect(
      await reader.query(api.userNotes.getById, { noteId: owner.noteId }),
    ).toBeNull();
    expect(
      await reader.query(api.sessions.getById, { sessionId: owner.sessionId }),
    ).toBeNull();
    expect(await reader.query(api.sessions.getInProgress, {})).toBeNull();
    expect(await reader.query(api.sessions.listRecentInteractions, {})).toEqual(
      [],
    );
    expect(await reader.query(api.savedArticles.list, {})).toEqual([]);
    expect(await reader.query(api.savedArticles.count, {})).toBe(0);
    expect(await reader.query(api.lovedArticles.listAll, {})).toEqual([]);
    expect(await reader.query(api.lovedArticles.getDueForReview, {})).toEqual(
      [],
    );
    expect(await reader.query(api.lovedArticles.isLoved, { articleId })).toBe(
      false,
    );
    expect(await reader.query(api.feeds.list, {})).toEqual([]);
    expect(await reader.query(api.noteChunks.count, {})).toBe(0);
    const ownerModels = await fixture.owner.query(
      api.userSettings.getModels,
      {},
    );
    const readerModels = await reader.query(api.userSettings.getModels, {});
    expect(ownerModels.selected.quick).toBe(
      "openrouter:google/gemini-3.8-flash",
    );
    // The owner's deployment key never gives another reader any models
    expect(readerModels).toEqual({
      selected: { annotations: null, quick: null, deep: null },
      available: [],
    });
    expect(await reader.query(api.providerCredentials.list, {})).toEqual([]);
    expect(await reader.query(api.home.overview, {})).toMatchObject({
      annotatedTotal: 0,
      upNext: [],
      latestNote: null,
    });
    const stats = await reader.query(api.stats.getDashboard, {
      range: "7days",
      timeZone: "UTC",
    });
    expect(stats.thisWeek).toMatchObject({
      articlesStarted: 0,
      totalActiveTimeMs: 0,
      notesTaken: 0,
    });
    expect(stats.articles).toEqual([]);
  });

  it("refuses a second reader's changes to owner documents", async () => {
    const fixture = await secondReaderTest(modules);
    const { reader, t } = fixture;
    const owner = await seedOwnerLibrary(fixture);
    const { articleId } = owner;
    const denied: [string, () => Promise<unknown>][] = [
      [
        "annotation viewed",
        () =>
          reader.mutation(api.annotations.markViewed, {
            annotationId: owner.annotationId,
          }),
      ],
      [
        "annotation dismissed",
        () =>
          reader.mutation(api.annotations.markDismissed, {
            annotationId: owner.annotationId,
          }),
      ],
      [
        "reflection response",
        () =>
          reader.mutation(api.reflections.saveResponse, {
            reflectionId: owner.reflectionId,
            userResponse: "Intruder",
          }),
      ],
      [
        "highlight create",
        () =>
          reader.mutation(api.highlights.create, {
            articleId,
            kind: "highlight",
            text: "Intruder",
          }),
      ],
      [
        "highlight remove",
        () =>
          reader.mutation(api.highlights.remove, {
            highlightId: owner.highlightId,
          }),
      ],
      [
        "thread create",
        () =>
          reader.mutation(api.companionThreads.create, {
            articleId,
            mode: "ask",
            selection: "x",
            turns: [],
          }),
      ],
      [
        "thread keep",
        () =>
          reader.mutation(api.companionThreads.keep, {
            articleId,
            answerId: "a",
            mode: "ask",
            selection: "x",
            turns: [],
          }),
      ],
      [
        "lookup record",
        () =>
          reader.mutation(api.lookups.record, {
            articleId,
            word: "x",
            sentence: "x.",
            sense: "x",
          }),
      ],
      [
        "thread update",
        () =>
          reader.mutation(api.companionThreads.updateTurns, {
            threadId: owner.threadId,
            turns: [],
          }),
      ],
      [
        "thread remove",
        () =>
          reader.mutation(api.companionThreads.remove, {
            threadId: owner.threadId,
          }),
      ],
      [
        "impression save",
        () => reader.mutation(api.impressions.save, { articleId, rating: 1 }),
      ],
      [
        "note create",
        () =>
          reader.mutation(api.userNotes.create, {
            articleId,
            selectedText: "x",
            content: "x",
            contentPlain: "x",
          }),
      ],
      [
        "note update",
        () =>
          reader.mutation(api.userNotes.update, {
            noteId: owner.noteId,
            content: "Intruder",
            contentPlain: "Intruder",
          }),
      ],
      [
        "note remove",
        () => reader.mutation(api.userNotes.remove, { noteId: owner.noteId }),
      ],
      [
        "session update",
        () =>
          reader.mutation(api.sessions.updateStatus, {
            sessionId: owner.sessionId,
            readingStatus: "abandoned",
          }),
      ],
      [
        "interaction",
        () =>
          reader.mutation(api.sessions.recordInteraction, {
            articleId,
            action: "finished",
          }),
      ],
      [
        "reading checkpoint",
        () => {
          const startedAt = Date.now() - 20000;
          return reader.mutation(api.readingActivity.checkpoint, {
            articleId,
            visitId: "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e",
            day: new Date(startedAt).toISOString().slice(0, 10),
            startedAt,
            updatedAt: startedAt + 10000,
            activeTimeMs: 6000,
            visibleTimeMs: 8000,
            timeSpentMs: 10000,
            maxScrollPercent: 40,
            annotationsOpened: [],
          });
        },
      ],
      [
        "save article",
        () => reader.mutation(api.savedArticles.save, { articleId }),
      ],
      [
        "love article",
        () => reader.mutation(api.lovedArticles.love, { articleId }),
      ],
      [
        "feed remove",
        () => reader.mutation(api.feeds.remove, { feedId: owner.feedId }),
      ],
      [
        "feed toggle",
        () => reader.mutation(api.feeds.toggleActive, { feedId: owner.feedId }),
      ],
      [
        "reannotate",
        () => reader.action(api.articles.requestReannotate, { articleId }),
      ],
      [
        "summarize",
        () =>
          reader.action(api.actions.summarize.generate, {
            articleId,
            title: "x",
            paragraphs: ["x"],
          }),
      ],
    ];
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    for (const [name, attempt] of denied)
      await expect(attempt(), name).rejects.toThrow(/not found/i);
    expect(provider).not.toHaveBeenCalled();

    // Unsaving or unloving someone else's article is a no-op, not a deletion
    await reader.mutation(api.savedArticles.unsave, { articleId });
    await reader.mutation(api.lovedArticles.unlove, { articleId });

    const after = await t.run(async (ctx) => ({
      annotation: await ctx.db.get(owner.annotationId),
      reflection: await ctx.db.get(owner.reflectionId),
      note: await ctx.db.get(owner.noteId),
      highlight: await ctx.db.get(owner.highlightId),
      thread: await ctx.db.get(owner.threadId),
      impression: await ctx.db.get(owner.impressionId),
      session: await ctx.db.get(owner.sessionId),
      feed: await ctx.db.get(owner.feedId),
      article: await ctx.db.get(articleId),
      highlights: await ctx.db.query("highlights").take(10),
      threads: await ctx.db.query("companionThreads").take(10),
      notes: await ctx.db.query("userNotes").take(10),
      interactions: await ctx.db.query("articleInteractions").take(10),
      saved: await ctx.db.query("savedArticles").take(10),
      loved: await ctx.db.query("lovedArticles").take(10),
      annotations: await ctx.db.query("annotations").take(10),
      reflections: await ctx.db.query("reflections").take(10),
    }));
    expect(after.annotation).toMatchObject({
      wasViewed: false,
      wasDismissed: false,
    });
    expect(after.reflection?.userResponse).toBeUndefined();
    expect(after.note?.contentPlain).toBe("Owner private note");
    expect(after.highlight).not.toBeNull();
    expect(after.thread?.turns).toHaveLength(1);
    expect(after.impression?.rating).toBe(5);
    expect(after.session?.readingStatus).toBe("reading");
    expect(after.feed?.isActive).toBe(true);
    expect(after.article?.finishedAt).toBeUndefined();
    expect(after.article?.annotationStatus).toBe("annotated");
    expect(after.highlights).toHaveLength(1);
    expect(after.threads).toHaveLength(1);
    expect(after.notes).toHaveLength(1);
    expect(after.interactions).toHaveLength(1);
    expect(after.saved).toHaveLength(1);
    expect(after.loved).toHaveLength(1);
    expect(after.annotations).toHaveLength(1);
    expect(after.reflections).toHaveLength(1);
  });

  it("keeps a second reader's writes in their own library, invisible to the owner", async () => {
    // Keep scheduled embedding and Readwise jobs from calling providers
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", DEPLOYMENT_KEY);
    const fixture = await secondReaderTest(modules);
    await saveTestCredential(
      fixture.t,
      "default_user",
      "openrouter",
      OWNER_KEY,
    );
    const { reader, owner, readerLibraryId, t } = fixture;
    const ownerIds = await seedOwnerLibrary(fixture);
    await saveTestCredential(t, readerLibraryId, "openrouter", READER_KEY);

    // The same feed URL can exist in both libraries
    const feedId = await reader.mutation(api.feeds.add, {
      url: "https://owner.example/feed",
      title: "Reader copy",
    });
    expect(await reader.query(api.feeds.list, {})).toMatchObject([
      { _id: feedId, userId: readerLibraryId },
    ]);
    expect(await owner.query(api.feeds.list, {})).toMatchObject([
      { _id: ownerIds.feedId },
    ]);

    // Article dedup by URL is per library, not global
    const insert = (userId: string) =>
      t.mutation(internal.articles.insertExtracted, {
        userId,
        guid: "owner-secret",
        url: "https://example.com/owner-secret",
        title: "Shared URL",
        content: "Shared",
        contentHtml: "<p>Shared</p>",
        excerpt: "Shared",
        wordCount: 1,
        estimatedReadMinutes: 1,
        readerDocumentId: `doc-${userId}`,
      });
    const readerArticleId = await insert(readerLibraryId);
    expect(readerArticleId).not.toBe(ownerIds.articleId);
    expect(await insert(OWNER)).toBe(ownerIds.articleId);
    expect(
      await t.query(internal.articles.getByUrl, {
        userId: readerLibraryId,
        url: "owner-secret",
      }),
    ).toMatchObject({ _id: readerArticleId });
    expect(
      await t.query(internal.readwise.findArticle, {
        userId: readerLibraryId,
        readerDocumentId: "doc-default_user",
      }),
    ).toBeNull();

    const highlightId = await reader.mutation(api.highlights.create, {
      articleId: readerArticleId,
      kind: "highlight",
      text: "Reader mark",
    });
    const threadId = await reader.mutation(api.companionThreads.create, {
      articleId: readerArticleId,
      mode: "explain",
      selection: "Reader selection",
      turns: [],
    });
    const noteId = await reader.mutation(api.userNotes.create, {
      articleId: readerArticleId,
      selectedText: "Reader passage",
      content: "<p>Reader note</p>",
      contentPlain: "Reader note",
    });
    await reader.mutation(api.impressions.save, {
      articleId: readerArticleId,
      rating: 4,
      note: "Reader impression",
    });
    await reader.mutation(api.savedArticles.save, {
      articleId: readerArticleId,
    });
    await reader.mutation(api.lovedArticles.love, {
      articleId: readerArticleId,
    });
    const sessionId = await reader.mutation(api.sessions.create, {
      requestedMinutes: 5,
    });
    await reader.mutation(api.sessions.recordInteraction, {
      articleId: readerArticleId,
      sessionId,
      action: "opened",
    });
    await reader.mutation(api.userSettings.setModel, {
      role: "quick",
      model: "openrouter:google/gemini-3.8-flash",
    });

    const rows = await t.run(async (ctx) => ({
      highlight: await ctx.db.get(highlightId),
      thread: await ctx.db.get(threadId),
      note: await ctx.db.get(noteId),
      session: await ctx.db.get(sessionId),
      settings: await ctx.db
        .query("userSettings")
        .withIndex("by_user", (q) => q.eq("userId", readerLibraryId))
        .unique(),
      impressions: await ctx.db
        .query("impressions")
        .withIndex("by_user_updated", (q) => q.eq("userId", readerLibraryId))
        .take(5),
    }));
    for (const row of [
      rows.highlight,
      rows.thread,
      rows.note,
      rows.session,
      rows.settings,
      ...rows.impressions,
    ])
      expect(row?.userId).toBe(readerLibraryId);

    // The reader sees their own work...
    expect(await reader.query(api.userNotes.listAll, {})).toMatchObject([
      { _id: noteId },
    ]);
    expect(await reader.query(api.savedArticles.count, {})).toBe(1);
    expect(await reader.query(api.lovedArticles.listAll, {})).toHaveLength(1);
    expect(await reader.query(api.sessions.getInProgress, {})).toMatchObject({
      article: { _id: readerArticleId },
    });

    // ...and the owner sees none of it
    expect(
      await owner.query(api.articles.getById, { articleId: readerArticleId }),
    ).toBeNull();
    expect(
      await owner.query(api.highlights.listByArticle, {
        articleId: readerArticleId,
      }),
    ).toEqual([]);
    expect(await owner.query(api.userNotes.getById, { noteId })).toBeNull();
    expect(
      (await owner.query(api.userNotes.listAll, {})).map((n) => n._id),
    ).toEqual([ownerIds.noteId]);
    expect(
      (await owner.query(api.impressions.listRecent, {})).map((i) => i.note),
    ).toEqual(["Owner impression"]);
    expect(await owner.query(api.savedArticles.count, {})).toBe(1);
    expect(await owner.query(api.sessions.getById, { sessionId })).toBeNull();
    await expect(
      owner.mutation(api.companionThreads.remove, { threadId }),
    ).rejects.toThrow(/not found/i);
    expect(
      (await owner.query(api.userSettings.getModels, {})).selected.quick,
    ).toBe("openrouter:google/gemini-3.8-flash");
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("userSettings")
          .withIndex("by_user", (q) => q.eq("userId", OWNER))
          .take(5),
      ),
    ).toHaveLength(1);
  });

  it("retrieves only the reader's own library for Ask and library search", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", DEPLOYMENT_KEY);
    const fixture = await secondReaderTest(modules);
    await saveTestCredential(
      fixture.t,
      "default_user",
      "openrouter",
      OWNER_KEY,
    );
    const { reader, readerLibraryId, t } = fixture;
    const ownerIds = await seedOwnerLibrary(fixture);
    await saveTestCredential(t, readerLibraryId, "openrouter", READER_KEY);
    const keys: (string | null)[] = [];
    const readerArticleId = await t.run((ctx) =>
      ctx.db.insert(
        "articles",
        article(readerLibraryId, "reader-piece", "Reader garden piece"),
      ),
    );
    const prompts: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get("Authorization"));
      const body = String(init?.body ?? "");
      if (url.endsWith("/embeddings"))
        return Response.json({ data: [{ index: 0, embedding }] });
      prompts.push(body);
      const request = JSON.parse(body);
      if (request.stream)
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Answer." } }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        );
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                matches: [ownerIds.articleId, readerArticleId].map(
                  (articleId) => ({
                    articleId,
                    relevant: true,
                    reason: "Fits the search.",
                  }),
                ),
              }),
            },
          },
        ],
      });
    });

    const search = await reader.fetch("/api/library/search", {
      method: "POST",
      body: JSON.stringify({ question: "essay" }),
    });
    expect(search.status).toBe(200);
    expect(
      (
        (await search.json()) as { matches: { articleId: string }[] }
      ).matches.map((m) => m.articleId),
    ).toEqual([readerArticleId]);

    const ask = await reader.fetch("/api/library", {
      method: "POST",
      body: JSON.stringify({ question: "What did I read?" }),
    });
    expect(ask.status).toBe(200);
    expect(await ask.text()).toBe("Answer.");

    expect(prompts).toHaveLength(2);
    // Every provider call used the reader's own key, never the owner's
    expect(keys.length).toBeGreaterThanOrEqual(4);
    expect(new Set(keys)).toEqual(new Set([`Bearer ${READER_KEY}`]));
    for (const prompt of prompts) {
      expect(prompt).toContain("Reader garden piece");
      expect(prompt).not.toContain("Owner");
      expect(prompt).not.toContain(ownerIds.articleId);
    }
  });

  it("builds marginalia only from the article's own library", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", DEPLOYMENT_KEY);
    const fixture = await secondReaderTest(modules);
    await saveTestCredential(
      fixture.t,
      "default_user",
      "openrouter",
      OWNER_KEY,
    );
    const { readerLibraryId, t } = fixture;
    await seedOwnerLibrary(fixture);
    await saveTestCredential(t, readerLibraryId, "openrouter", READER_KEY);
    const keys: (string | null)[] = [];
    const readerArticleId = await t.run((ctx) =>
      ctx.db.insert(
        "articles",
        article(readerLibraryId, "reader-piece", "Reader garden piece"),
      ),
    );
    const prompts: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        keys.push(new Headers(init?.headers).get("Authorization"));
        const request = JSON.parse(String(init?.body));
        if (url.endsWith("/embeddings"))
          return Response.json({
            data: (request.input as string[]).map((_, index) => ({
              index,
              embedding,
            })),
          });
        prompts.push(JSON.stringify(request.messages));
        return Response.json({
          id: "fixture",
          created: 1,
          model: request.model,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  annotations: [],
                  reflection: {
                    strongestPoint: "s",
                    weakestAssumption: "w",
                    credibleCounterview: "c",
                    questionForYou: "q",
                  },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
    );
    await t.action(internal.actions.generateAnnotations.generateForArticle, {
      articleId: readerArticleId,
    });
    expect(prompts).toHaveLength(1);
    expect(new Set(keys)).toEqual(new Set([`Bearer ${READER_KEY}`]));
    expect(prompts[0]).toContain("Reader garden piece");
    expect(prompts[0]).not.toContain("Owner");
    const reflections = await t.run((ctx) =>
      ctx.db
        .query("reflections")
        .withIndex("by_article", (q) => q.eq("articleId", readerArticleId))
        .take(5),
    );
    expect(reflections).toMatchObject([{ userId: readerLibraryId }]);
  });

  it("keeps the owner's Readwise token and vault out of other libraries", async () => {
    vi.stubEnv("READWISE_TOKEN", "owner-only-token");
    const { reader, owner } = await secondReaderTest(modules);
    expect((await owner.query(api.readwise.status, {})).connected).toBe(true);
    expect((await reader.query(api.readwise.status, {})).connected).toBe(false);
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    await expect(reader.action(api.readwise.syncNow, {})).rejects.toThrow(
      "isn't connected",
    );
    expect(provider).not.toHaveBeenCalled();
  });

  it("denies disabled readers, unknown users and readers pointed at the owner's library", async () => {
    const t = (await secondReaderTest(modules)).t;
    const disabled = await addReader(t, {
      email: "disabled@example.com",
      status: "disabled",
    });
    const stranger = await addReader(t, {
      email: "stranger@example.com",
      register: false,
    });
    const impostor = await addReader(t, {
      email: "impostor@example.com",
      register: false,
    });
    // A reader row must never map someone else onto the owner's library
    await t.run((ctx) =>
      ctx.db.insert("readers", {
        authId: impostor.libraryId,
        libraryId: OWNER,
        status: "active",
        createdAt: Date.now(),
      }),
    );
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    for (const { client } of [disabled, stranger, impostor]) {
      await expect(client.query(api.home.overview, {})).rejects.toThrow(
        "Sign in",
      );
      await expect(
        client.mutation(api.feeds.add, {
          url: "https://x.example",
          title: "x",
        }),
      ).rejects.toThrow("Sign in");
      await expect(
        client.action(api.actions.addArticleByUrl.add, {
          url: "https://example.com/article",
        }),
      ).rejects.toThrow("Sign in");
      for (const path of [
        "companion",
        "library",
        "library/search",
        "library/find",
        "engagement",
      ]) {
        const response = await client.fetch(`/api/${path}`, {
          method: "POST",
          body: "{}",
        });
        expect(response.status).toBe(401);
      }
    }
    expect(provider).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("feeds").take(1))).toEqual([]);
  });

  it("leaves the owner's own library behaviour unchanged", async () => {
    const fixture = await secondReaderTest(modules);
    const { owner } = fixture;
    const ids = await seedOwnerLibrary(fixture);
    const articleId: Id<"articles"> = ids.articleId;
    expect(
      await owner.query(api.articles.getById, { articleId }),
    ).toMatchObject({ title: "Owner secret essay" });
    expect(
      await owner.query(api.articles.listByFeed, { feedId: ids.feedId }),
    ).toHaveLength(1);
    expect(
      await owner.query(api.summaries.getByArticle, { articleId }),
    ).toMatchObject({ gist: "Owner gist" });
    expect(
      await owner.query(api.highlights.listByArticle, { articleId }),
    ).toHaveLength(1);
    expect(
      await owner.query(api.lovedArticles.getDueForReview, {}),
    ).toHaveLength(1);
    expect(await owner.query(api.sessions.getInProgress, {})).toMatchObject({
      article: { _id: articleId },
    });
    expect(await owner.query(api.noteChunks.count, {})).toBe(1);
    await owner.mutation(api.annotations.markViewed, {
      annotationId: ids.annotationId,
    });
    await owner.mutation(api.userNotes.update, {
      noteId: ids.noteId,
      content: "<p>Edited</p>",
      contentPlain: "Edited",
    });
    expect(
      await owner.query(api.userNotes.getById, { noteId: ids.noteId }),
    ).toMatchObject({ contentPlain: "Edited", userId: OWNER });
  });
});
