/// <reference types="vite/client" />
import { NoObjectGeneratedError } from "ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { studyFixture } from "../test/scriptureStudy";
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
