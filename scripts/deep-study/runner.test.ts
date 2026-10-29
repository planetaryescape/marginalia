import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  parseOpenRouterPricingPayload,
  validateStudyEvaluationSnapshot,
} from "../../packages/backend/convex/lib/scriptureStudyEvaluationSchema";
import { validateSnapshotArtifact } from "./fixtures";

const runner = resolve(import.meta.dirname, "runner.ts");
function invoke(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [runner, ...args], {
    encoding: "utf8",
    env: { ...process.env, OPENROUTER_API_KEY: "", ...env },
  });
}

describe("deep study runner safety", () => {
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
        prompt: 0.0000002,
        completion: 0.00000075,
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
});
