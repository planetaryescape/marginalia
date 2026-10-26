/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ownerTest,
  runScheduled,
  saveTestCredential,
  secondReaderTest,
} from "../test/owner";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
function chapterResponse() {
  return new Response(
    JSON.stringify({
      translation: { identifier: "web" },
      verses: [
        {
          book_id: "PSA",
          chapter: 23,
          verse: 1,
          text: "Yahweh is my shepherd: I shall lack nothing.",
        },
      ],
    }),
  );
}

describe("opt-in Bible reading", () => {
  it("gates legacy list and selection APIs after opt-out", async () => {
    const t = await ownerTest(modules);
    await t.run(async (ctx) => {
      for (const bible of [false, true])
        await ctx.db.insert("articles", {
          userId: "default_user",
          guid: `source-${bible}`,
          url: "https://example.com",
          title: bible ? "Bible passage" : "An article",
          content: bible ? "Scripture text" : "Article text",
          bible: bible
            ? {
                reference: "Psalms 23",
                translation: "web",
                copyright: "Public domain",
              }
            : undefined,
          estimatedReadMinutes: 5,
          extractionStatus: "extracted",
          annotationStatus: "annotated",
          createdAt: 1,
        });
    });
    for (const read of [
      () => t.query(api.articles.listAnnotated, {}),
      () => t.query(api.articles.listUnread, {}),
      () => t.action(api.actions.selectArticle.select, { requestedMinutes: 5 }),
    ]) {
      expect((await read()).map((a) => a.title)).toEqual(["An article"]);
    }
    await t.mutation(api.bible.setPreferences, { enabled: true });
    expect(await t.query(api.articles.listAnnotated, {})).toHaveLength(2);
    await t.mutation(api.bible.setPreferences, { enabled: false });
    expect(
      (await t.query(api.articles.listAnnotated, {})).map((a) => a.title),
    ).toEqual(["An article"]);
  });
  it("resumes cached-passage annotations paused during opt-out, without fetching text again", async () => {
    vi.useFakeTimers();
    const { owner, reader } = await secondReaderTest(modules);
    await owner.mutation(api.bible.setPreferences, { enabled: true });
    const fetch = vi.fn().mockImplementation(async () => chapterResponse());
    vi.stubGlobal("fetch", fetch);
    const id = await owner.action(api.actions.bible.openPassage, {
      reference: "Psalms 23",
    });
    await owner.mutation(api.bible.setPreferences, { enabled: false });
    await runScheduled(owner);
    expect(await owner.run((ctx) => ctx.db.get(id))).toMatchObject({
      annotationStatus: "skipped",
      skipReason: "bible_disabled",
    });
    await owner.mutation(api.bible.setPreferences, { enabled: true });
    expect(
      await owner.action(api.actions.bible.openPassage, {
        reference: "Psalms 23",
      }),
    ).toBe(id);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      await owner.query(api.articles.getById, { articleId: id }),
    ).toMatchObject({ annotationStatus: "pending" });
    await owner.mutation(api.bible.resumeAnnotations, { articleId: id });
    const pending = await owner.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(10),
    );
    expect(pending.filter((job) => job.state.kind === "pending")).toHaveLength(
      1,
    );
    await reader.mutation(api.bible.setPreferences, { enabled: true });
    await expect(
      reader.mutation(api.bible.resumeAnnotations, { articleId: id }),
    ).rejects.toThrow("not found");
    await runScheduled(owner);
    expect(
      await owner.query(api.articles.getById, { articleId: id }),
    ).toMatchObject({ annotationStatus: "skipped", skipReason: "no_provider" });
  });
  it("bounds topic generation before a stalled provider can consume the whole action", async () => {
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, { enabled: true });
    await saveTestCredential(t, "default_user", "openrouter", "fixture-key");
    const controller = new AbortController();
    controller.abort(new Error("Deadline exceeded"));
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      t.action(api.actions.bible.suggest, { question: "comfort" }),
    ).rejects.toThrow("Deadline exceeded");
    expect(AbortSignal.timeout).toHaveBeenCalledWith(25_000);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("defaults off, rejects server requests, and never calls a provider before opt-in", async () => {
    const t = await ownerTest(modules);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await t.query(api.bible.preferences, {})).toEqual({
      enabled: false,
      scope: "articles",
      translation: "web",
    });
    await expect(
      t.action(api.actions.bible.openPassage, { reference: "Psalms 23" }),
    ).rejects.toThrow("Enable Bible");
    await expect(
      t.action(api.actions.bible.suggest, { question: "hope" }),
    ).rejects.toThrow("Enable Bible");
    await expect(t.query(api.bible.translations, {})).rejects.toThrow(
      "Enable Bible",
    );
    await expect(
      t.mutation(api.bible.setPreferences, { scope: "bible" }),
    ).rejects.toThrow("Enable Bible");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps opt-in and discovery scope isolated between readers", async () => {
    const { owner, reader } = await secondReaderTest(modules);
    await owner.mutation(api.bible.setPreferences, {
      enabled: true,
      scope: "bible",
    });
    expect(await owner.query(api.bible.preferences, {})).toMatchObject({
      enabled: true,
      scope: "bible",
    });
    expect(await reader.query(api.bible.preferences, {})).toMatchObject({
      enabled: false,
      scope: "articles",
    });
    await owner.mutation(api.bible.setPreferences, { enabled: false });
    expect(await owner.query(api.bible.preferences, {})).toMatchObject({
      enabled: false,
      scope: "articles",
    });
  });
  it("refuses unlicensed versions instead of substituting WEB under another name", async () => {
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, { enabled: true });
    await expect(
      t.mutation(api.bible.setPreferences, { translation: "esv" }),
    ).rejects.toThrow("permission");
    await expect(
      t.action(api.actions.bible.openPassage, {
        reference: "John 3",
        translation: "niv",
      }),
    ).rejects.toThrow("permission");
  });
  it("offers direct references and reading-time suggestions without an AI key or fetching text", async () => {
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, { enabled: true });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (await t.action(api.actions.bible.suggest, { question: "Romans 8" }))
        .passages[0],
    ).toMatchObject({ reference: "Romans 8" });
    expect(
      (
        await t.action(api.actions.bible.suggest, {
          question: "I have 1 minute",
        })
      ).passages,
    ).toEqual([
      expect.objectContaining({ reference: "Psalms 23", minutes: 1 }),
    ]);
    expect(
      (await t.action(api.actions.bible.suggest, { question: "forgiveness" }))
        .passages[0],
    ).toMatchObject({ reference: "Luke 15" });
    expect(fetch).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("articles").take(10))).toEqual([]);
    expect(
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").take(10),
      ),
    ).toEqual([]);
  });
  it("opens a real passage once, preserves reader notes, and hides it when disabled without deleting it", async () => {
    vi.useFakeTimers();
    const { owner, reader } = await secondReaderTest(modules);
    await owner.mutation(api.bible.setPreferences, { enabled: true });
    const fetch = vi.fn().mockImplementation(async () => chapterResponse());
    vi.stubGlobal("fetch", fetch);
    const id = await owner.action(api.actions.bible.openPassage, {
      reference: "Psalm 23",
    });
    const article = await owner.query(api.articles.getById, { articleId: id });
    expect(article).toMatchObject({
      title: "Psalms 23",
      bible: { translation: "web" },
      annotationStatus: "pending",
    });
    const noteId = await owner.mutation(api.userNotes.create, {
      articleId: id,
      selectedText: "Yahweh is my shepherd",
      content: "My thought",
      contentPlain: "My thought",
    });
    const highlightId = await owner.mutation(api.highlights.create, {
      articleId: id,
      kind: "highlight",
      text: "Yahweh is my shepherd",
      paragraphIndex: 0,
    });
    expect(
      await owner.action(api.actions.bible.openPassage, {
        reference: "Psalms 23",
      }),
    ).toBe(id);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (await owner.query(api.userNotes.listByArticle, { articleId: id })).map(
        (n) => n._id,
      ),
    ).toContain(noteId);
    expect(
      (await owner.query(api.highlights.listByArticle, { articleId: id })).map(
        (h) => h._id,
      ),
    ).toContain(highlightId);
    expect(
      await reader.query(api.articles.getById, { articleId: id }),
    ).toBeNull();
    await owner.mutation(api.bible.setPreferences, { enabled: false });
    expect(
      await owner.query(api.articles.getById, { articleId: id }),
    ).toBeNull();
    await owner.mutation(api.bible.setPreferences, { enabled: true });
    expect(
      (await owner.query(api.userNotes.listByArticle, { articleId: id })).map(
        (n) => n._id,
      ),
    ).toContain(noteId);
  });
  it("rechecks opt-in before saving a response from an in-flight request", async () => {
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, { enabled: true });
    await t.mutation(api.bible.setPreferences, { enabled: false });
    await expect(
      t.mutation(internal.bible.savePassage, {
        userId: "default_user",
        reference: "Psalms 23",
        translation: "web",
        content: "fetched text",
        contentHtml: "<p>fetched text</p>",
        url: "https://example.com",
        copyright: "Public domain",
      }),
    ).rejects.toThrow("Enable Bible");
    expect(await t.run((ctx) => ctx.db.query("articles").take(10))).toEqual([]);
  });
  it("honors source filters in library retrieval and excludes Bible results when disabled", async () => {
    vi.useFakeTimers();
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, { enabled: true });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => chapterResponse()),
    );
    const bibleId = await t.action(api.actions.bible.openPassage, {
      reference: "Psalms 23",
    });
    const articleId = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: "default_user",
        guid: "article",
        url: "https://example.com",
        title: "An article",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      }),
    );
    const load = (scope: "articles" | "mixed" | "bible") =>
      t.query(internal.library.loadArticles, {
        userId: "default_user",
        articleIds: [articleId, bibleId],
        scope,
      });
    expect((await load("articles")).map((a) => a?.title ?? null)).toEqual([
      "An article",
      null,
    ]);
    expect((await load("bible")).map((a) => a?.title ?? null)).toEqual([
      null,
      "Psalms 23",
    ]);
    expect((await load("mixed")).filter(Boolean)).toHaveLength(2);
    await t.mutation(api.bible.setPreferences, { enabled: false });
    expect((await load("mixed")).map((a) => a?.title ?? null)).toEqual([
      "An article",
      null,
    ]);
  });
  it("annotates short Bible passages on demand rather than skipping the article minimum", async () => {
    vi.useFakeTimers();
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, { enabled: true });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => chapterResponse()),
    );
    const id = await t.action(api.actions.bible.openPassage, {
      reference: "Psalms 23",
    });
    await runScheduled(t);
    expect(
      await t.query(api.articles.getById, { articleId: id }),
    ).toMatchObject({ annotationStatus: "skipped", skipReason: "no_provider" });
  });
  it("doesn't let many opened Bible chapters crowd articles out of time suggestions", async () => {
    const t = await ownerTest(modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 30; i++)
        await ctx.db.insert("articles", {
          userId: "default_user",
          guid: `bible-${i}`,
          url: "https://example.com",
          title: `Bible ${i}`,
          bible: {
            reference: `Psalms ${i + 1}`,
            translation: "web",
            copyright: "Public domain",
          },
          estimatedReadMinutes: 5,
          extractionStatus: "extracted",
          annotationStatus: "annotated",
          createdAt: 1,
        });
      await ctx.db.insert("articles", {
        userId: "default_user",
        guid: "article",
        url: "https://example.com",
        title: "Unread article",
        estimatedReadMinutes: 5,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
    });
    expect(
      (await t.query(api.suggestions.forWindow, { requestedMinutes: 5 })).map(
        (p) => p.title,
      ),
    ).toEqual(["Unread article"]);
    expect(
      (await t.query(api.home.overview, {})).upNext.map((p) => p.title),
    ).toEqual(["Unread article"]);
  });
  it("stores only anchored marginalia for short Scripture and no essay-critique reflection", async () => {
    vi.useFakeTimers();
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, { enabled: true });
    await saveTestCredential(t, "default_user", "openrouter", "fixture-key");
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("bible-api.com")) return chapterResponse();
        const body = JSON.parse(String(init?.body));
        if (String(input).endsWith("/embeddings"))
          return Response.json({
            data: body.input.map((_: string, index: number) => ({
              index,
              embedding: Array.from({ length: 1536 }, () => 0.1),
            })),
          });
        return completion(body.model, {
          annotations: [
            {
              type: "context",
              anchorText: "Yahweh is my shepherd",
              content:
                "The shepherd image frames the psalm's trust in provision and guidance.",
              relevanceScore: 0.9,
              reasoning: "Explains the central image.",
            },
            {
              type: "context",
              anchorText: "Text not in the passage",
              content: "Unsupported note",
              relevanceScore: 1,
              reasoning: "Must be rejected.",
            },
          ],
          reflection: {
            strongestPoint: "",
            weakestAssumption: "",
            credibleCounterview: "",
            questionForYou: "",
          },
        });
      },
    );
    const id = await t.action(api.actions.bible.openPassage, {
      reference: "Psalms 23",
    });
    await t.action(internal.actions.generateAnnotations.generateForArticle, {
      articleId: id,
    });
    expect(
      await t.query(api.articles.getById, { articleId: id }),
    ).toMatchObject({ annotationStatus: "annotated" });
    expect(
      await t.query(api.annotations.listByArticle, { articleId: id }),
    ).toMatchObject([{ anchorText: "Yahweh is my shepherd", type: "context" }]);
    expect(
      await t.query(api.reflections.getByArticle, { articleId: id }),
    ).toBeNull();
  });
  it("discards invalid and over-budget AI recommendations", async () => {
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, { enabled: true });
    await saveTestCredential(t, "default_user", "openrouter", "fixture-key");
    vi.stubGlobal("fetch", async (_: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return completion(body.model, {
        passages: [
          { reference: "Jude 9", title: "Invented chapter", reason: "Invalid" },
          {
            reference: "Psalms 23",
            title: "Rest",
            reason: "Trust and provision",
          },
          {
            reference: "Romans 8",
            title: "Hope",
            reason: "Too long for this window",
          },
        ],
      });
    });
    const result = await t.action(api.actions.bible.suggest, {
      question: "comfort",
      minutes: 1,
    });
    expect(result.passages).toEqual([
      {
        reference: "Psalms 23",
        title: "Rest",
        reason: "Trust and provision",
        minutes: 1,
      },
    ]);
    expect(await t.run((ctx) => ctx.db.query("articles").take(10))).toEqual([]);
  });
});

function completion(model: string, object: unknown) {
  return Response.json({
    id: "fixture",
    created: 1,
    model,
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify(object) },
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}
