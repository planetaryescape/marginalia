import { randomInt } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type StudyEvaluationResultRow,
  studyEvaluationResultRowSchema,
} from "../../packages/backend/convex/lib/scriptureStudyEvaluationSchema";
import { loadSnapshot } from "./fixtures";

export async function pair(path: string, out: string) {
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean);
  const rows = lines.map((line) => {
    const raw: unknown = JSON.parse(line);
    return studyEvaluationResultRowSchema.parse(raw);
  });
  const grouped = new Map<
    string,
    Partial<Record<"baseline" | "candidate", StudyEvaluationResultRow>>
  >();
  for (const row of rows) {
    const group = grouped.get(row.fixtureId) ?? {};
    group[row.arm] = row;
    grouped.set(row.fixtureId, group);
  }
  const blindKey: Record<string, string> = {};
  const report: string[] = [
    "# Blinded Deep study comparison",
    "",
    "Use the paired scoring template to judge reasoning and source support separately. Model and prompt labels are hidden here.",
    "",
  ];
  const score: string[] = [
    "# Blind scoring template",
    "",
    "For each answer, annotate material claims as supported, partial, or unsupported. Score the criteria from the fixture metadata (0 = absent/incorrect, 1 = partial, 2 = adequate). Ties and both-unacceptable are allowed. This is a human template, not an automatic quality score.",
    "",
  ];
  const entries = [...grouped.entries()];
  for (const [fixtureId, group] of entries) {
    if (!group.baseline || !group.candidate) continue;
    const swap = randomInt(2) === 1;
    const a = swap ? group.candidate : group.baseline;
    const b = swap ? group.baseline : group.candidate;
    blindKey[fixtureId] = swap
      ? "A=candidate; B=baseline"
      : "A=baseline; B=candidate";
    const snap = await loadSnapshot(fixtureId);
    report.push(
      `## ${fixtureId}`,
      "",
      `Question: ${snap.case.question}`,
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
      "### Answer A",
      "",
      JSON.stringify(a.object ?? a.error ?? "No answer recorded", null, 2),
      "",
      "### Answer B",
      "",
      JSON.stringify(b.object ?? b.error ?? "No answer recorded", null, 2),
      "",
    );
    score.push(
      `## ${fixtureId}`,
      "",
      `Question: ${snap.case.question}`,
      "",
      `Contrary claims to test: ${snap.case.contraryClaims.join("; ")}`,
      "",
      `Support boundaries: ${snap.case.supportBoundaries.join("; ")}`,
      "",
      "Criteria (0 absent/incorrect, 1 partial, 2 adequate): " +
        snap.case.criteria.join("; "),
      "",
      "Answer A — reasoning: __; support: __; material-claim annotations: __",
      "Answer B — reasoning: __; support: __; material-claim annotations: __",
      "Pairwise: A wins / tie / B wins / both unacceptable: __",
      "Notes and disagreement: __",
      "",
    );
  }
  const output = resolve(out);
  await mkdir(output, { recursive: true });
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
