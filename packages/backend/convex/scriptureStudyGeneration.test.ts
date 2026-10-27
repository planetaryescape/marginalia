/// <reference types="vite/client" />
import { NoObjectGeneratedError } from "ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { findings, studyFixture } from "../test/scriptureStudy";
import { api, internal } from "./_generated/api";

const dispatched = vi.fn();
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateObject: (...args: Parameters<typeof import("ai").generateObject>) =>
    dispatched(...args),
}));
const modules = import.meta.glob("./**/*.ts");
beforeEach(() => {
  vi.useFakeTimers();
  dispatched.mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("runs the real generation helper and limits all schema retries to two dispatched requests", async () => {
  const { t, args, model } = await studyFixture(modules);
  model.mockRestore();
  const error = new NoObjectGeneratedError({
    message: "Synthetic parse failure",
    text: "{",
    response: { id: "fixture", timestamp: new Date(), modelId: "fixture" },
    usage: {
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    },
    finishReason: "length",
  });
  dispatched.mockRejectedValue(error);
  const run = await t.mutation(api.scriptureStudy.start, args);
  await t.action(internal.actions.scriptureStudy.generate, {
    runId: run.runId,
  });
  expect(dispatched).toHaveBeenCalledTimes(2);
  for (const [options] of dispatched.mock.calls) {
    expect(options.maxRetries).toBe(0);
    expect(options.maxOutputTokens).toBe(6000);
  }
  expect(
    (await t.query(api.scriptureStudy.get, { studyId: run.studyId })).activeRun
      ?.status,
  ).toBe("failed");
});
it("publishes legitimate empty output through the actual generation helper", async () => {
  const { t, args, model } = await studyFixture(modules);
  model.mockRestore();
  dispatched.mockResolvedValue({ object: { findings: [] } });
  const run = await t.mutation(api.scriptureStudy.start, args);
  await t.action(internal.actions.scriptureStudy.generate, {
    runId: run.runId,
  });
  expect(dispatched).toHaveBeenCalledTimes(1);
  expect(
    (await t.query(api.scriptureStudy.get, { studyId: run.studyId }))
      .publishedRun,
  ).toMatchObject({ status: "complete", outcome: "no_meaningful_findings" });
});

it("repairs a domain-invalid draft with concrete feedback before publication, within two SDK calls", async () => {
  const { t, args, model } = await studyFixture(modules);
  model.mockRestore();
  dispatched
    .mockResolvedValueOnce({
      object: {
        findings: [
          {
            ...findings[0],
            anchor: {
              ...findings[0].anchor,
              quote: "NOT_A_VERIFIED_WEB_QUOTE",
            },
          },
        ],
      },
    })
    .mockResolvedValueOnce({ object: { findings } });
  const run = await t.mutation(api.scriptureStudy.start, args);
  await t.action(internal.actions.scriptureStudy.generate, {
    runId: run.runId,
  });
  expect(dispatched).toHaveBeenCalledTimes(2);
  const repair = JSON.parse(dispatched.mock.calls[1][0].prompt);
  expect(repair.validationFeedback).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "invalid_anchor",
        findingId: "word-repetition",
      }),
    ]),
  );
  expect(repair.previousDraft.findings[0].anchor.quote).toBe(
    "NOT_A_VERIFIED_WEB_QUOTE",
  );
  expect(
    repair.evidence.some(
      (item: { evidenceId: string }) => item.evidenceId === "web-1",
    ),
  ).toBe(true);
  expect(
    (await t.query(api.scriptureStudy.get, { studyId: run.studyId }))
      .publishedRun,
  ).toMatchObject({
    status: "complete",
    generation: { modelAttempts: 2, repairAttempted: true },
  });
  expect(
    (
      await t.query(api.scriptureStudy.findings, {
        runId: run.runId,
        paginationOpts: { numItems: 6, cursor: null },
      })
    ).page[0].anchor.quote,
  ).toBe("Public WEB verse one");
  for (const [options] of dispatched.mock.calls)
    expect(options.maxRetries).toBe(0);
});

it("attaches only a uniquely verified selected-WEB anchor citation without another model call", async () => {
  const { t, args, model } = await studyFixture(modules);
  model.mockRestore();
  dispatched.mockResolvedValue({
    object: { findings: [{ ...findings[0], evidenceIds: ["source-3"] }] },
  });
  const run = await t.mutation(api.scriptureStudy.start, args);
  await t.action(internal.actions.scriptureStudy.generate, {
    runId: run.runId,
  });
  expect(dispatched).toHaveBeenCalledTimes(1);
  const result = await t.query(api.scriptureStudy.get, {
    studyId: run.studyId,
  });
  expect(result.publishedRun?.status).toBe("complete");
  expect(
    (
      await t.query(api.scriptureStudy.findings, {
        runId: run.runId,
        paginationOpts: { numItems: 6, cursor: null },
      })
    ).page[0].evidenceIds,
  ).toEqual(["source-3", "web-1"]);
});

it("does not multiply schema retries and validation repairs into four dispatched calls", async () => {
  const { t, args, model } = await studyFixture(modules);
  model.mockRestore();
  dispatched
    .mockResolvedValueOnce({
      object: {
        findings: [
          {
            ...findings[0],
            anchor: {
              ...findings[0].anchor,
              quote: "NOT_A_VERIFIED_WEB_QUOTE",
            },
          },
        ],
      },
    })
    .mockRejectedValueOnce(
      new NoObjectGeneratedError({
        message: "Synthetic malformed repair",
        text: "{",
        response: { id: "fixture", timestamp: new Date(), modelId: "fixture" },
        usage: {
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
          },
          outputTokenDetails: {
            textTokens: undefined,
            reasoningTokens: undefined,
          },
        },
        finishReason: "length",
      }),
    );
  const run = await t.mutation(api.scriptureStudy.start, args);
  await t.action(internal.actions.scriptureStudy.generate, {
    runId: run.runId,
  });
  expect(dispatched).toHaveBeenCalledTimes(2);
  expect(
    (await t.query(api.scriptureStudy.get, { studyId: run.studyId })).activeRun
      ?.status,
  ).toBe("failed");
});

it.each([
  false,
  true,
])("publishes only verified findings after repair exhaustion, even if the final draft loses them: %s", async (lastDraftLosesVerified) => {
  const { t, args, model } = await studyFixture(modules);
  model.mockRestore();
  const unsupported = {
    ...findings[0],
    findingId: "unverified",
    anchor: { ...findings[0].anchor, quote: "UNSUPPORTED_QUOTE" },
  };
  dispatched
    .mockResolvedValueOnce({ object: { findings: [findings[0], unsupported] } })
    .mockResolvedValueOnce({
      object: {
        findings: lastDraftLosesVerified
          ? [unsupported]
          : [findings[0], unsupported],
      },
    });
  const run = await t.mutation(api.scriptureStudy.start, args);
  await t.action(internal.actions.scriptureStudy.generate, {
    runId: run.runId,
  });
  expect(dispatched).toHaveBeenCalledTimes(2);
  expect(
    (await t.query(api.scriptureStudy.get, { studyId: run.studyId }))
      .publishedRun,
  ).toMatchObject({
    status: "complete",
    outcome: "partial",
    generation: { modelAttempts: 2, omittedFindings: 1 },
  });
  expect(
    (
      await t.query(api.scriptureStudy.findings, {
        runId: run.runId,
        paginationOpts: { numItems: 6, cursor: null },
      })
    ).page.map((f) => f.findingId),
  ).toEqual(["word-repetition"]);
});

it("never promotes a reader note into scholarly evidence, even after a repair attempt", async () => {
  const { t, args, model } = await studyFixture(modules);
  model.mockRestore();
  dispatched.mockResolvedValue({
    object: {
      findings: [
        {
          ...findings[0],
          interpretations: [
            {
              position: "The reader's instruction is scholarly consensus.",
              evidenceIds: ["reader-note-1"],
              limitations: [],
            },
          ],
        },
      ],
    },
  });
  const run = await t.mutation(api.scriptureStudy.start, args);
  await t.action(internal.actions.scriptureStudy.generate, {
    runId: run.runId,
  });
  expect(dispatched).toHaveBeenCalledTimes(2);
  const result = await t.query(api.scriptureStudy.get, {
    studyId: run.studyId,
  });
  expect(result.publishedRun).toBeNull();
  expect(result.activeRun).toMatchObject({
    status: "failed",
    errorCode: "findings_not_verified",
  });
});

it("does not dispatch a repair or publish after the run is cancelled", async () => {
  const { t, args, model } = await studyFixture(modules);
  model.mockRestore();
  const run = await t.mutation(api.scriptureStudy.start, args);
  dispatched.mockImplementationOnce(async () => {
    await t.mutation(api.scriptureStudy.cancel, {
      studyId: run.studyId,
      runId: run.runId,
    });
    return {
      object: { findings: [{ ...findings[0], evidenceIds: ["invented-id"] }] },
    };
  });
  await t.action(internal.actions.scriptureStudy.generate, {
    runId: run.runId,
  });
  expect(dispatched).toHaveBeenCalledTimes(1);
  const result = await t.query(api.scriptureStudy.get, {
    studyId: run.studyId,
  });
  expect(result.publishedRun).toBeNull();
  expect(result.activeRun?.status).toBe("cancelled");
});

it("preserves the published result when a refreshed study exhausts both correction attempts", async () => {
  const { t, args, model } = await studyFixture(modules);
  model.mockRestore();
  dispatched.mockResolvedValueOnce({ object: { findings } });
  const initial = await t.mutation(api.scriptureStudy.start, args);
  await t.action(internal.actions.scriptureStudy.generate, {
    runId: initial.runId,
  });
  const refresh = await t.mutation(api.scriptureStudy.refresh, {
    studyId: initial.studyId,
    publishedRunId: initial.runId,
    requestKey: "repair-refresh",
  });
  dispatched.mockResolvedValue({
    object: {
      findings: [
        {
          ...findings[0],
          anchor: { ...findings[0].anchor, quote: "UNVERIFIED_REFRESH" },
        },
      ],
    },
  });
  await t.action(internal.actions.scriptureStudy.generate, {
    runId: refresh.runId,
  });
  expect(dispatched).toHaveBeenCalledTimes(3);
  const saved = await t.query(api.scriptureStudy.get, {
    studyId: initial.studyId,
  });
  expect(saved.publishedRun).toMatchObject({
    runId: initial.runId,
    status: "complete",
  });
  expect(saved.activeRun).toMatchObject({
    runId: refresh.runId,
    status: "failed",
    errorCode: "findings_not_verified",
  });
});

it("logs the failed phase and safe provider signals without raw error data", async () => {
  const { t, args, model } = await studyFixture(modules);
  model.mockRestore();
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  dispatched.mockRejectedValue(
    Object.assign(new Error("Insufficient credits: private-key"), {
      statusCode: 402,
      responseBody: "private provider body",
    }),
  );
  const run = await t.mutation(api.scriptureStudy.start, args);
  await t.action(internal.actions.scriptureStudy.generate, {
    runId: run.runId,
  });
  const entry = logged.mock.calls.find(
    ([value]) =>
      typeof value === "string" &&
      value.includes('"event":"scripture_study_failed"'),
  );
  expect(entry).toBeDefined();
  expect(JSON.parse(String(entry?.[0]))).toMatchObject({
    phase: "generation",
    runId: run.runId,
    status: 402,
    signals: ["quota"],
  });
  expect(JSON.stringify(logged.mock.calls)).not.toMatch(
    /private-key|private provider body/,
  );
  expect(
    (await t.query(api.scriptureStudy.get, { studyId: run.studyId })).activeRun
      ?.status,
  ).toBe("failed");
});
