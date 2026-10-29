import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { hash, loadSnapshot } from "./fixtures";
import { pair } from "./scorecard";

describe("blinded study comparison integrity", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "deep-study-pair-test-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function records() {
    const snapshot = await loadSnapshot("colossians-2-whole");
    const common = {
      runId: "paired-test-run",
      evaluationSha: "a".repeat(40),
      fixtureId: snapshot.case.id,
      split: snapshot.case.split,
      fixtureHash: hash(snapshot),
      inputHash: snapshot.inputHash,
      evidenceHash: snapshot.evidenceHash,
      schemaHash: snapshot.schemaHash,
      requestedModel: "openrouter:google/gemini-3.8-flash",
      reasoningEffort: "provider-default/unknown",
      maxOutputTokens: 6000,
      state: "dispatch_failed",
      error: { errorType: "provider_error", statusCode: 401 },
    };
    return [
      { ...common, arm: "baseline" },
      { ...common, arm: "candidate" },
    ];
  }

  async function input(rows: unknown[]) {
    const path = join(directory, "run.jsonl");
    await writeFile(path, rows.map((row) => JSON.stringify(row)).join("\n"));
    return path;
  }

  it("rejects a missing arm instead of publishing an empty comparison", async () => {
    const rows = await records();
    await assert.rejects(
      pair(await input(rows.slice(0, 1)), join(directory, "blind")),
      /missing candidate/i,
    );
  });

  it("rejects duplicate arms instead of silently replacing a result", async () => {
    const rows = await records();
    await assert.rejects(
      pair(await input([...rows, rows[1]]), join(directory, "blind")),
      /duplicate candidate/i,
    );
  });

  for (const [field, value] of [
    ["runId", "another-run"],
    ["evaluationSha", "b".repeat(40)],
    ["requestedModel", "openrouter:openai/gpt-6-luna"],
    ["reasoningEffort", "high"],
    ["maxOutputTokens", 3000],
    ["inputHash", "b".repeat(64)],
    ["split", "heldout"],
  ] as const) {
    it(`rejects arms with different ${field}`, async () => {
      const rows = await records();
      const changed = { ...rows[1], [field]: value };
      await assert.rejects(
        pair(await input([rows[0], changed]), join(directory, "blind")),
        new RegExp(field),
      );
    });
  }

  it("checks both arms against the frozen evidence, not just each other", async () => {
    const rows = (await records()).map((row) => ({
      ...row,
      evidenceHash: "b".repeat(64),
    }));
    await assert.rejects(
      pair(await input(rows), join(directory, "blind")),
      /evidenceHash/,
    );
  });

  it("retains failed arms and their states in the review packet", async () => {
    const path = await input(await records());
    const output = join(directory, "blind");
    await pair(path, output);
    const report = await readFile(join(output, "blind-pairs.md"), "utf8");
    assert.match(report, /A dispatch_failed; B dispatch_failed/);
    assert.match(report, /No answer to score/);
    assert.doesNotMatch(report, /A=(?:baseline|candidate)/);
    assert.match(report, /Review task/);
    const key = JSON.parse(
      await readFile(join(output, "blind-key.json"), "utf8"),
    );
    assert.match(key["colossians-2-whole"], /^A=\w+; B=\w+$/);
    const score = await readFile(join(output, "score-template.md"), "utf8");
    assert.match(score, /Pairwise: unscored/);
    assert.doesNotMatch(score, /A wins/);
  });

  it("refuses to overwrite an existing blinded packet or its mapping", async () => {
    const path = await input(await records());
    const output = join(directory, "blind");
    await pair(path, output);
    const original = await readFile(join(output, "blind-key.json"), "utf8");
    await assert.rejects(pair(path, output), /already exists/i);
    assert.equal(
      await readFile(join(output, "blind-key.json"), "utf8"),
      original,
    );
  });

  it("rejects a complete record without an answer", async () => {
    const rows = (await records()).map((row) => ({
      ...row,
      state: "complete",
    }));
    await assert.rejects(
      pair(await input(rows), join(directory, "blind")),
      /complete.*answer/i,
    );
  });

  it("requires error evidence for a failed arm", async () => {
    for (const error of [undefined, null]) {
      const rows = await records();
      await assert.rejects(
        pair(
          await input([rows[0], { ...rows[1], error }]),
          join(directory, "blind"),
        ),
        /failed.*error evidence/i,
      );
    }
  });

  async function completedRecords() {
    return (await records()).map((row) => ({
      ...row,
      state: "complete",
      validation: "valid",
      routeModel: row.requestedModel,
      responseModel: "resolved-model-revision",
      object: { findings: [], teaching: null },
    }));
  }

  it("rejects different resolved models even when the requested model matches", async () => {
    const rows = await completedRecords();
    rows[1]!.responseModel = "different-model-revision";
    await assert.rejects(
      pair(await input(rows), join(directory, "blind")),
      /responseModel/,
    );
  });

  it("retains valid answers when one response lacks resolved-model telemetry", async () => {
    const rows = await completedRecords();
    const output = join(directory, "blind");
    await pair(
      await input([rows[0], { ...rows[1], responseModel: null }]),
      output,
    );
    const report = await readFile(join(output, "blind-pairs.md"), "utf8");
    assert.match(report, /A complete; B complete/);
    assert.match(report, /A valid; B valid/);
    assert.doesNotMatch(report, /resolved-model-revision/);
    const score = await readFile(join(output, "score-template.md"), "utf8");
    const comparison = report.match(/Comparison: ([a-f0-9]{64})/);
    assert.ok(
      comparison,
      "The answer packet must identify its records and mapping",
    );
    assert.equal(score.match(/Comparison: ([a-f0-9]{64})/)?.[1], comparison[1]);
  });

  it("retains unverifiable output as a model failure alongside a completed answer", async () => {
    const [baseline] = await completedRecords();
    const [, candidate] = await records();
    const output = join(directory, "blind");
    await pair(
      await input([baseline, { ...candidate, state: "unverifiable_output" }]),
      output,
    );
    const report = await readFile(join(output, "blind-pairs.md"), "utf8");
    assert.match(report, /model-output failure/);
    assert.match(report, /complete/);
  });

  it("rejects an empty run instead of writing a blank comparison", async () => {
    await assert.rejects(
      pair(await input([]), join(directory, "blind")),
      /no evaluation records/i,
    );
  });
});
