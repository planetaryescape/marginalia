import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, it } from "node:test";

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

  it("validates checked-in fixture hashes offline", () => {
    const result = invoke(["inspect", "colossians-2-whole"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"inputHash":"[a-f0-9]{64}"/);
  });
});
