/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishArticleRemoval, proveArticleRemoval } from "../test/feedRemoval";
import { metadataContext } from "../test/metadata";
import {
  saveTestCredential,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { api, internal } from "./_generated/api";
import { MANUAL_ANNOTATION_LEASE_MS } from "./lib/manualAnnotations";
import schema from "./schema";

const model = vi.hoisted(() => ({ generate: vi.fn(), version: 3 }));
vi.mock("./lib/annotationGate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/annotationGate")>()),
  get CURRENT_ANNOTATION_VERSION() {
    return model.version;
  },
}));
vi.mock("./lib/aiModels", () => ({
  generateObjectWithFallback: model.generate,
}));
vi.mock("./lib/marginaliaContext", () => ({
  MAX_ARTICLE_CHARS: 30_000,
  buildMarginaliaContext: vi.fn(async (_ctx, article) => ({
    articleText: article.content,
    contextText: "",
    vaultPaths: [],
    libraryCandidates: [],
    sources: [],
  })),
}));
const modules = import.meta.glob("./**/*.ts");
const content = "A precise claim deserves careful scrutiny. ".repeat(100);
const result = {
  modelId: "fixture",
  object: {
    thesis: "Current thesis",
    gist: "Current gist",
    annotations: [
      {
        type: "strong_point",
        anchorText: "A precise claim deserves careful scrutiny.",
        content:
          "The comparison supports this specific inference because both groups share the same constraints.",
        relevanceScore: 0.9,
        reasoning: "Specific evidence",
      },
    ],
    reflection: {
      strongestPoint: "New strength",
      weakestAssumption: "New weakness",
      credibleCounterview: "New counterview",
      questionForYou: "New question",
    },
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  model.generate.mockReset();
  model.version = 3;
  model.generate.mockResolvedValue(result);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture(key = true) {
  const f = await secondReaderTest(modules);
  if (key)
    await saveTestCredential(
      f.t,
      f.readerLibraryId,
      "openrouter",
      "fixture-key",
    );
  const articleId = await f.t.run(async (ctx) => {
    const id = await ctx.db.insert("articles", {
      userId: f.readerLibraryId,
      guid: "manual",
      url: "https://example.com/manual",
      title: "Original",
      content,
      contentHtml: "",
      excerpt: "",
      wordCount: 700,
      estimatedReadMinutes: 4,
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: Date.now(),
    });
    await ctx.db.insert("annotations", {
      userId: f.readerLibraryId,
      articleId: id,
      type: "strong_point",
      anchorText: "A precise claim",
      anchorStartOffset: 0,
      anchorEndOffset: 15,
      content: "Successful old note",
      relevanceScore: 0.9,
      wasViewed: false,
      wasDismissed: false,
      createdAt: Date.now(),
    });
    await ctx.db.insert("reflections", {
      userId: f.readerLibraryId,
      articleId: id,
      strongestPoint: "Successful old reflection",
      weakestAssumption: "old",
      credibleCounterview: "old",
      questionForYou: "old",
      createdAt: Date.now(),
    });
    return id;
  });
  const request = () =>
    f.reader.action(api.articles.requestReannotate, { articleId });
  const state = () =>
    f.t.run((ctx) => ctx.db.query("manualAnnotationState").unique());
  const margin = () =>
    f.t.run(async (ctx) => ({
      notes: await ctx.db.query("annotations").collect(),
      reflections: await ctx.db.query("reflections").collect(),
      summaries: await ctx.db.query("summaries").collect(),
    }));
  const run = async () =>
    f.t.action(internal.actions.generateAnnotations.generateForArticle, {
      articleId,
      generation: { run: (await state())!.run },
    });
  return { ...f, articleId, request, state, margin, run };
}

function holdModel(value = result) {
  let release!: (value: typeof result) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  model.generate.mockImplementationOnce(() => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  return { started, release: () => release(value) };
}

describe("manual reannotation consuming lifecycle", () => {
  it.each([
    ["keep", "before"],
    ["paused", "before"],
    ["keep", "during"],
    ["paused", "during"],
  ] as const)("retains generation access when a feed is %s %s generation", async (operation, when) => {
    const f = await fixture();
    const feedId = await f.reader.mutation(api.feeds.add, {
      url: "https://example.com/feed",
      title: "Feed",
    });
    await f.t.run((ctx) =>
      metadataContext(ctx).db.patch(f.articleId, { feedId }),
    );
    const changeSubscription = () =>
      operation === "keep"
        ? f.reader.mutation(api.feeds.remove, { feedId, articles: "keep" })
        : f.reader.mutation(api.feeds.toggleActive, { feedId });
    if (when === "before") await changeSubscription();
    await f.request();
    const hold = holdModel();
    const running = f.run();
    await hold.started;
    if (when === "during") await changeSubscription();
    await f.request();
    hold.release();
    await running;
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect((await f.margin()).reflections[0].strongestPoint).toBe(
      "New strength",
    );
    expect(await f.state()).toMatchObject({ run: 1, status: "complete" });
    expect(
      await f.reader.query(api.articles.getById, { articleId: f.articleId }),
    ).not.toBeNull();
  });

  it("does reject a held completion when removing the actual feed article", async () => {
    const f = await fixture();
    const feedId = await f.reader.mutation(api.feeds.add, {
      url: "https://example.com/feed",
      title: "Feed",
    });
    await f.t.run((ctx) =>
      metadataContext(ctx).db.patch(f.articleId, { feedId }),
    );
    await f.request();
    const hold = holdModel();
    const running = f.run();
    await hold.started;
    await f.reader.mutation(api.feeds.remove, { feedId, articles: "all" });
    // Deliver the public mutation's queued removal page without advancing paid jobs.
    await f.t.mutation(internal.feeds.removeArticles, {
      userId: f.readerLibraryId,
      feedId,
      choice: "all",
    });
    await proveArticleRemoval(f.t, f.articleId);
    hold.release();
    await running;
    expect(
      await f.reader.query(api.articles.getById, { articleId: f.articleId }),
    ).toBeNull();
    const retained = await f.margin();
    expect(retained.notes.map((note) => note.content)).toEqual([
      "Successful old note",
    ]);
    expect(retained.reflections.map((row) => row.strongestPoint)).toEqual([
      "Successful old reflection",
    ]);
    expect(retained.summaries).toEqual([]);
    await finishArticleRemoval(f.t, f.articleId);
    expect(await f.margin()).toEqual({
      notes: [],
      reflections: [],
      summaries: [],
    });
    expect(await f.state()).toBeNull();
  });

  it.each([
    "source",
    "fingerprint",
    "version",
  ])("lets a fresh queued legacy payload acquire a current token after %s changes", async (change) => {
    const f = await fixture();
    if (change === "fingerprint") {
      // Exercise the deployed ready-stamp path as well as legacy fixtures.
      for (let page = 0; page < 8; page++) {
        if (
          (
            await f.t.mutation(internal.fingerprintMetadata.backfill, {
              userId: f.readerLibraryId,
            })
          ).complete
        )
          break;
      }
      expect(
        await f.t.query(internal.fingerprintMetadata.verify, {
          userId: f.readerLibraryId,
        }),
      ).toEqual({ ready: true, matches: true });
    }
    await f.request();
    await f.run();
    if (change === "source")
      await f.t.mutation(internal.articles.updateExtracted, {
        articleId: f.articleId,
        content: `${content} Changed.`,
        contentHtml: "",
        excerpt: "",
        wordCount: 700,
        estimatedReadMinutes: 4,
      });
    if (change === "fingerprint")
      await f.t.run((ctx) =>
        metadataContext(ctx).db.insert("userNotes", {
          userId: f.readerLibraryId,
          articleId: f.articleId,
          selectedText: "Claim",
          content: "New context",
          contentPlain: "New context",
          createdAt: Date.now(),
          updatedAt: Date.now() + 1,
        }),
      );
    let claim: number | undefined;
    if (change === "version") {
      model.version = 4;
      expect(
        await f.t.mutation(internal.reannotateBackfill.start, {
          userId: f.readerLibraryId,
        }),
      ).toBe("started");
      await f.t.mutation(internal.reannotateBackfill.step, {
        userId: f.readerLibraryId,
        runId: 1,
      });
      claim = (await f.t.run((ctx) => ctx.db.get(f.articleId)))!
        .reannotateClaimedAt;
      expect(claim).toBe(Date.now());
    }
    const fresh = {
      ...result,
      object: {
        ...result.object,
        reflection: {
          ...result.object.reflection,
          strongestPoint: "Fresh automatic generation",
        },
      },
    };
    const hold = holdModel(fresh);
    const payload = { articleId: f.articleId, claim };
    const running = f.t.action(
      internal.actions.generateAnnotations.generateForArticle,
      payload,
    );
    await hold.started;
    await f.t.action(
      internal.actions.generateAnnotations.generateForArticle,
      payload,
    );
    expect(
      await f.t.mutation(internal.annotations.replaceForArticle, {
        articleId: f.articleId,
        userId: f.readerLibraryId,
        notes: [],
        reflection: {
          ...result.object.reflection,
          strongestPoint: "Stale tokenless writer",
        },
      }),
    ).toBe(false);
    expect(
      await f.t.mutation(internal.annotations.replaceForArticle, {
        articleId: f.articleId,
        userId: f.readerLibraryId,
        generation: { run: 1 },
        notes: [],
        reflection: result.object.reflection,
      }),
    ).toBe(false);
    expect(await f.state()).toMatchObject({
      run: 2,
      status: "running",
      published: false,
    });
    hold.release();
    await running;
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect((await f.margin()).reflections[0].strongestPoint).toBe(
      "Fresh automatic generation",
    );
    expect((await f.margin()).notes).toHaveLength(1);
    expect(await f.state()).toMatchObject({
      run: 2,
      status: "complete",
      published: true,
    });
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.articleId)))!.reannotateClaimedAt,
    ).toBeUndefined();
    await f.t.action(internal.actions.generateAnnotations.generateForArticle, {
      articleId: f.articleId,
    });
    expect(model.generate).toHaveBeenCalledTimes(2);
  });

  it("never lets a tokenless automatic job steal an active manual claim, even after source changes", async () => {
    const f = await fixture();
    await f.request();
    const hold = holdModel();
    const running = f.run();
    await hold.started;
    await f.t.mutation(internal.articles.updateExtracted, {
      articleId: f.articleId,
      content: `${content} Changed.`,
      contentHtml: "",
      excerpt: "",
      wordCount: 700,
      estimatedReadMinutes: 4,
    });
    await f.t.action(internal.actions.generateAnnotations.generateForArticle, {
      articleId: f.articleId,
    });
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(await f.state()).toMatchObject({ run: 1, status: "running" });
    hold.release();
    await running;
    expect((await f.margin()).notes[0].content).toBe("Successful old note");
  });

  it("does not adopt another library's generation through an old queued article payload", async () => {
    const f = await fixture();
    await f.request();
    await f.run();
    await f.t.run((ctx) =>
      metadataContext(ctx).db.patch(f.articleId, { userId: "default_user" }),
    );
    await f.t.action(internal.actions.generateAnnotations.generateForArticle, {
      articleId: f.articleId,
    });
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(await f.state()).toMatchObject({
      userId: f.readerLibraryId,
      run: 1,
      status: "complete",
    });
  });

  it("does not automatically rebuy completed or retry failed/lost unchanged input", async () => {
    const f = await fixture();
    await f.request();
    await f.run();
    await f.t.action(internal.actions.generateAnnotations.generateForArticle, {
      articleId: f.articleId,
    });
    expect(model.generate).toHaveBeenCalledTimes(1);
    const failed = await fixture();
    model.generate.mockRejectedValueOnce(new Error("Fixture failure"));
    await failed.request();
    await failed.run();
    await failed.t.action(
      internal.actions.generateAnnotations.generateForArticle,
      { articleId: failed.articleId },
    );
    vi.setSystemTime(Date.now() + MANUAL_ANNOTATION_LEASE_MS);
    await failed.t.action(
      internal.actions.generateAnnotations.generateForArticle,
      { articleId: failed.articleId },
    );
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(await failed.state()).toMatchObject({
      run: 1,
      status: "failed",
      attempts: 1,
    });
    await failed.request();
    await failed.run();
    expect(model.generate).toHaveBeenCalledTimes(3);
    expect(await failed.state()).toMatchObject({ run: 2, status: "complete" });
    const lost = await fixture();
    await lost.request();
    vi.setSystemTime(Date.now() + MANUAL_ANNOTATION_LEASE_MS);
    await lost.t.action(
      internal.actions.generateAnnotations.generateForArticle,
      { articleId: lost.articleId },
    );
    expect(model.generate).toHaveBeenCalledTimes(3);
    expect(await lost.state()).toMatchObject({ run: 1, status: "queued" });
  });

  it("rejects direct tokenless tag publication after adoption while accepting a current token (main-owned guard overlay)", async () => {
    const f = await fixture();
    const [astronomy, geology] = await f.t.run(async (ctx) =>
      Promise.all(
        ["Astronomy", "Geology"].map((name) =>
          ctx.db.insert("tags", {
            userId: f.readerLibraryId,
            name,
            key: name.toLowerCase(),
            status: "active",
            count: 0,
            aliases: [],
            createdAt: Date.now(),
          }),
        ),
      ),
    );
    await f.t.mutation(internal.tags.assign, {
      userId: f.readerLibraryId,
      articleId: f.articleId,
      proposals: [{ name: "Astronomy" }],
    });
    await f.request();
    await f.t.mutation(internal.manualAnnotations.begin, {
      articleId: f.articleId,
      generation: { run: 1 },
    });
    await f.t.mutation(internal.tags.assign, {
      userId: f.readerLibraryId,
      articleId: f.articleId,
      proposals: [{ name: "Geology" }],
    });
    expect(
      (await f.t.run((ctx) => ctx.db.query("articleTags").collect())).map(
        (row) => row.tagId,
      ),
    ).toEqual([astronomy]);
    await f.t.mutation(internal.manualAnnotations.assignTags, {
      userId: f.readerLibraryId,
      articleId: f.articleId,
      generation: { run: 1 },
      proposals: [{ name: "Geology" }],
    });
    expect(
      (await f.t.run((ctx) => ctx.db.query("articleTags").collect())).map(
        (row) => row.tagId,
      ),
    ).toEqual([geology]);
    expect(await f.t.run((ctx) => ctx.db.get(astronomy))).toMatchObject({
      count: 0,
    });
    expect(await f.t.run((ctx) => ctx.db.get(geology))).toMatchObject({
      count: 1,
    });
  });

  it("coalesces two clients and duplicate delivery before model dispatch; atomically replaces once", async () => {
    const f = await fixture();
    await Promise.all([f.request(), f.request()]);
    expect(await f.margin()).toMatchObject({
      notes: [{ content: "Successful old note" }],
      reflections: [{ strongestPoint: "Successful old reflection" }],
    });
    const hold = holdModel();
    const running = f.run();
    await hold.started;
    const lease = (await f.state())!.leaseUntil;
    vi.setSystemTime(Date.now() + 100);
    await f.request();
    expect((await f.state())!.leaseUntil).toBe(lease);
    await f.run();
    expect(model.generate).toHaveBeenCalledTimes(1);
    hold.release();
    await running;
    expect((await f.margin()).notes).toHaveLength(1);
    expect((await f.margin()).reflections[0].strongestPoint).toBe(
      "New strength",
    );
    expect(await f.state()).toMatchObject({
      status: "complete",
      published: true,
      attempts: 1,
    });
    await f.request();
    await f.run();
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    "source",
    "sourceABA",
    "modelABA",
    "context",
    "deleted",
    "disabled",
    "deleting",
    "ownerChanged",
  ])("rejects a held completion after %s changes, including extras", async (change) => {
    const f = await fixture();
    const models = await f.reader.query(api.userSettings.getModels, {});
    if (change === "modelABA")
      await f.reader.mutation(api.userSettings.setModel, {
        role: "annotations",
        model: models.available[0].id,
      });
    await f.request();
    const hold = holdModel();
    const running = f.run();
    await hold.started;
    if (change === "source")
      await f.t.mutation(internal.articles.updateExtracted, {
        articleId: f.articleId,
        content: `${content} Changed.`,
        contentHtml: "",
        excerpt: "",
        wordCount: 701,
        estimatedReadMinutes: 4,
      });
    if (change === "sourceABA") {
      // Public mutation wrappers run the main-owned shared trigger seam.
      await f.t.mutation(internal.articles.updateExtracted, {
        articleId: f.articleId,
        content: `${content} Changed.`,
        contentHtml: "",
        excerpt: "",
        wordCount: 701,
        estimatedReadMinutes: 4,
      });
      await f.t.mutation(internal.articles.updateExtracted, {
        articleId: f.articleId,
        content,
        contentHtml: "",
        excerpt: "",
        wordCount: 700,
        estimatedReadMinutes: 4,
      });
    }
    if (change === "modelABA") {
      await f.reader.mutation(api.userSettings.setModel, {
        role: "annotations",
        model: models.available[1].id,
      });
      await f.reader.mutation(api.userSettings.setModel, {
        role: "annotations",
        model: models.available[0].id,
      });
    }
    if (change === "context")
      await f.t.run((ctx) =>
        ctx.db.insert("userNotes", {
          userId: f.readerLibraryId,
          articleId: f.articleId,
          selectedText: "Claim",
          content: "New reader context",
          contentPlain: "New reader context",
          createdAt: Date.now(),
          updatedAt: Date.now() + 1,
        }),
      );
    if (change === "deleted")
      await f.t.run((ctx) => ctx.db.delete(f.articleId));
    if (change === "disabled" || change === "deleting")
      await f.t.run(async (ctx) => {
        const reader = await ctx.db.query("readers").first();
        await ctx.db.patch(
          reader!._id,
          change === "disabled"
            ? { status: "disabled" }
            : { deletingAt: Date.now() },
        );
      });
    if (change === "ownerChanged")
      await f.t.run((ctx) =>
        metadataContext(ctx).db.patch(f.articleId, { userId: "default_user" }),
      );
    hold.release();
    await running;
    expect((await f.margin()).notes[0].content).toBe("Successful old note");
    expect((await f.margin()).summaries).toEqual([]);
  });

  it("fences an old token after a new exact input is requested and completed", async () => {
    const f = await fixture();
    await f.request();
    const hold = holdModel();
    const old = f.run();
    await hold.started;
    await f.t.mutation(internal.articles.updateExtracted, {
      articleId: f.articleId,
      content: `${content} New.`,
      contentHtml: "",
      excerpt: "",
      wordCount: 700,
      estimatedReadMinutes: 4,
    });
    await f.request();
    await f.run();
    hold.release();
    await old;
    expect(await f.state()).toMatchObject({ run: 2, status: "complete" });
    expect((await f.margin()).notes).toHaveLength(1);
  });

  it("preserves output on provider/no-key failure and allows only three explicit attempts", async () => {
    const f = await fixture();
    model.generate.mockRejectedValue(new Error("fixture provider failure"));
    for (let n = 1; n <= 3; n++) {
      await f.request();
      await f.run();
      expect(await f.state()).toMatchObject({ attempts: n, status: "failed" });
    }
    await expect(f.request()).rejects.toThrow(/three attempts/);
    expect(model.generate).toHaveBeenCalledTimes(3);
    expect((await f.margin()).notes[0].content).toBe("Successful old note");
    const noKey = await fixture(false);
    await noKey.request();
    await noKey.run();
    expect(await noKey.state()).toMatchObject({ status: "failed" });
    expect(model.generate).toHaveBeenCalledTimes(3);
    expect((await noKey.margin()).reflections[0].strongestPoint).toBe(
      "Successful old reflection",
    );
  });

  it("recovers a lost delivery only on an explicit request after the finite lease", async () => {
    const f = await fixture();
    await f.request();
    // Moving wall time without running the scheduler simulates a lost action.
    vi.setSystemTime(Date.now() + MANUAL_ANNOTATION_LEASE_MS);
    expect(model.generate).not.toHaveBeenCalled();
    await f.request();
    await f.run();
    expect(await f.state()).toMatchObject({
      run: 2,
      attempts: 2,
      status: "complete",
    });
    await f.t.action(internal.actions.generateAnnotations.generateForArticle, {
      articleId: f.articleId,
      generation: { run: 1 },
    });
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it("rejects foreign requests and tokenless legacy completion/status/overview after adoption", async () => {
    const f = await fixture();
    await expect(
      f.owner.action(api.articles.requestReannotate, {
        articleId: f.articleId,
      }),
    ).rejects.toThrow();
    await f.request();
    await f.t.action(internal.actions.generateAnnotations.generateForArticle, {
      articleId: f.articleId,
    });
    await f.t.mutation(internal.annotations.deleteByArticle, {
      articleId: f.articleId,
    });
    await f.t.mutation(internal.reflections.deleteByArticle, {
      articleId: f.articleId,
    });
    expect(
      await f.t.mutation(internal.annotations.replaceForArticle, {
        articleId: f.articleId,
        userId: f.readerLibraryId,
        notes: [],
        reflection: result.object.reflection,
      }),
    ).toBe(false);
    await f.t.mutation(internal.articles.updateAnnotationStatus, {
      articleId: f.articleId,
      status: "failed",
    });
    await f.t.mutation(internal.summaries.saveOverview, {
      userId: f.readerLibraryId,
      articleId: f.articleId,
      thesis: "Stale",
      gist: "Stale",
      model: "legacy",
    });
    expect(model.generate).not.toHaveBeenCalled();
    expect((await f.margin()).summaries).toEqual([]);
    expect((await f.margin()).notes[0].content).toBe("Successful old note");
    expect((await f.margin()).reflections[0].strongestPoint).toBe(
      "Successful old reflection",
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.articleId))).toMatchObject({
      annotationStatus: "annotated",
    });
  });

  it("holds ownership through extras and rejects stale overview/tag callbacks", async () => {
    const f = await fixture();
    await f.request();
    await f.t.mutation(internal.manualAnnotations.begin, {
      articleId: f.articleId,
      generation: { run: 1 },
    });
    // A current margin has committed, but its final extras have not settled.
    await f.t.mutation(internal.annotations.replaceForArticle, {
      articleId: f.articleId,
      userId: f.readerLibraryId,
      generation: { run: 1 },
      notes: [],
      reflection: result.object.reflection,
    });
    await f.request();
    expect(await f.state()).toMatchObject({ run: 1, status: "running" });
    await f.t.mutation(internal.articles.updateExtracted, {
      articleId: f.articleId,
      content: `${content} Changed.`,
      contentHtml: "",
      excerpt: "",
      wordCount: 700,
      estimatedReadMinutes: 4,
    });
    await f.request();
    await f.t.mutation(internal.summaries.saveOverview, {
      articleId: f.articleId,
      userId: f.readerLibraryId,
      generation: { run: 1 },
      thesis: "Stale",
      gist: "Stale",
      model: "old",
    });
    await f.t.mutation(internal.manualAnnotations.assignTags, {
      articleId: f.articleId,
      userId: f.readerLibraryId,
      generation: { run: 1 },
      proposals: [{ name: "stale tag" }],
    });
    await f.t.mutation(internal.manualAnnotations.finish, {
      articleId: f.articleId,
      generation: { run: 1 },
    });
    expect((await f.margin()).summaries).toEqual([]);
    expect(await f.t.run((ctx) => ctx.db.query("tags").collect())).toEqual([]);
    expect(await f.state()).toMatchObject({
      run: 2,
      status: "queued",
      published: false,
    });
  });

  it("preserves the shared book-unit overview and tag extras without a manual article claim", async () => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.patch(f.articleId, { bookUnitCount: 1 }));
    await f.t.run((ctx) =>
      ctx.db.insert("tags", {
        userId: f.readerLibraryId,
        name: "Astronomy",
        key: "astronomy",
        status: "active",
        count: 0,
        aliases: [],
        createdAt: Date.now(),
      }),
    );
    await f.t.mutation(internal.summaries.saveOverview, {
      articleId: f.articleId,
      userId: f.readerLibraryId,
      thesis: "Book unit thesis",
      gist: "Book unit gist",
      model: "fixture",
    });
    await f.t.mutation(internal.manualAnnotations.assignTags, {
      articleId: f.articleId,
      userId: f.readerLibraryId,
      proposals: [{ name: "Astronomy" }],
    });
    expect((await f.margin()).summaries[0].thesis).toBe("Book unit thesis");
    expect(
      await f.t.run((ctx) => ctx.db.query("articleTags").collect()),
    ).toHaveLength(1);
    expect(await f.state()).toBeNull();
  });

  it("does not spend again when recovery finds the margin already committed", async () => {
    const f = await fixture();
    await f.request();
    await f.t.mutation(internal.manualAnnotations.begin, {
      articleId: f.articleId,
      generation: { run: 1 },
    });
    await f.t.mutation(internal.annotations.replaceForArticle, {
      articleId: f.articleId,
      userId: f.readerLibraryId,
      generation: { run: 1 },
      notes: [],
      reflection: result.object.reflection,
    });
    vi.setSystemTime(Date.now() + MANUAL_ANNOTATION_LEASE_MS);
    await f.request();
    await f.run();
    expect(model.generate).not.toHaveBeenCalled();
    expect(await f.state()).toMatchObject({
      status: "complete",
      run: 1,
      attempts: 1,
    });
    expect((await f.margin()).reflections[0].strongestPoint).toBe(
      "New strength",
    );
  });

  it("hashes exact Unicode and the tail of near-limit sources within transaction budgets", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    await saveTestCredential(t, "default_user", "openrouter", "fixture-key");
    const body = `${content}${"漢🌟".repeat(120_000)}e\u0301`;
    const articleId = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: "default_user",
        guid: "large",
        url: "https://example.com/large",
        title: "Unicode",
        content: body,
        wordCount: 700,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      }),
    );
    await t.mutation(internal.manualAnnotations.request, {
      articleId,
      userId: "default_user",
    });
    const first = await t.run((ctx) =>
      ctx.db.query("manualAnnotationState").unique(),
    );
    await t.run((ctx) =>
      ctx.db.patch(articleId, { content: `${body.slice(0, -2)}é` }),
    );
    await t.mutation(internal.manualAnnotations.request, {
      articleId,
      userId: "default_user",
    });
    const second = await t.run((ctx) =>
      ctx.db.query("manualAnnotationState").unique(),
    );
    expect(second!.input).not.toBe(first!.input);
    expect(second!.input).toMatch(/^[a-f0-9]{64}$/);
    await t.action(internal.actions.generateAnnotations.generateForArticle, {
      articleId,
      generation: { run: 2 },
    });
    expect(
      await t.run((ctx) => ctx.db.query("manualAnnotationState").unique()),
    ).toMatchObject({ status: "complete" });
    expect(
      await t.run((ctx) => ctx.db.query("annotations").collect()),
    ).toHaveLength(1);
  });
});
