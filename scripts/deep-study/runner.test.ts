import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  parseOpenRouterPricingPayload,
  validateStudyEvaluationSnapshot,
} from "../../packages/backend/convex/lib/scriptureStudyEvaluationSchema";
import { StudyRepairExhaustedError } from "../../packages/backend/convex/lib/scriptureStudyGeneration";
import { loadSnapshot, validateSnapshotArtifact } from "./fixtures";
import {
  evaluationReservation,
  studyEvaluationFailureState,
} from "./generation";

const runner = resolve(import.meta.dirname, "runner.ts");
function invoke(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [runner, ...args], {
    encoding: "utf8",
    env: { ...process.env, OPENROUTER_API_KEY: "", ...env },
  });
}

describe("deep study runner safety", () => {
  it("distinguishes unverifiable model output from transport and deadline failures", () => {
    assert.equal(
      studyEvaluationFailureState(new StudyRepairExhaustedError()),
      "unverifiable_output",
    );
    assert.equal(
      studyEvaluationFailureState(new DOMException("Expired", "TimeoutError")),
      "deadline_exceeded",
    );
    assert.equal(
      studyEvaluationFailureState(new Error("Network unavailable")),
      "dispatch_failed",
    );
    assert.equal(
      studyEvaluationFailureState(new Error("Stopped"), true),
      "deadline_exceeded",
    );
  });
  it("does not enter generation without the explicit flag", () => {
    const result = invoke(["run", "--fixtures", "colossians-2-whole"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /explicit --generate flag/);
  });

  it("rejects unknown fixture ids before fetching sources", () => {
    const result = invoke(["prepare", "not-a-fixture"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown fixture: not-a-fixture/);
  });

  it("rejects an insufficient dispatch budget before pricing or generation", () => {
    const result = invoke(
      [
        "run",
        "--generate",
        "--fixtures",
        "colossians-2-whole",
        "--model",
        "openrouter:openai/gpt-6-luna",
        "--max-calls",
        "3",
        "--max-estimated-usd",
        "1",
        "--deadline-ms",
        "300000",
        "--per-call-deadline-ms",
        "90000",
        "--max-output-tokens",
        "6000",
        "--out",
        "/tmp/marginalia-deep-study-runner-test",
      ],
      { OPENROUTER_API_KEY: "test-only-not-a-real-key" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /reserves 4 calls/);
  });

  it("validates fixture shape and every frozen hash offline", async () => {
    const result = invoke(["inspect", "colossians-2-whole"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"inputHash":"[a-f0-9]{64}"/);

    const raw: unknown = JSON.parse(
      await readFile(
        resolve(import.meta.dirname, "snapshots/colossians-2-whole.json"),
        "utf8",
      ),
    );
    const snapshot = validateStudyEvaluationSnapshot(raw);
    assert.throws(
      () =>
        validateSnapshotArtifact("colossians-2-whole", {
          ...snapshot,
          promptHash: "0".repeat(64),
        }),
      /frozen prompt hash/,
    );
    assert.throws(
      () =>
        validateSnapshotArtifact("colossians-2-whole", {
          ...snapshot,
          schemaHash: "0".repeat(64),
        }),
      /different structured output schema/,
    );
    assert.throws(
      () =>
        validateSnapshotArtifact("colossians-2-whole", {
          ...snapshot,
          evidenceHash: "0".repeat(64),
        }),
      /integrity hash/,
    );
  });

  it("rejects malformed live pricing before any generation path", () => {
    assert.throws(
      () => parseOpenRouterPricingPayload({ data: "unexpected" }, "model"),
      /invalid structure/,
    );
    assert.throws(
      () =>
        parseOpenRouterPricingPayload(
          {
            data: [
              { id: "model", pricing: { prompt: "bad", completion: "0.1" } },
            ],
          },
          "model",
        ),
      /invalid structure/,
    );
    assert.deepEqual(
      parseOpenRouterPricingPayload(
        {
          data: [
            {
              id: "model",
              pricing: {
                prompt: "0.0000001",
                completion: "0.0000005",
                web_search: "0.01",
                input_cache_read: "0.00000001",
                input_cache_write: "0.000000125",
                overrides: [
                  {
                    min_prompt_tokens: 272000,
                    prompt: "0.0000002",
                    completion: "0.00000075",
                    input_cache_read: "0.00000002",
                    input_cache_write: "0.00000025",
                  },
                ],
              },
            },
          ],
        },
        "model",
      ),
      {
        prompt: 0.00000025,
        completion: 0.00000075,
        request: 0,
        listed: {
          prompt: 0.0000001,
          completion: 0.0000005,
          web_search: 0.01,
          input_cache_read: 0.00000001,
          input_cache_write: 0.000000125,
          overrides: [
            {
              min_prompt_tokens: 272000,
              prompt: 0.0000002,
              completion: 0.00000075,
              input_cache_read: 0.00000002,
              input_cache_write: 0.00000025,
            },
          ],
        },
      },
    );
  });

  it("accepts the observed Gemini pricing fields for a text-only evaluation", () => {
    const pricing = {
      prompt: "0.000000825",
      completion: "0.000004125",
      image: "0.000000825",
      audio: "0.000000825",
      input_audio_cache: "0.0000000825",
      web_search: "0.014",
      internal_reasoning: "0.000004125",
      input_cache_read: "0.0000000825",
      input_cache_write: "0.0000000416666666666667",
    };
    const result = parseOpenRouterPricingPayload(
      { data: [{ id: "google/gemini-3.8-flash", pricing }] },
      "google/gemini-3.8-flash",
    );
    assert.equal(result.prompt, 0.000000825);
    assert.equal(result.completion, 0.000004125);
    assert.equal(result.request, 0);
    assert.equal(result.listed.audio, Number(pricing.audio));
  });

  it("rejects malformed modality, reasoning, cache and request prices", () => {
    for (const field of [
      "image",
      "audio",
      "input_audio_cache",
      "internal_reasoning",
      "input_cache_write_1h",
      "request",
    ]) {
      assert.throws(
        () =>
          parseOpenRouterPricingPayload(
            {
              data: [
                {
                  id: "model",
                  pricing: {
                    prompt: "0.1",
                    completion: "0.2",
                    [field]: "not-a-price",
                  },
                },
              ],
            },
            "model",
          ),
        /invalid structure/,
      );
    }
  });

  it("reserves the highest cache and reasoning rates from partial overrides", () => {
    const result = parseOpenRouterPricingPayload(
      {
        data: [
          {
            id: "model",
            pricing: {
              prompt: "0.1",
              completion: "0.2",
              request: "0.25",
              overrides: [
                { input_cache_write_1h: "0.5" },
                { internal_reasoning: "3" },
              ],
            },
          },
        ],
      },
      "model",
    );
    assert.equal(result.prompt, 0.5);
    assert.equal(result.completion, 3);
    assert.equal(result.request, 0.25);
  });

  it("reserves flat request fees for all four allowed dispatches", async () => {
    const snapshots = [await loadSnapshot("colossians-2-whole")];
    const price = { prompt: 0.000001, completion: 0.000002, request: 0 };
    const withoutFees = evaluationReservation(snapshots, price, 6000);
    const withFees = evaluationReservation(
      snapshots,
      { ...price, request: 0.5 },
      6000,
    );
    assert.ok(Math.abs(withFees - withoutFees - 2) < 1e-10);
  });
});
