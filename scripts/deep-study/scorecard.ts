import { randomInt } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  type StudyEvaluationResultRow,
  studyEvaluationResultRowSchema,
} from "../../packages/backend/convex/lib/scriptureStudyEvaluationSchema";
import { hash, loadSnapshot, type Snapshot } from "./fixtures";

const comparableFields = [
  "runId",
  "evaluationSha",
  "requestedModel",
  "reasoningEffort",
  "maxOutputTokens",
] as const;

async function comparablePairs(rows: StudyEvaluationResultRow[]) {
  if (!rows.length) throw new Error("No evaluation records to pair");
  const grouped = new Map<
    string,
    Partial<Record<"baseline" | "candidate", StudyEvaluationResultRow>>
  >();
  for (const row of rows) {
    for (const field of comparableFields) {
      if (row[field] !== rows[0]![field])
        throw new Error(`Cannot compare records with different ${field}`);
    }
    const group = grouped.get(row.fixtureId) ?? {};
    if (group[row.arm])
      throw new Error(`Duplicate ${row.arm} record for ${row.fixtureId}`);
    group[row.arm] = row;
    grouped.set(row.fixtureId, group);
  }
  const pairs: {
    fixtureId: string;
    baseline: StudyEvaluationResultRow;
    candidate: StudyEvaluationResultRow;
    snapshot: Snapshot;
  }[] = [];
  for (const [fixtureId, group] of grouped) {
    if (!group.baseline || !group.candidate)
      throw new Error(
        `${fixtureId} is missing ${group.baseline ? "candidate" : "baseline"}`,
      );
    const snapshot = await loadSnapshot(fixtureId);
    for (const row of [group.baseline, group.candidate]) {
      const frozen = {
        fixtureHash: hash(snapshot),
        inputHash: snapshot.inputHash,
        evidenceHash: snapshot.evidenceHash,
        schemaHash: snapshot.schemaHash,
        split: snapshot.case.split,
      };
      for (const field of Object.keys(frozen) as (keyof typeof frozen)[]) {
        if (row[field] !== frozen[field])
          throw new Error(
            `${fixtureId} ${field} differs from the frozen snapshot`,
          );
      }
    }
    if (
      group.baseline.state === "complete" &&
      group.candidate.state === "complete"
    ) {
      for (const field of ["routeModel", "responseModel"] as const) {
        if (
          group.baseline[field] &&
          group.candidate[field] &&
          group.baseline[field] !== group.candidate[field]
        )
          throw new Error(`${fixtureId} has different ${field} values`);
      }
    }
    pairs.push({
      fixtureId,
      baseline: group.baseline,
      candidate: group.candidate,
      snapshot,
    });
  }
  return pairs;
}

function answer(row: StudyEvaluationResultRow) {
  if (row.state === "complete") return JSON.stringify(row.object, null, 2);
  if (row.state === "unverifiable_output")
    return "No answer to score. Count as a model-output failure.";
  return "No answer to score. Record this transport or deadline failure separately from reasoning scores.";
}

function scoreAnswer(label: string, row: StudyEvaluationResultRow) {
  return row.state === "complete"
    ? `Answer ${label} — reasoning: __; support: __; material-claim annotations: __`
    : `Answer ${label} — ${row.state}; no reasoning or support score.`;
}

export async function pair(path: string, out: string) {
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean);
  const rows = lines.map((line) => {
    const raw: unknown = JSON.parse(line);
    return studyEvaluationResultRowSchema.parse(raw);
  });
  const pairs = await comparablePairs(rows);
  const assigned = pairs.map((pair) => {
    const swap = randomInt(2) === 1;
    return {
      ...pair,
      a: swap ? pair.candidate : pair.baseline,
      b: swap ? pair.baseline : pair.candidate,
    };
  });
  const blindKey = Object.fromEntries(
    assigned.map(({ fixtureId, a }) => [
      fixtureId,
      a.arm === "candidate"
        ? "A=candidate; B=baseline"
        : "A=baseline; B=candidate",
    ]),
  );
  const comparisonId = hash({ rows, blindKey });
  const report: string[] = [
    "# Blinded Deep study comparison",
    "",
    "Use the paired scoring template to judge reasoning and source support separately. Model and prompt labels are hidden here.",
    "",
    `Comparison: ${comparisonId}`,
    "",
  ];
  const score: string[] = [
    "# Blind scoring template",
    "",
    "For each answer, annotate material claims as supported, partial, or unsupported. Score the criteria from the fixture metadata (0 = absent/incorrect, 1 = partial, 2 = adequate). Ties and both-unacceptable are allowed. This is a human template, not an automatic quality score.",
    "",
    `Comparison: ${comparisonId}`,
    "",
  ];
  for (const { fixtureId, a, b, snapshot: snap } of assigned) {
    report.push(
      `## ${fixtureId}`,
      "",
      `Split: ${snap.case.split}`,
      "",
      `Review task: ${snap.case.question}`,
      "",
      "Generation received the selected passage and frozen evidence, without a separate question.",
      "",
      "### Supplied evidence",
      "",
      ...snap.input.evidence.flatMap((item) => [
        `**${item.source.title}** — ${item.source.attribution}; ${item.source.rights}; ${item.source.licenseUrl}; ${item.locator}`,
        "",
        item.excerpt,
        "",
      ]),
      `State: A ${a.state}; B ${b.state}`,
      "",
      `Structural validation: A ${a.validation ?? "unavailable"}; B ${b.validation ?? "unavailable"}`,
      "",
      "### Answer A",
      "",
      answer(a),
      "",
      "### Answer B",
      "",
      answer(b),
      "",
    );
    score.push(
      `## ${fixtureId}`,
      "",
      `Split: ${snap.case.split}`,
      "",
      `Review task: ${snap.case.question}`,
      "",
      `Contrary claims to test: ${snap.case.contraryClaims.join("; ")}`,
      "",
      `Support boundaries: ${snap.case.supportBoundaries.join("; ")}`,
      "",
      "Criteria (0 absent/incorrect, 1 partial, 2 adequate): " +
        snap.case.criteria.join("; "),
      "",
      scoreAnswer("A", a),
      scoreAnswer("B", b),
      a.state === "complete" &&
        b.state === "complete" &&
        a.validation === "valid" &&
        b.validation === "valid"
        ? "Pairwise: A wins / tie / B wins / both unacceptable: __"
        : "Pairwise: unscored; record the failed or structurally invalid arm separately from answer quality.",
      "Notes and disagreement: __",
      "",
    );
  }
  const output = resolve(out);
  await mkdir(dirname(output), { recursive: true });
  try {
    await mkdir(output);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new Error(
        `Comparison output directory already exists: ${output}; choose a new directory.`,
      );
    throw error;
  }
  await writeFile(resolve(output, "blind-pairs.md"), `${report.join("\n")}\n`);
  await writeFile(
    resolve(output, "score-template.md"),
    `${score.join("\n")}\n`,
  );
  await writeFile(
    resolve(output, "blind-key.json"),
    `${JSON.stringify(blindKey, null, 2)}\n`,
  );
  console.log(
    `wrote blinded answers and score template to ${output}; keep blind-key.json from reviewers`,
  );
}
