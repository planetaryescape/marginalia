/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runScheduled,
  saveTestCredential,
  secondReaderTest,
} from "../test/owner";
import { contentHtml, selection, studyFixture } from "../test/scriptureStudy";
import { api, internal } from "./_generated/api";
import * as aiModels from "./lib/aiModels";
import { deleteArticle } from "./lib/feedRemoval";
import { sourceHash } from "./lib/preparedRepresentation";
import {
  STUDY_LIMITS,
  STUDY_SOURCE_REGISTRY,
  type StudyEvidence,
} from "./lib/scriptureStudy";
import { sha256Hex } from "./lib/tokens";

const modules = import.meta.glob("./**/*.ts");
const setup = () => studyFixture(modules);
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Study bounds and cleanup", () => {
  it("enforces the deliberate selection and generation bounds", async () => {
    const { t, args, model } = await setup();
    const tooMany = {
      ...selection,
      endVerseId: "JHN.1.41",
      referenceKey: "JHN.1.1-JHN.1.41",
    };
    await expect(
      t.mutation(api.scriptureStudy.start, { ...args, selection: tooMany }),
    ).rejects.toThrow("40 verses");
    const oversized = `1:1 ${"a".repeat(STUDY_LIMITS.sourceChars)}\n\n1:2 two`;
    await t.run((ctx) => ctx.db.patch(args.articleId, { content: oversized }));
    await expect(
      t.mutation(api.scriptureStudy.start, {
        ...args,
        sourceHash: await sourceHash(oversized, contentHtml),
      }),
    ).rejects.toThrow("source limit");
    expect(model).not.toHaveBeenCalled();
    expect(STUDY_LIMITS).toMatchObject({
      verses: 40,
      externalRequests: 8,
      evidence: 16,
      findings: 6,
      outputTokens: 6000,
      modelAttempts: 2,
      deadlineMs: 90000,
      activePerReader: 1,
      newRunsPerHour: 6,
    });
  });
  it("joins concurrent starts atomically", async () => {
    const { t, args } = await setup();
    const result = await Promise.all([
      t.mutation(api.scriptureStudy.start, args),
      t.mutation(api.scriptureStudy.start, {
        ...args,
        requestKey: "concurrent",
      }),
    ]);
    expect(new Set(result.map((run) => run.runId)).size).toBe(1);
    expect(result.map((run) => run.admission).sort()).toEqual([
      "joined",
      "started",
    ]);
    expect(
      (await t.run((ctx) => ctx.db.query("scriptureStudyBudgets").first()))
        ?.starts,
    ).toHaveLength(1);
  });
  it("fails a configured ChatGPT plan explicitly without source work or silent vendor fallback", async () => {
    const { t, args, fetch, model } = await setup();
    vi.stubEnv("CHATGPT_PLAN_ENABLED", "true");
    vi.stubEnv("CHATGPT_CLIENT_ID", "synthetic-client");
    vi.stubEnv("CHATGPT_REDIRECT_URI", "https://fixture.example/callback");
    await t.run(async (ctx) => {
      const settings = await ctx.db.query("userSettings").first();
      if (settings)
        await ctx.db.patch(settings._id, {
          deepModel: "chatgpt:fixture-model",
        });
      await ctx.db.insert("chatgptConnections", {
        userId: "default_user",
        subject: "synthetic-subject",
        clientId: "synthetic-client",
        ciphertext: "synthetic-ciphertext",
        iv: "synthetic-iv",
        scopes: [],
        planEnabled: true,
        expiresAt: Date.now() + 3600000,
        status: "connected",
        models: [{ id: "chatgpt:fixture-model", name: "Fixture" }],
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const run = await t.mutation(api.scriptureStudy.start, args);
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: run.runId,
    });
    expect(
      (await t.query(api.scriptureStudy.get, { studyId: run.studyId }))
        .activeRun,
    ).toMatchObject({
      status: "failed",
      errorCode: "model_output_limit_unavailable",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
  });
  it("stops retrieval after opt-out during the first source await", async () => {
    const { t, args, fetch, model } = await setup();
    const source = fetch.getMockImplementation();
    if (!source) throw new Error("Missing source fixture");
    fetch.mockImplementationOnce(async (input) => {
      await t.mutation(api.bible.setPreferences, { enabled: false });
      await t.mutation(api.bible.setPreferences, { enabled: true });
      return source(input);
    });
    const run = await t.mutation(api.scriptureStudy.start, args);
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: run.runId,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(model).not.toHaveBeenCalled();
    expect(
      (await t.query(api.scriptureStudy.get, { studyId: run.studyId }))
        .activeRun?.status,
    ).toBe("cancelled");
  });
  it("rejects a provider response labelled as a licensed edition", async () => {
    const { t, args, fetch, model } = await setup();
    fetch.mockResolvedValueOnce(
      Response.json({
        translation: { identifier: "niv" },
        verses: [
          {
            book_id: "JHN",
            chapter: 1,
            verse: 1,
            text: "LICENSED_PROVIDER_CANARY",
          },
        ],
      }),
    );
    const run = await t.mutation(api.scriptureStudy.start, args);
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: run.runId,
    });
    expect(model).not.toHaveBeenCalled();
    expect(
      (await t.query(api.scriptureStudy.get, { studyId: run.studyId }))
        .activeRun?.status,
    ).toBe("failed");
  });
  it("reuses completed results after credential rotation without another model request", async () => {
    const { t, args, model } = await setup();
    const run = await t.mutation(api.scriptureStudy.start, args);
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: run.runId,
    });
    await t.run(async (ctx) => {
      const key = await ctx.db.query("providerCredentials").first();
      if (key)
        await ctx.db.patch(key._id, { ciphertext: "rotated-ciphertext" });
    });
    expect(
      await t.mutation(api.scriptureStudy.start, {
        ...args,
        requestKey: "after-rotation",
      }),
    ).toMatchObject({ ...run, admission: "reused" });
    expect(model).toHaveBeenCalledTimes(1);
  });
  it("checks manifest record/excerpt/total limits, registry capabilities and hashes", async () => {
    const { t, args } = await setup();
    const run = await t.mutation(api.scriptureStudy.start, args);
    await t.mutation(internal.scriptureStudyRuns.claim, {
      runId: run.runId,
      claimToken: "claim",
    });
    const excerpt = "Public WEB verse one";
    const item: StudyEvidence = {
      evidenceId: "web-1",
      source: {
        ...STUDY_SOURCE_REGISTRY[0],
        capabilities: ["passage_text"],
        attribution: "World English Bible",
        url: "https://bible-api.com/data/web/JHN/1",
        licenseUrl: "https://worldenglish.bible/",
      },
      locator: selection.referenceKey,
      referenceKey: selection.referenceKey,
      excerpt,
      contentHash: await sha256Hex(excerpt),
      retrievedAt: Date.now(),
      limitations: [],
    };
    for (const evidence of [
      Array.from({ length: 17 }, (_, i) => ({
        ...item,
        evidenceId: `id-${i}`,
      })),
      [{ ...item, excerpt: "a".repeat(6001) }],
      Array.from({ length: 5 }, (_, i) => ({
        ...item,
        evidenceId: `id-${i}`,
        excerpt: "a".repeat(6000),
      })),
      [{ ...item, source: { ...item.source, capabilities: ["apparatus"] } }],
      [{ ...item, contentHash: "invented" }],
    ])
      await expect(
        t.mutation(internal.scriptureStudyRuns.manifest, {
          runId: run.runId,
          claimToken: "claim",
          evidence,
        }),
      ).rejects.toThrow();
  });
  it("expires a lease reactively and sweeps unpublished rows without retrying", async () => {
    const { t, args, model } = await setup();
    const run = await t.mutation(api.scriptureStudy.start, args);
    vi.setSystemTime(Date.now() + STUDY_LIMITS.deadlineMs + 1);
    await t.mutation(internal.scriptureStudyRuns.expire, { runId: run.runId });
    expect(await t.run((ctx) => ctx.db.get(run.runId))).toMatchObject({
      status: "failed",
      errorCode: "lease_expired",
    });
    expect(
      (await t.query(api.scriptureStudy.get, { studyId: run.studyId }))
        .activeRun,
    ).toMatchObject({ status: "failed", errorCode: "lease_expired" });
    vi.setSystemTime(Date.now() + STUDY_LIMITS.temporaryRetentionMs + 1);
    await t.mutation(internal.scriptureStudyCleanup.sweep, {});
    expect(await t.run((ctx) => ctx.db.get(run.runId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(run.studyId))).toBeNull();
    expect(model).not.toHaveBeenCalled();
  });
  it("retains completed output through sweeps, then deletes children after explicit remove", async () => {
    const { t, args, noteId, markId } = await setup();
    const run = await t.mutation(api.scriptureStudy.start, args);
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: run.runId,
    });
    const now = Date.now();
    vi.setSystemTime(now + 7 * STUDY_LIMITS.temporaryRetentionMs);
    await t.mutation(internal.scriptureStudyCleanup.sweep, {});
    vi.setSystemTime(now);
    expect(
      (await t.query(api.scriptureStudy.get, { studyId: run.studyId }))
        .publishedRun?.runId,
    ).toBe(run.runId);
    await t.mutation(api.scriptureStudy.remove, { studyId: run.studyId });
    await expect(
      t.query(api.scriptureStudy.evidence, {
        runId: run.runId,
        evidenceId: "web-1",
      }),
    ).rejects.toThrow();
    await t.mutation(internal.scriptureStudyCleanup.study, {
      studyId: run.studyId,
      userId: "default_user",
    });
    expect(
      await t.run((ctx) => ctx.db.query("scriptureStudyFindings").take(10)),
    ).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(run.runId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(noteId))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(markId))).not.toBeNull();
  });
  it("uses the existing article cleanup job to remove all Study children", async () => {
    const { t, args } = await setup();
    const run = await t.mutation(api.scriptureStudy.start, args);
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: run.runId,
    });
    await t.run(async (ctx) => {
      const article = await ctx.db.get(args.articleId);
      if (article) await deleteArticle(ctx, article);
    });
    const job = await t.run((ctx) =>
      ctx.db.query("feedArticleCleanup").first(),
    );
    expect(job).not.toBeNull();
    if (!job) throw new Error("Missing cleanup job");
    for (let i = 0; i < 15; i++)
      await t.mutation(internal.feedRemovalCleanup.discard, { jobId: job._id });
    for (const table of [
      "scriptureStudies",
      "scriptureStudyRuns",
      "scriptureStudyFindings",
    ] as const)
      expect(await t.run((ctx) => ctx.db.query(table).take(1))).toEqual([]);
  });
  it("publishes honest WEB findings when the original-language edition lacks a selected verse", async () => {
    const { t, args, fetch, model } = await setup();
    const normal = fetch.getMockImplementation();
    if (!normal) throw new Error("Missing source fixture");
    fetch.mockImplementation(async (input) =>
      input.endsWith("/JOH.csv")
        ? new Response("chapter,verse,text\n1,3,λογος 3056 {N-NSM}\n")
        : normal(input),
    );
    const run = await t.mutation(api.scriptureStudy.start, args);
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: run.runId,
    });
    expect(
      (await t.query(api.scriptureStudy.get, { studyId: run.studyId }))
        .publishedRun?.status,
    ).toBe("complete");
    expect(model.mock.calls[0][0].prompt).toContain(
      "verse mapping was not safely verified",
    );
    expect(
      (
        await t.query(api.scriptureStudy.evidence, {
          runId: run.runId,
          evidenceId: "web-1",
        })
      )?.limitations.join(" "),
    ).toContain("unavailable");
  });
  it("aborts a model that is still awaiting after cancellation", async () => {
    const { t, args, model } = await setup();
    const run = await t.mutation(api.scriptureStudy.start, args);
    let entered = false;
    model.mockImplementationOnce(async (options) => {
      entered = true;
      return new Promise((_resolve, reject) =>
        options.signal?.addEventListener(
          "abort",
          () => reject(options.signal?.reason),
          { once: true },
        ),
      );
    });
    const generating = t.action(internal.actions.scriptureStudy.generate, {
      runId: run.runId,
    });
    await vi.waitFor(() => expect(entered).toBe(true));
    await t.mutation(api.scriptureStudy.cancel, {
      studyId: run.studyId,
      runId: run.runId,
    });
    await vi.advanceTimersByTimeAsync(500);
    await generating;
    expect(model.mock.calls[0][0].signal?.aborted).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(run.runId)))?.status).toBe(
      "cancelled",
    );
  });
  it("account deletion during generation fences writes and the actual account purge removes Study rows", async () => {
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    await reader.mutation(api.bible.setPreferences, { enabled: true });
    await saveTestCredential(t, readerLibraryId, "anthropic", "synthetic-key");
    const content = "1:1 Public WEB verse one\n\n1:2 Public WEB verse two";
    const articleId = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: readerLibraryId,
        guid: "account-fixture",
        url: "https://bible-api.com/data/web/JHN/1",
        title: "John 1",
        content,
        contentHtml,
        bible: {
          reference: "John 1",
          translation: "web",
          copyright: "Public domain",
        },
        extractionStatus: "extracted",
        annotationStatus: "skipped",
        createdAt: Date.now(),
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("bible-api.com"))
          return Response.json({
            translation: { identifier: "web" },
            verses: [1, 2].map((verse) => ({
              book_id: "JHN",
              chapter: 1,
              verse,
              text: `Public WEB verse ${verse === 1 ? "one" : "two"}`,
            })),
          });
        if (url.endsWith("/JOH.csv"))
          return new Response(
            "chapter,verse,text\n1,1,λογος 3056 {N-NSM}\n1,2,λογος 3056 {N-NSM}\n",
          );
        return new Response('<li id="nt:3056"><i>λόγος</i> A word.</li>');
      }),
    );
    vi.spyOn(aiModels, "generateObjectWithFallback").mockImplementationOnce(
      async (options) => {
        await reader.mutation(api.account.deleteMine, {
          confirmation: "DELETE",
        });
        return { object: { findings: [] }, modelId: options.targets[0].id };
      },
    );
    const run = await reader.mutation(api.scriptureStudy.start, {
      articleId,
      selection,
      sourceHash: await sourceHash(content, contentHtml),
      requestKey: "delete-account",
    });
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: run.runId,
    });
    expect((await t.run((ctx) => ctx.db.get(run.runId)))?.status).not.toBe(
      "complete",
    );
    await expect(
      reader.query(api.scriptureStudy.get, { studyId: run.studyId }),
    ).rejects.toThrow();
    await runScheduled(t, { maxSteps: 200 });
    for (const table of [
      "scriptureStudies",
      "scriptureStudyRuns",
      "scriptureStudyFindings",
      "scriptureStudyBudgets",
      "scriptureStudyRequests",
    ] as const)
      expect(await t.run((ctx) => ctx.db.query(table).take(1))).toEqual([]);
  });
});
