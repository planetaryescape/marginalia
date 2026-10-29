/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { studyFixture } from "../test/scriptureStudy";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const answer = {
  answer: "The passage's supplied context supports this explanation.",
  evidenceCoverage: "in_saved_sources" as const,
  evidenceIds: ["web-1"],
};
async function setup() {
  const fixture = await studyFixture(modules);
  const published = await fixture.t.mutation(
    api.scriptureStudy.start,
    fixture.args,
  );
  await fixture.t.action(internal.actions.scriptureStudy.generate, {
    runId: published.runId,
  });
  return { ...fixture, published };
}
it.each([
  "failed",
  "cancelled",
  "expired",
  "elapsed_lease",
  "missing",
  "complete",
] as const)("allows asking and answering on the published study after a %s refresh leaves an active reference", async (state) => {
  const { t, published, model } = await setup();
  const replacement = await t.mutation(api.scriptureStudy.refresh, {
    studyId: published.studyId,
    requestKey: "refresh",
  });
  if (state === "failed") {
    await t.mutation(internal.scriptureStudyRuns.claim, {
      runId: replacement.runId,
      claimToken: "replacement",
    });
    await t.mutation(internal.scriptureStudyRuns.fail, {
      runId: replacement.runId,
      claimToken: "replacement",
      errorCode: "synthetic_failure",
    });
  } else if (state === "cancelled") {
    await t.mutation(api.scriptureStudy.cancel, {
      studyId: published.studyId,
      runId: replacement.runId,
    });
  } else if (state === "expired" || state === "elapsed_lease") {
    await t.run((ctx) =>
      ctx.db.patch(replacement.runId, { leaseUntil: Date.now() - 1 }),
    );
    if (state === "expired")
      await t.mutation(internal.scriptureStudyRuns.expire, {
        runId: replacement.runId,
      });
  } else if (state === "missing") {
    await t.run((ctx) => ctx.db.delete(replacement.runId));
  } else {
    await t.run((ctx) =>
      ctx.db.patch(replacement.runId, { status: "complete" }),
    );
  }
  expect(
    (await t.run((ctx) => ctx.db.get(published.studyId)))?.activeRunId,
  ).toBe(replacement.runId);
  model.mockClear();
  model.mockImplementation(async (options) => ({
    object: answer,
    modelId: options.targets[0].id,
  }));
  const id = await t.mutation(api.scriptureStudyFollowUps.ask, {
    runId: published.runId,
    requestKey: "question",
    question: "Explain the passage's argument.",
  });
  await t.action(internal.actions.scriptureStudyFollowUps.generate, { id });
  expect(
    await t.query(api.scriptureStudyFollowUps.list, { runId: published.runId }),
  ).toMatchObject([{ id, status: "complete", answer }]);
  expect(model).toHaveBeenCalledTimes(1);
});
it.each([
  "queued",
  "running",
] as const)("rejects new questions during a live %s refresh", async (status) => {
  const { t, published } = await setup();
  const replacement = await t.mutation(api.scriptureStudy.refresh, {
    studyId: published.studyId,
    requestKey: "refresh",
  });
  if (status === "running")
    await t.mutation(internal.scriptureStudyRuns.claim, {
      runId: replacement.runId,
      claimToken: "replacement",
    });
  await expect(
    t.mutation(api.scriptureStudyFollowUps.ask, {
      runId: published.runId,
      requestKey: "question",
      question: "Explain?",
    }),
  ).rejects.toThrow("refreshed study");
});
it.each([
  "refresh",
  "publication",
] as const)("fences an answer admitted after a failed refresh when a fresh %s takes over", async (change) => {
  const { t, published, model } = await setup();
  const failed = await t.mutation(api.scriptureStudy.refresh, {
    studyId: published.studyId,
    requestKey: "failed-refresh",
  });
  await t.mutation(api.scriptureStudy.cancel, {
    studyId: published.studyId,
    runId: failed.runId,
  });
  const id = await t.mutation(api.scriptureStudyFollowUps.ask, {
    runId: published.runId,
    requestKey: "question",
    question: "Explain?",
  });
  const claimed = await t.mutation(internal.scriptureStudyFollowUps.claim, {
    id,
    token: "answer",
  });
  expect(claimed).toBeTruthy();
  const replacement = await t.mutation(api.scriptureStudy.refresh, {
    studyId: published.studyId,
    requestKey: "fresh-refresh",
  });
  if (change === "publication")
    await t.action(internal.actions.scriptureStudy.generate, {
      runId: replacement.runId,
    });
  expect(
    await t.query(internal.scriptureStudyFollowUps.check, {
      id,
      token: "answer",
    }),
  ).toBe(false);
  expect(
    await t.mutation(internal.scriptureStudyFollowUps.publish, {
      id,
      token: "answer",
      answer,
    }),
  ).toBe(false);
  expect((await t.run((ctx) => ctx.db.get(id)))?.answer).toBeUndefined();
  model.mockClear();
  await t.action(internal.actions.scriptureStudyFollowUps.generate, { id });
  expect(model).not.toHaveBeenCalled();
});
