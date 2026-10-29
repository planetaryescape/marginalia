/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { secondReaderTest } from "../test/owner";
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
async function setup() {
  const fixture = await studyFixture(modules);
  const run = await fixture.t.mutation(api.scriptureStudy.start, fixture.args);
  await fixture.t.action(internal.actions.scriptureStudy.generate, {
    runId: run.runId,
  });
  fixture.model.mockClear();
  fixture.fetch.mockClear();
  return { ...fixture, run };
}
const answer = {
  answer: "The passage must be read in its supplied context.",
  evidenceCoverage: "in_saved_sources" as const,
  evidenceIds: ["web-1"],
};

async function askFollowUp(
  fixture: Awaited<ReturnType<typeof setup>>,
  key = "expand",
  question = "How does this relate to Galatians 5:13-14?",
) {
  return fixture.t.mutation(api.scriptureStudyFollowUps.ask, {
    runId: fixture.run.runId,
    requestKey: key,
    question,
  });
}
function galatiansResponse() {
  return Response.json({
    translation: { identifier: "web" },
    verses: [
      {
        book_id: "GAL",
        chapter: 5,
        verse: 13,
        text: "Through love be servants to one another.",
      },
      {
        book_id: "GAL",
        chapter: 5,
        verse: 14,
        text: "You shall love your neighbor as yourself.",
      },
    ],
  });
}
it("fetches a missing canonical passage once, persists its provenance and resolves its citations after reload", async () => {
  const fixture = await setup();
  const { t, run, model, fetch } = fixture;
  const original = await t.run((ctx) => ctx.db.get(run.runId));
  const id = await askFollowUp(fixture);
  fetch.mockImplementation(async () => galatiansResponse());
  model.mockImplementation(async (options) => {
    if (model.mock.calls.length === 1)
      return {
        object: {
          requestedReferences: ["Galatians 5:13-14", "GAL.5.13-GAL.5.14"],
        },
        modelId: options.targets[0].id,
      };
    const context = JSON.parse(options.prompt ?? "{}");
    const evidenceId = context.savedEvidence.find(
      (item: { referenceKey: string }) =>
        item.referenceKey === "GAL.5.13-GAL.5.14",
    ).evidenceId;
    return {
      object: { ...answer, evidenceIds: ["web-1", evidenceId] },
      modelId: options.targets[0].id,
    };
  });
  await t.action(internal.actions.scriptureStudyFollowUps.generate, { id });
  expect(model).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe("https://bible-api.com/data/web/GAL/5");
  const saved = await t.run((ctx) => ctx.db.get(id));
  expect(saved).toMatchObject({
    status: "complete",
    sourceOutcomes: [
      { status: "retrieved", referenceKey: "GAL.5.13-GAL.5.14" },
    ],
  });
  expect(saved?.additionalEvidence).toHaveLength(1);
  const evidence = saved?.additionalEvidence?.[0];
  if (!evidence) throw new Error("Missing additional evidence");
  expect(evidence.evidenceId).toMatch(/^followup-web-[a-f0-9]{64}$/);
  expect(
    await t.query(api.scriptureStudy.evidence, {
      runId: run.runId,
      evidenceId: evidence.evidenceId,
    }),
  ).toEqual(evidence);
  expect(
    await t.query(api.scriptureStudyFollowUps.sources, { runId: run.runId }),
  ).toEqual([
    {
      evidenceId: evidence.evidenceId,
      source: evidence.source,
      locator: evidence.locator,
      referenceKey: evidence.referenceKey,
      limitations: evidence.limitations,
    },
  ]);
  expect((await t.run((ctx) => ctx.db.get(run.runId)))?.evidence).toEqual(
    original?.evidence,
  );
  await t.action(internal.actions.scriptureStudyFollowUps.generate, { id });
  expect(model).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(1);
  const second = await askFollowUp(
    fixture,
    "carry",
    "What follows from that comparison?",
  );
  model.mockClear();
  fetch.mockClear();
  model.mockImplementation(async (options) => {
    expect(JSON.parse(options.prompt ?? "{}").savedEvidence).toContainEqual(
      evidence,
    );
    return {
      object: { ...answer, evidenceIds: [evidence.evidenceId] },
      modelId: options.targets[0].id,
    };
  });
  await t.action(internal.actions.scriptureStudyFollowUps.generate, {
    id: second,
  });
  expect((await t.run((ctx) => ctx.db.get(second)))?.status).toBe("complete");
  expect(model).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
  expect((await t.run((ctx) => ctx.db.get(id)))?.additionalEvidence).toEqual([
    evidence,
  ]);
});
it("reuses already supplied verses without a fetch and closes expansion after one round", async () => {
  const fixture = await setup();
  const id = await askFollowUp(fixture);
  fixture.model.mockImplementation(async (options) => ({
    object:
      fixture.model.mock.calls.length === 1
        ? { requestedReferences: ["John 1:1-2"] }
        : answer,
    modelId: options.targets[0].id,
  }));
  await fixture.t.action(internal.actions.scriptureStudyFollowUps.generate, {
    id,
  });
  expect(fixture.fetch).not.toHaveBeenCalled();
  const saved = await fixture.t.run((ctx) => ctx.db.get(id));
  expect(saved).toMatchObject({
    status: "complete",
    additionalEvidence: [],
    sourceOutcomes: [{ status: "reused" }],
  });
  const final = fixture.model.mock.calls[1][0];
  expect(JSON.parse(final.prompt ?? "{}").expansion).toBe("closed");
  expect(
    final.schema.safeParse({ requestedReferences: ["Romans 8:1"] }).success,
  ).toBe(false);
});
it.each([
  "unavailable",
  "invalid",
  "limit",
] as const)("records %s evidence honestly and still permits a qualified final answer", async (kind) => {
  const fixture = await setup();
  const id = await askFollowUp(fixture);
  fixture.fetch.mockImplementation(async () =>
    kind === "limit"
      ? Response.json({
          translation: { identifier: "web" },
          verses: Array.from({ length: 41 }, (_, i) => ({
            book_id: "GAL",
            chapter: 5,
            verse: i + 1,
            text: "Synthetic WEB verse",
          })),
        })
      : new Response("", { status: 503 }),
  );
  fixture.model.mockImplementation(async (options) => ({
    object:
      fixture.model.mock.calls.length === 1
        ? {
            requestedReferences: [
              kind === "invalid"
                ? "https://example.com/source"
                : kind === "limit"
                  ? "Galatians 5"
                  : "Galatians 5:13-14",
            ],
          }
        : {
            answer:
              "The comparison lacks verified text; the supplied opening still connects its own verses.",
            evidenceCoverage: "partial",
            evidenceIds: ["web-1"],
          },
    modelId: options.targets[0].id,
  }));
  await fixture.t.action(internal.actions.scriptureStudyFollowUps.generate, {
    id,
  });
  expect(await fixture.t.run((ctx) => ctx.db.get(id))).toMatchObject({
    status: "complete",
    sourceOutcomes: [{ status: kind }],
    additionalEvidence: [],
    answer: { evidenceCoverage: "partial" },
  });
  expect(fixture.model).toHaveBeenCalledTimes(2);
  if (kind === "invalid") expect(fixture.fetch).not.toHaveBeenCalled();
});
it("rejects a second expansion and invented final citations without a third model call", async () => {
  const fixture = await setup();
  const id = await askFollowUp(fixture);
  fixture.fetch.mockImplementation(async () => galatiansResponse());
  fixture.model.mockImplementation(async (options) => ({
    object: { requestedReferences: ["Galatians 5:13-14"] },
    modelId: options.targets[0].id,
  }));
  await fixture.t.action(internal.actions.scriptureStudyFollowUps.generate, {
    id,
  });
  expect(fixture.model).toHaveBeenCalledTimes(2);
  expect((await fixture.t.run((ctx) => ctx.db.get(id)))?.status).toBe("failed");
  expect(
    await fixture.t.query(api.scriptureStudyFollowUps.sources, {
      runId: fixture.run.runId,
    }),
  ).toEqual([]);
});
it.each([
  "cancel",
  "policy",
  "refresh",
] as const)("fences %s changes during retrieval before dispatching the final answer", async (kind) => {
  const fixture = await setup();
  const id = await askFollowUp(fixture);
  fixture.model.mockImplementation(async (options) => ({
    object: { requestedReferences: ["Galatians 5:13-14"] },
    modelId: options.targets[0].id,
  }));
  fixture.fetch.mockImplementation(async () => {
    if (kind === "cancel")
      await fixture.t.mutation(api.scriptureStudyFollowUps.cancel, { id });
    if (kind === "policy")
      await fixture.t.run((ctx) =>
        ctx.db.patch(id, { followUpPolicyHash: "stale-policy" }),
      );
    if (kind === "refresh") {
      const next = await fixture.t.mutation(api.scriptureStudy.refresh, {
        studyId: fixture.run.studyId,
        requestKey: "refresh-race",
      });
      // Publication eligibility is lost as soon as replacement research starts.
      expect(next.runId).not.toBe(fixture.run.runId);
    }
    return galatiansResponse();
  });
  await fixture.t.action(internal.actions.scriptureStudyFollowUps.generate, {
    id,
  });
  expect(fixture.model).toHaveBeenCalledTimes(1);
  expect(
    (await fixture.t.run((ctx) => ctx.db.get(id)))?.answer,
  ).toBeUndefined();
});
it("keeps old completed answers readable while fencing pre-policy queued work", async () => {
  const fixture = await setup();
  const id = await askFollowUp(fixture);
  await fixture.t.run((ctx) =>
    ctx.db.patch(id, { followUpPolicyHash: undefined }),
  );
  await fixture.t.action(internal.actions.scriptureStudyFollowUps.generate, {
    id,
  });
  expect(fixture.model).not.toHaveBeenCalled();
  await fixture.t.run((ctx) =>
    ctx.db.patch(id, { status: "complete", answer }),
  );
  expect(
    await fixture.t.query(api.scriptureStudyFollowUps.list, {
      runId: fixture.run.runId,
    }),
  ).toMatchObject([{ status: "complete", answer }]);
  const next = await askFollowUp(fixture, "new-policy");
  expect(
    (await fixture.t.run((ctx) => ctx.db.get(next)))?.followUpPolicyHash,
  ).toMatch(/^[a-f0-9]{64}$/);
});
it("shares the original deadline and parse-attempt budget across both model calls", async () => {
  const fixture = await setup();
  const id = await askFollowUp(fixture);
  fixture.fetch.mockImplementation(async () => galatiansResponse());
  fixture.model.mockImplementation(async (options) => {
    if (fixture.model.mock.calls.length === 1) {
      vi.setSystemTime(Date.now() + 10_000);
      return {
        object: { requestedReferences: ["Galatians 5:13-14"] },
        modelId: options.targets[0].id,
      };
    }
    return { object: answer, modelId: options.targets[0].id };
  });
  await fixture.t.action(internal.actions.scriptureStudyFollowUps.generate, {
    id,
  });
  expect(fixture.model).toHaveBeenCalledTimes(2);
  expect(fixture.model.mock.calls[1][0].deadlineMs).toBeLessThanOrEqual(35_000);
  for (const [options] of fixture.model.mock.calls) {
    expect(options.maxParseAttempts).toBe(1);
    expect(options.targets).toHaveLength(1);
    expect(options.maxOutputTokens).toBe(1600);
  }
});
it("rejects supplemental citation inspection for another reader or a superseded run", async () => {
  const readers = await secondReaderTest(modules);
  const fixture = await studyFixture(modules, {
    ...readers.owner,
    withIdentity: readers.t.withIdentity,
  });
  const run = await fixture.t.mutation(api.scriptureStudy.start, fixture.args);
  await fixture.t.action(internal.actions.scriptureStudy.generate, {
    runId: run.runId,
  });
  const initialFetch = fixture.fetch.getMockImplementation();
  if (!initialFetch) throw new Error("Missing initial source fixture");
  const id = await fixture.t.mutation(api.scriptureStudyFollowUps.ask, {
    runId: run.runId,
    requestKey: "owned",
    question: "Compare Galatians 5:13-14",
  });
  fixture.model.mockClear();
  fixture.fetch.mockImplementation(async () => galatiansResponse());
  fixture.model.mockImplementation(async (options) => ({
    object:
      fixture.model.mock.calls.length === 1
        ? { requestedReferences: ["Galatians 5:13-14"] }
        : answer,
    modelId: options.targets[0].id,
  }));
  await fixture.t.action(internal.actions.scriptureStudyFollowUps.generate, {
    id,
  });
  const source = (
    await fixture.t.query(api.scriptureStudyFollowUps.sources, {
      runId: run.runId,
    })
  )[0];
  expect(source).toBeTruthy();
  await expect(
    readers.reader.query(api.scriptureStudyFollowUps.sources, {
      runId: run.runId,
    }),
  ).rejects.toThrow("not found");
  await expect(
    readers.reader.query(api.scriptureStudy.evidence, {
      runId: run.runId,
      evidenceId: source.evidenceId,
    }),
  ).rejects.toThrow("not found");
  const replacement = await fixture.t.mutation(api.scriptureStudy.refresh, {
    studyId: run.studyId,
    requestKey: "owned-refresh",
  });
  // Restore the fixture's initial-study result before publishing the replacement.
  fixture.fetch.mockImplementation(initialFetch);
  const { findings, teaching } = await import("../test/scriptureStudy");
  fixture.model.mockImplementation(async (options) => ({
    object: { findings, teaching },
    modelId: options.targets[0].id,
  }));
  await fixture.t.action(internal.actions.scriptureStudy.generate, {
    runId: replacement.runId,
  });
  await expect(
    fixture.t.query(api.scriptureStudyFollowUps.sources, { runId: run.runId }),
  ).rejects.toThrow("newer study");
  await expect(
    fixture.t.query(api.scriptureStudy.evidence, {
      runId: run.runId,
      evidenceId: source.evidenceId,
    }),
  ).rejects.toThrow("superseded");
});
it("shares one chapter fetch across distinct requested ranges", async () => {
  const fixture = await setup();
  const id = await askFollowUp(fixture);
  fixture.fetch.mockImplementation(async () => galatiansResponse());
  fixture.model.mockImplementation(async (options) => ({
    object:
      fixture.model.mock.calls.length === 1
        ? { requestedReferences: ["Galatians 5:13", "Galatians 5:14"] }
        : answer,
    modelId: options.targets[0].id,
  }));
  await fixture.t.action(internal.actions.scriptureStudyFollowUps.generate, {
    id,
  });
  expect(fixture.fetch).toHaveBeenCalledTimes(1);
  const row = await fixture.t.run((ctx) => ctx.db.get(id));
  expect(row?.status).toBe("complete");
  expect(row?.additionalEvidence).toHaveLength(2);
  expect(row?.sourceOutcomes).toHaveLength(2);
});
it("preserves multiline WEB verse text through retrieval, publication and source reload", async () => {
  const fixture = await setup();
  const id = await askFollowUp(
    fixture,
    "multiline",
    "How does this relate to Psalm 13:1?",
  );
  // Public WEB response from https://bible-api.com/data/web/PSA/13.
  const text =
    "How long, Yahweh?\nWill you forget me forever?\nHow long will you hide your face from me?";
  fixture.fetch.mockImplementation(async () =>
    Response.json({
      translation: { identifier: "web" },
      verses: [{ book_id: "PSA", chapter: 13, verse: 1, text }],
    }),
  );
  fixture.model.mockImplementation(async (options) => {
    if (fixture.model.mock.calls.length === 1)
      return {
        object: { requestedReferences: ["Psalm 13:1"] },
        modelId: options.targets[0].id,
      };
    const context = JSON.parse(options.prompt ?? "{}");
    const supplement = context.savedEvidence.find(
      (item: { referenceKey: string }) => item.referenceKey === "PSA.13.1",
    );
    return {
      object: { ...answer, evidenceIds: [supplement.evidenceId] },
      modelId: options.targets[0].id,
    };
  });
  await fixture.t.action(internal.actions.scriptureStudyFollowUps.generate, {
    id,
  });
  expect(fixture.model).toHaveBeenCalledTimes(2);
  expect(fixture.fetch).toHaveBeenCalledTimes(1);
  const saved = await fixture.t.run((ctx) => ctx.db.get(id));
  expect(saved?.status).toBe("complete");
  const evidence = saved?.additionalEvidence?.[0];
  if (!evidence) throw new Error("Missing multiline WEB evidence");
  expect(evidence.excerpt).toBe(`PSA.13.1 ${text}`);
  expect(
    await fixture.t.query(api.scriptureStudy.evidence, {
      runId: fixture.run.runId,
      evidenceId: evidence.evidenceId,
    }),
  ).toEqual(evidence);
});
