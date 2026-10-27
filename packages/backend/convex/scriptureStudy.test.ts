/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveTestCredential, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import { deleteArticle } from "./lib/feedRemoval";
import { sourceHash } from "./lib/preparedRepresentation";
import { STUDY_LIMITS } from "./lib/scriptureStudy";
import { purgeStudyReader } from "./scriptureStudyCleanup";

const modules = import.meta.glob("./**/*.ts");

import {
  content,
  contentHtml,
  findings,
  selection,
  studyFixture,
} from "../test/scriptureStudy";

const setup = () => studyFixture(modules);
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("selected Scripture Study public lifecycle", () => {
  it("admits, claims, retrieves permitted evidence, publishes and replays without spending again", async () => {
    const { t, args, fetch, model } = await setup();
    model.mockImplementationOnce(async (options) => ({
      object: {
        findings: [
          {
            ...findings[0],
            relatedPassages: [
              {
                evidenceId: "related-1",
                referenceKey: "ROM.8.1",
                relation: "thematic_parallel",
                explanation: "The supplied note links these passages.",
              },
            ],
          },
        ],
      },
      modelId: options.targets[0].id,
    }));
    const run = await t.mutation(api.scriptureStudy.start, args);
    expect(run.admission).toBe("started");
    expect(
      await t.mutation(api.scriptureStudy.start, {
        ...args,
        requestKey: "double-click",
      }),
    ).toMatchObject({ ...run, admission: "joined" });
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: run.runId,
    });
    const result = await t.query(api.scriptureStudy.get, {
      studyId: run.studyId,
    });
    expect(result.activeRun).toBeNull();
    expect(result.publishedRun).toMatchObject({
      status: "complete",
      outcome: "partial",
    });
    expect(
      result.publishedRun?.coverage.find((c) => c.lens === "textual_criticism")
        ?.status,
    ).toBe("no_meaningful_findings");
    expect(
      (
        await t.query(api.scriptureStudy.findings, {
          runId: run.runId,
          paginationOpts: { numItems: 20, cursor: null },
        })
      ).page,
    ).toMatchObject([
      {
        ...findings[0],
        relatedPassages: [
          {
            evidenceId: "related-1",
            referenceKey: "ROM.8.1",
            relation: "thematic_parallel",
            explanation: "The supplied note links these passages.",
          },
        ],
      },
    ]);
    const evidence = await t.query(api.scriptureStudy.evidence, {
      runId: run.runId,
      evidenceId: "web-1",
    });
    expect(evidence?.source.rights).toBe("Public domain");
    expect(evidence?.excerpt).toContain("Public WEB verse one");
    const adjacent = await t.query(api.scriptureStudy.evidence, {
      runId: run.runId,
      evidenceId: "web-context-after",
    });
    expect(adjacent).toMatchObject({
      referenceKey: "JHN.1.3-JHN.1.4",
      excerpt: expect.stringContaining("Public WEB verse three"),
    });
    const note = await t.query(api.scriptureStudy.evidence, {
      runId: run.runId,
      evidenceId: "source-3",
    });
    expect(note?.source).toMatchObject({
      id: "aquifer-open-study-notes",
      rights: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      attribution: expect.stringContaining("Tyndale Open Study Notes"),
    });
    expect(note?.limitations.join(" ")).toContain("converted from HTML");
    expect(
      result.publishedRun?.coverage.some((item) =>
        item.reason.includes("CC BY-SA 4.0"),
      ),
    ).toBe(true);
    const variant = await t.query(api.scriptureStudy.evidence, {
      runId: run.runId,
      evidenceId: "source-4",
    });
    expect(variant?.source.capabilities).toEqual([
      "printed-edition-comparison",
    ]);
    expect(variant?.excerpt).toContain("not a manuscript-witness collation");
    const related = await t.query(api.scriptureStudy.evidence, {
      runId: run.runId,
      evidenceId: "related-1",
    });
    expect(related).toMatchObject({
      source: { id: "web" },
      referenceKey: "ROM.8.1",
      excerpt: expect.stringContaining("No condemnation in Christ."),
    });
    expect(
      (
        await t.query(api.scriptureStudy.findings, {
          runId: run.runId,
          paginationOpts: { numItems: 6, cursor: null },
        })
      ).page[0].relatedPassages,
    ).toEqual([
      expect.objectContaining({
        evidenceId: "related-1",
        referenceKey: "ROM.8.1",
      }),
    ]);
    expect(model.mock.calls[0][0].prompt).toContain(
      '"immediateContextRanges":["JHN.1.3-JHN.1.4"]',
    );
    expect(model.mock.calls[0][0].system).not.toContain("No apparatus");
    expect(
      await t.mutation(api.scriptureStudy.start, {
        ...args,
        requestKey: "reopen",
      }),
    ).toMatchObject({ ...run, admission: "reused" });
    expect(model).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(
      STUDY_LIMITS.externalRequests,
    );
    expect(JSON.stringify(model.mock.calls)).not.toContain(
      "LICENSED_DOM_CANARY",
    );
    expect(model.mock.calls[0][0].prompt).not.toContain("synthetic-key");
    for (const canary of [
      "PRIVATE_NOTE_CANARY",
      "PRIVATE_MARK_CANARY",
      "LICENSED_NOTE_SELECTION_CANARY",
    ])
      expect(model.mock.calls[0][0].prompt).not.toContain(canary);
    expect(
      (
        await t.query(api.scriptureStudy.listByArticle, {
          articleId: args.articleId,
        })
      ).length,
    ).toBe(1);
  });
  it("permits the pinned John 1:18 edition comparison and rejects an unsourced textual claim", async () => {
    const { t, args, model } = await setup();
    const passage = "1:18 God gave his only Son for the world.";
    const selected = {
      referenceKey: "JHN.1.18",
      startVerseId: "JHN.1.18",
      endVerseId: "JHN.1.18",
      versificationId: "web",
    };
    await t.run((ctx) => ctx.db.patch(args.articleId, { content: passage }));
    const changedArgs = {
      ...args,
      selection: selected,
      sourceHash: await sourceHash(passage, contentHtml),
      requestKey: "john-1-18",
    };
    const textualFinding = {
      ...findings[0],
      lens: "textual_criticism" as const,
      anchor: {
        verseId: "JHN.1.18",
        referenceKey: "JHN.1.18",
        quote: "God gave his only Son",
      },
      observation: "The supplied printed editions differ at this phrase.",
      consequence: "The edition choice changes how the phrase is read.",
      evidenceIds: ["web-1", "source-2"],
    };
    model.mockImplementationOnce(async (options) => ({
      object: { findings: [textualFinding] },
      modelId: options.targets[0].id,
    }));
    const valid = await t.mutation(api.scriptureStudy.start, changedArgs);
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: valid.runId,
    });
    expect((await t.run((ctx) => ctx.db.get(valid.runId)))?.status).toBe(
      "complete",
    );

    model.mockImplementationOnce(async (options) => ({
      object: {
        findings: [{ ...textualFinding, evidenceIds: ["web-1"] }],
      },
      modelId: options.targets[0].id,
    }));
    const invalid = await t.mutation(api.scriptureStudy.refresh, {
      studyId: valid.studyId,
      publishedRunId: valid.runId,
      requestKey: "john-1-18-unsourced",
    });
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: invalid.runId,
    });
    expect((await t.run((ctx) => ctx.db.get(invalid.runId)))?.status).toBe(
      "failed",
    );
  });
  it("publishes valid WEB findings when optional evidence sources are unavailable", async () => {
    const { t, args, fetch, model } = await setup();
    fetch.mockImplementation(async (input) => {
      const url = new URL(input);
      if (url.hostname === "raw.githubusercontent.com")
        throw new Error("fixture source unavailable");
      return Response.json({
        translation: { identifier: "web" },
        verses: [1, 2, 3, 4, 18].map((verse) => ({
          book_id: "JHN",
          chapter: 1,
          verse,
          text:
            verse === 18
              ? "God gave his only Son for the world."
              : `Public WEB verse ${["one", "two", "three", "four"][verse - 1]}`,
        })),
      });
    });
    const run = await t.mutation(api.scriptureStudy.start, args);
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: run.runId,
    });
    const result = await t.query(api.scriptureStudy.get, {
      studyId: run.studyId,
    });
    expect(result.publishedRun?.status).toBe("complete");
    expect(
      result.publishedRun?.coverage.find(
        (item) => item.lens === "textual_criticism",
      ),
    ).toMatchObject({ status: "insufficient_evidence" });
    expect(
      result.publishedRun?.coverage.some((item) =>
        item.reason.includes("fixture source unavailable"),
      ),
    ).toBe(true);
    expect(model).toHaveBeenCalledTimes(1);
  });
  it("deduplicates joined request keys after a failed attempt without a paid retry", async () => {
    const { t, args, model } = await setup();
    const first = await t.mutation(api.scriptureStudy.start, args);
    const joined = await t.mutation(api.scriptureStudy.start, {
      ...args,
      requestKey: "joined-key",
    });
    model.mockRejectedValueOnce(new Error("provider failure"));
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: first.runId,
    });
    const replay = await t.mutation(api.scriptureStudy.start, {
      ...args,
      requestKey: "joined-key",
    });
    expect(replay.runId).toBe(joined.runId);
    expect(
      (await t.query(api.scriptureStudy.get, { studyId: first.studyId }))
        .activeRun?.status,
    ).toBe("failed");
    expect(model).toHaveBeenCalledTimes(1);
  });
  it("keeps published output across a failed refresh and replaces it only on success", async () => {
    const { t, args, model } = await setup();
    const first = await t.mutation(api.scriptureStudy.start, args);
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: first.runId,
    });
    const refresh = await t.mutation(api.scriptureStudy.refresh, {
      studyId: first.studyId,
      publishedRunId: first.runId,
      requestKey: "refresh-1",
    });
    model.mockRejectedValueOnce(new Error("synthetic failure"));
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: refresh.runId,
    });
    expect(
      (await t.query(api.scriptureStudy.get, { studyId: first.studyId }))
        .publishedRun?.runId,
    ).toBe(first.runId);
    expect(
      (await t.query(api.scriptureStudy.get, { studyId: first.studyId }))
        .activeRun,
    ).toMatchObject({
      status: "failed",
      errorCode: "retrieval_or_generation_failed",
    });
    expect(
      (
        await t.query(api.scriptureStudy.findings, {
          runId: first.runId,
          paginationOpts: { numItems: 6, cursor: null },
        })
      ).page,
    ).toEqual(findings);
    const retry = await t.mutation(api.scriptureStudy.refresh, {
      studyId: first.studyId,
      requestKey: "retry",
    });
    model.mockResolvedValueOnce({
      object: { findings: [] },
      modelId: model.mock.calls[0][0].targets[0].id,
    });
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: retry.runId,
    });
    expect(
      (await t.query(api.scriptureStudy.get, { studyId: first.studyId }))
        .publishedRun,
    ).toMatchObject({ runId: retry.runId, outcome: "no_meaningful_findings" });
    await expect(
      t.query(api.scriptureStudy.evidence, {
        runId: first.runId,
        evidenceId: "web-1",
      }),
    ).rejects.toThrow("superseded");
  });
  it.each([
    "cancel",
    "opt-out",
    "source",
    "model",
    "credential",
    "expire",
    "remove",
    "delete-article",
    "policy",
    "version",
    "manifest",
  ] as const)("fences %s while the model awaits", async (kind) => {
    const { t, args, model } = await setup();
    const run = await t.mutation(api.scriptureStudy.start, args);
    model.mockImplementationOnce(async (options) => {
      if (kind === "cancel")
        await t.mutation(api.scriptureStudy.cancel, {
          studyId: run.studyId,
          runId: run.runId,
        });
      if (kind === "opt-out") {
        await t.mutation(api.bible.setPreferences, { enabled: false });
        await t.mutation(api.bible.setPreferences, { enabled: true });
      }
      if (kind === "source")
        await t.run((ctx) =>
          ctx.db.patch(args.articleId, { content: "changed" }),
        );
      if (kind === "model")
        await t.run(async (ctx) => {
          const settings = await ctx.db.query("userSettings").first();
          if (settings)
            await ctx.db.patch(settings._id, {
              deepModel: "anthropic:changed",
            });
        });
      if (kind === "credential")
        await t.run(async (ctx) => {
          const key = await ctx.db.query("providerCredentials").first();
          if (key) await ctx.db.patch(key._id, { ciphertext: "rotated" });
        });
      if (kind === "manifest")
        await t.run(async (ctx) => {
          const row = await ctx.db.get(run.runId);
          if (row?.evidence)
            await ctx.db.patch(run.runId, {
              evidence: row.evidence.map((item, index) =>
                index === 0
                  ? {
                      ...item,
                      excerpt: `${item.excerpt}LICENSED_MANIFEST_CANARY`,
                    }
                  : item,
              ),
            });
        });
      if (kind === "policy")
        await t.run((ctx) =>
          ctx.db.patch(run.runId, { sourcePolicy: "changed" }),
        );
      if (kind === "version")
        await t.run((ctx) => ctx.db.patch(run.runId, { version: "changed" }));
      if (kind === "expire")
        await t.run((ctx) =>
          ctx.db.patch(run.runId, { leaseUntil: Date.now() - 1 }),
        );
      if (kind === "remove")
        await t.mutation(api.scriptureStudy.remove, { studyId: run.studyId });
      if (kind === "delete-article")
        await t.run(async (ctx) => {
          const article = await ctx.db.get(args.articleId);
          if (article) await deleteArticle(ctx, article);
        });
      return { object: { findings }, modelId: options.targets[0].id };
    });
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: run.runId,
    });
    expect(
      await t.run((ctx) => ctx.db.query("scriptureStudyFindings").take(10)),
    ).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(run.runId)))?.status).not.toBe(
      "complete",
    );
  });
  it("rejects tampered sources, invalid selection, reused request keys and concurrent scopes", async () => {
    const { t, args, model } = await setup();
    await expect(
      t.mutation(api.scriptureStudy.start, {
        ...args,
        sourceHash: "licensed-hash",
      }),
    ).rejects.toThrow("source changed");
    await expect(
      t.mutation(api.scriptureStudy.start, {
        ...args,
        selection: { ...selection, endVerseId: "JHN.2.1" },
      }),
    ).rejects.toThrow("one WEB chapter");
    const run = await t.mutation(api.scriptureStudy.start, args);
    const other = {
      referenceKey: "JHN.1.1",
      startVerseId: "JHN.1.1",
      endVerseId: "JHN.1.1",
      versificationId: "web",
    };
    await expect(
      t.mutation(api.scriptureStudy.start, { ...args, selection: other }),
    ).rejects.toThrow("different study scope");
    await expect(
      t.mutation(api.scriptureStudy.start, {
        ...args,
        selection: other,
        requestKey: "other",
      }),
    ).rejects.toThrow("already running");
    await t.run((ctx) =>
      ctx.db.patch(args.articleId, {
        content: "1:1 LICENSED_CANARY\n\n1:2 Public WEB verse two",
      }),
    );
    await t.mutation(api.scriptureStudy.cancel, {
      studyId: run.studyId,
      runId: run.runId,
    });
    const changed = await t.mutation(api.scriptureStudy.start, {
      ...args,
      sourceHash: await sourceHash(
        "1:1 LICENSED_CANARY\n\n1:2 Public WEB verse two",
        contentHtml,
      ),
      requestKey: "changed",
    });
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: changed.runId,
    });
    expect(model).not.toHaveBeenCalled();
    expect((await t.run((ctx) => ctx.db.get(changed.runId)))?.status).toBe(
      "failed",
    );
  });
  it("bounds hourly admissions even when studies are removed", async () => {
    const { t, args } = await setup();
    for (let i = 0; i < STUDY_LIMITS.newRunsPerHour; i++) {
      const run = await t.mutation(api.scriptureStudy.start, {
        ...args,
        requestKey: `run-${i}`,
      });
      await t.mutation(api.scriptureStudy.remove, { studyId: run.studyId });
    }
    await expect(
      t.mutation(api.scriptureStudy.start, { ...args, requestKey: "too-many" }),
    ).rejects.toThrow("limit reached");
  });
  it("does no model work after retrieval failure or cancellation before claim", async () => {
    const { t, args, fetch, model } = await setup();
    const first = await t.mutation(api.scriptureStudy.start, args);
    await t.mutation(api.scriptureStudy.cancel, {
      studyId: first.studyId,
      runId: first.runId,
    });
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: first.runId,
    });
    expect(fetch).not.toHaveBeenCalled();
    const second = await t.mutation(api.scriptureStudy.refresh, {
      studyId: first.studyId,
      requestKey: "retry",
    });
    fetch.mockRejectedValueOnce(new Error("provider unavailable"));
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: second.runId,
    });
    expect(model).not.toHaveBeenCalled();
    expect((await t.run((ctx) => ctx.db.get(second.runId)))?.status).toBe(
      "failed",
    );
  });
  it("fences duplicate claims and expired/superseded publication", async () => {
    const { t, args } = await setup();
    const run = await t.mutation(api.scriptureStudy.start, args);
    expect(
      await t.mutation(internal.scriptureStudyRuns.claim, {
        runId: run.runId,
        claimToken: "a",
      }),
    ).not.toBeNull();
    expect(
      await t.mutation(internal.scriptureStudyRuns.claim, {
        runId: run.runId,
        claimToken: "b",
      }),
    ).toBeNull();
    expect(
      await t.mutation(internal.scriptureStudyRuns.publish, {
        runId: run.runId,
        claimToken: "b",
        inputKey: "invented",
        resultJson: "{}",
        modelId: "invented",
      }),
    ).toBe(false);
    await t.run((ctx) => ctx.db.patch(run.studyId, { activeRunId: undefined }));
    expect(
      await t.query(internal.scriptureStudyRuns.check, {
        runId: run.runId,
        claimToken: "a",
      }),
    ).toBe(false);
  });
  it("blocks invented evidence, quotes, capabilities and references at publication", async () => {
    const { t, args, model } = await setup();
    for (const [index, change] of [
      { evidenceIds: ["invented"] },
      { anchor: { ...findings[0].anchor, quote: "fabricated quote" } },
      { lens: "reception" },
      {
        relatedPassages: [
          {
            evidenceId: "web-1",
            referenceKey: "ROM.8.1",
            relation: "quotation",
            explanation: "Invented",
          },
        ],
      },
    ].entries()) {
      const run = await t.mutation(api.scriptureStudy.start, {
        ...args,
        requestKey: `invalid-${index}`,
      });
      model.mockImplementationOnce(async (options) => ({
        object: { findings: [{ ...findings[0], ...change }] },
        modelId: options.targets[0].id,
      }));
      await t.action(internal.actions.scriptureStudy.generate, {
        runId: run.runId,
      });
      expect((await t.run((ctx) => ctx.db.get(run.runId)))?.status).toBe(
        "failed",
      );
    }
    expect(
      await t.run((ctx) => ctx.db.query("scriptureStudyFindings").take(10)),
    ).toEqual([]);
  });
  it("removes private study rows in bounded account cleanup", async () => {
    const { t, args } = await setup();
    const run = await t.mutation(api.scriptureStudy.start, args);
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: run.runId,
    });
    for (let i = 0; i < 10; i++)
      if (!(await t.run((ctx) => purgeStudyReader(ctx, "default_user")))) break;
    for (const table of [
      "scriptureStudies",
      "scriptureStudyRuns",
      "scriptureStudyFindings",
      "scriptureStudyBudgets",
    ] as const)
      expect(await t.run((ctx) => ctx.db.query(table).take(1))).toEqual([]);
  });
});

describe("Study ownership", () => {
  it("requires auth, opt-in, and the owned article/result on every public read", async () => {
    const { t, owner, reader, readerLibraryId } =
      await secondReaderTest(modules);
    await owner.mutation(api.bible.setPreferences, { enabled: true });
    await saveTestCredential(t, "default_user", "anthropic", "synthetic-key");
    const articleId = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: "default_user",
        guid: "bible-fixture",
        url: "https://bible-api.com/data/web/JHN/1",
        extractionStatus: "extracted",
        annotationStatus: "pending",
        title: "John 1",
        content,
        contentHtml,
        bible: {
          reference: "John 1",
          translation: "web",
          copyright: "Public domain",
        },
        createdAt: Date.now(),
      }),
    );
    const args = {
      articleId,
      selection,
      sourceHash: await sourceHash(content, contentHtml),
      requestKey: "owner",
    };
    const run = await owner.mutation(api.scriptureStudy.start, args);
    await expect(t.mutation(api.scriptureStudy.start, args)).rejects.toThrow();
    await expect(
      reader.mutation(api.scriptureStudy.start, args),
    ).rejects.toThrow();
    await expect(
      reader.query(api.scriptureStudy.get, { studyId: run.studyId }),
    ).rejects.toThrow();
    await expect(
      reader.query(api.scriptureStudy.evidence, {
        runId: run.runId,
        evidenceId: "web-1",
      }),
    ).rejects.toThrow();
    await expect(
      reader.mutation(api.scriptureStudy.cancel, {
        studyId: run.studyId,
        runId: run.runId,
      }),
    ).rejects.toThrow();
    await expect(
      reader.mutation(api.scriptureStudy.remove, { studyId: run.studyId }),
    ).rejects.toThrow();
    expect(readerLibraryId).not.toBe("default_user");
    await owner.mutation(api.bible.setPreferences, { enabled: false });
    await expect(
      owner.query(api.scriptureStudy.get, { studyId: run.studyId }),
    ).rejects.toThrow("Enable Bible");
  });
});
