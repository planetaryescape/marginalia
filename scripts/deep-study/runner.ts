import { execFileSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { GenerationTelemetry } from "../../packages/backend/convex/lib/aiModels";
import { parseBibleReference } from "../../packages/backend/convex/lib/bible";
import { fetchBiblePassage } from "../../packages/backend/convex/lib/bibleProvider";
import { MODEL_CATALOG } from "../../packages/backend/convex/lib/providers";
import {
  resultSchema,
  SOURCE_POLICY,
  STUDY_LIMITS,
  STUDY_SYSTEM_PROMPT,
  STUDY_VERSION,
  type StudyEvidence,
  type StudyResult,
  validateResult,
} from "../../packages/backend/convex/lib/scriptureStudy";
import {
  chapterVerses,
  studyChapterContext,
} from "../../packages/backend/convex/lib/scriptureStudyContext";
import { scriptureStudyEvaluationSchemaJson } from "../../packages/backend/convex/lib/scriptureStudyEvaluationSchema";
import { generateStudyWithRepair } from "../../packages/backend/convex/lib/scriptureStudyGeneration";
import { STUDY_TEACHING_PROMPT } from "../../packages/backend/convex/lib/scriptureStudyPrompt";
import { loadAdditionalStudyEvidence } from "../../packages/backend/convex/lib/scriptureStudySources";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_PATH = resolve(HERE, "cases.json");
const SNAPSHOT_DIR = resolve(HERE, "snapshots");
const BASE_SYSTEM = `${STUDY_SYSTEM_PROMPT}\n${STUDY_TEACHING_PROMPT}`;
const BASE_PROMPT_VERSION = STUDY_VERSION;
const SOURCE_POLICY_VERSION = SOURCE_POLICY;

type CaseDefinition = {
  id: string;
  reference: string;
  split: "calibration" | "heldout";
  question: string;
  contraryClaims: string[];
  supportBoundaries: string[];
  criteria: string[];
};
type CaseCatalog = { version: string; cases: CaseDefinition[] };
type Snapshot = {
  format: "marginalia-deep-study-fixture-v1";
  case: CaseDefinition;
  createdAt: string;
  sourceSha: string;
  promptVersion: string;
  baselineSystemPrompt: string;
  promptHash: string;
  schemaHash: string;
  sourcePolicyVersion: string;
  input: {
    selection: {
      referenceKey: string;
      startVerseId: string;
      endVerseId: string;
      versificationId: string;
    };
    selectedVerseIds: string[];
    immediateContextRanges: string[];
    evidence: StudyEvidence[];
    chapterContext: {
      coverage: "full_retrieved_chapter" | "bounded";
      referenceKey: string;
      ranges: string[];
    };
    readerContext: {
      role: "untrusted_personal_context_not_evidence";
      notes: [];
      limited: false;
    };
  };
  verses: { id: string; text: string }[];
  inputHash: string;
  evidenceHash: string;
  versions: { bun: string; node: string };
};

function hash(value: unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}
const ARGUMENT_OPTIONS = {
  generate: { type: "boolean" },
  fixtures: { type: "string" },
  model: { type: "string" },
  "max-calls": { type: "string" },
  "max-estimated-usd": { type: "string" },
  "deadline-ms": { type: "string" },
  "per-call-deadline-ms": { type: "string" },
  "max-output-tokens": { type: "string" },
  out: { type: "string" },
  input: { type: "string" },
} as const;
function parseCommand(argv: string[]) {
  const [command, ...args] = argv;
  const parsed = parseArgs({
    args,
    options: ARGUMENT_OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  return {
    command,
    values: parsed.values as Record<string, string | boolean | undefined>,
    positionals: parsed.positionals,
  };
}
function required(
  values: Record<string, string | boolean | undefined>,
  name: string,
): string {
  const value = values[name];
  if (!value) throw new Error(`Required: ${name}`);
  if (typeof value !== "string")
    throw new Error(`Expected a value for --${name}`);
  return value.trim();
}
function positiveNumber(
  values: Record<string, string | boolean | undefined>,
  name: string,
): number {
  const value = Number(required(values, name));
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be greater than zero`);
  return value;
}
async function catalog(): Promise<CaseCatalog> {
  return JSON.parse(await readFile(CASES_PATH, "utf8")) as CaseCatalog;
}
function definedCase(cases: CaseCatalog, id: string): CaseDefinition {
  const found = cases.cases.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown fixture: ${id}`);
  return found;
}

async function prepare(id?: string) {
  const cases = await catalog();
  const selected = id ? [definedCase(cases, id)] : cases.cases;
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const schemaJson = scriptureStudyEvaluationSchemaJson();
  const schemaHash = hash(schemaJson);
  for (const item of selected) {
    const ref = parseBibleReference(item.reference);
    if (!ref) throw new Error(`Invalid fixture reference: ${item.reference}`);
    const full = await fetchBiblePassage(
      parseBibleReference(`${ref.book} ${ref.chapter}`)!,
      "web",
    );
    const allVerses = chapterVerses(full.content, `${ref.book} ${ref.chapter}`);
    const first = ref.verse ?? allVerses[0]?.verse;
    const last = ref.endVerse ?? allVerses.at(-1)?.verse;
    if (first === undefined || last === undefined)
      throw new Error(`No verses for ${item.reference}`);
    const verses = allVerses.filter(
      (verse) => verse.verse >= first && verse.verse <= last,
    );
    if (verses.length !== last - first + 1)
      throw new Error(`Incomplete WEB passage for ${item.reference}`);
    const selection = {
      referenceKey: `${ref.bookId}.${ref.chapter}.${first}${last === first ? "" : `-${ref.bookId}.${ref.chapter}.${last}`}`,
      startVerseId: `${ref.bookId}.${ref.chapter}.${first}`,
      endVerseId: `${ref.bookId}.${ref.chapter}.${last}`,
      versificationId: "web",
    };
    const chapterContext = studyChapterContext(
      allVerses,
      selection,
      STUDY_LIMITS.chapterContextChars,
    );
    const evidence: StudyEvidence[] = [];
    const web = {
      id: "web",
      title: "World English Bible",
      revision: "bible-api WEB response",
      rights: "Public domain",
      licenseUrl: "https://worldenglish.bible/",
      attribution: full.copyright,
      url: full.url,
      capabilities: ["passage_text"],
    };
    const selectedRef = `${ref.bookId}.${ref.chapter}.${first}${last === first ? "" : `-${ref.bookId}.${ref.chapter}.${last}`}`;
    evidence.push({
      evidenceId: "web-selected",
      source: web,
      locator: selectedRef,
      referenceKey: selectedRef,
      excerpt: verses.map((verse) => `${verse.id} ${verse.text}`).join("\n"),
      contentHash: hash(verses),
      retrievedAt: Date.now(),
      limitations: ["Frozen public WEB text snapshot; public-domain source."],
    });
    const before = allVerses.filter(
      (verse) => verse.verse >= first - 2 && verse.verse < first,
    );
    const after = allVerses.filter(
      (verse) => verse.verse > last && verse.verse <= last + 2,
    );
    const immediateContextRanges: string[] = [];
    for (const [label, group] of [
      ["before", before],
      ["after", after],
    ] as const) {
      if (!group.length) continue;
      const key = `${group[0]!.id}${group.length > 1 ? `-${group.at(-1)!.id}` : ""}`;
      immediateContextRanges.push(key);
      evidence.push({
        evidenceId: `web-context-${label}`,
        source: web,
        locator: key,
        referenceKey: key,
        excerpt: group.map((verse) => `${verse.id} ${verse.text}`).join("\n"),
        contentHash: hash(group),
        retrievedAt: Date.now(),
        limitations: ["Verified immediate WEB chapter context."],
      });
    }
    for (const [index, block] of chapterContext.evidenceBlocks.entries()) {
      evidence.push({
        evidenceId: `web-chapter-${index + 1}`,
        source: web,
        locator: block.referenceKey,
        referenceKey: block.referenceKey,
        excerpt: block.excerpt,
        contentHash: hash(block.excerpt),
        retrievedAt: Date.now(),
        limitations: ["Verified wider WEB chapter context."],
      });
    }
    const sourceRef =
      ref.verse === undefined
        ? parseBibleReference(`${ref.book} ${ref.chapter}:${first}-${last}`)!
        : ref;
    const extra = await loadAdditionalStudyEvidence(sourceRef);
    const note = extra.records.find(
      (record) => record.sourceId === "aquifer-open-study-notes",
    );
    const comparison = extra.records.find(
      (record) => record.sourceId === "byztxt-printed-edition-variants",
    );
    const prioritized = [
      ...new Set([
        ...(note ? [note] : []),
        ...(comparison ? [comparison] : []),
        ...extra.records,
      ]),
    ];
    const sourceRecords = prioritized.slice(
      0,
      Math.max(0, 10 - evidence.length),
    );
    for (const record of sourceRecords) {
      evidence.push({
        evidenceId: `source-${evidence.length + 1}`,
        source: {
          id: record.sourceId,
          title: record.title,
          revision: record.revision,
          rights: record.license,
          licenseUrl: record.licenseUrl,
          attribution: record.attribution,
          url: record.sourceUrl,
          capabilities: record.capabilities,
        },
        locator: record.locator,
        referenceKey: record.referenceKey,
        excerpt: record.excerpt,
        contentHash: record.contentHash,
        retrievedAt: Date.now(),
        limitations: record.limitations,
      });
    }
    const input = {
      selection,
      selectedVerseIds: verses.map((verse) => verse.id),
      immediateContextRanges,
      evidence,
      chapterContext: {
        coverage: chapterContext.coverage,
        referenceKey: chapterContext.referenceKey,
        ranges: chapterContext.ranges,
      },
      readerContext: {
        role: "untrusted_personal_context_not_evidence" as const,
        notes: [] as [],
        limited: false as const,
      },
    };
    const snapshot: Snapshot = {
      format: "marginalia-deep-study-fixture-v1",
      case: item,
      createdAt: new Date().toISOString(),
      sourceSha,
      promptVersion: BASE_PROMPT_VERSION,
      promptHash: hash(BASE_SYSTEM),
      schemaHash,
      baselineSystemPrompt: BASE_SYSTEM,
      sourcePolicyVersion: SOURCE_POLICY_VERSION,
      input,
      verses,
      inputHash: hash(input),
      evidenceHash: hash(evidence),
      versions: {
        bun: process.versions.bun ?? "unknown",
        node: process.version,
      },
    };
    const path = resolve(SNAPSHOT_DIR, `${item.id}.json`);
    await mkdir(SNAPSHOT_DIR, { recursive: true });
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, {
      flag: "wx",
    });
    console.log(`prepared ${item.id}: ${hash(snapshot)} (${path})`);
  }
}

function systemPrompt() {
  return `${STUDY_SYSTEM_PROMPT}\n${STUDY_TEACHING_PROMPT}`;
}
function safeError(error: unknown) {
  const value = error as { statusCode?: unknown; name?: unknown } | null;
  const status =
    typeof value?.statusCode === "number" ? value.statusCode : null;
  const knownNames = new Set([
    "APICallError",
    "NoObjectGeneratedError",
    "TimeoutError",
    "AbortError",
    "ZodError",
  ]);
  const errorType =
    typeof value?.name === "string" && knownNames.has(value.name)
      ? value.name
      : "provider_error";
  return { state: "dispatch_failed", statusCode: status, errorType };
}
async function openRouterPrice(model: string) {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      `OpenRouter pricing lookup failed with status ${response.status}; no generation was sent.`,
    );
  const payload = (await response.json()) as {
    data?: {
      id?: string;
      pricing?: {
        prompt?: string;
        completion?: string;
        overrides?: { prompt?: string; completion?: string }[];
      };
    }[];
  };
  const record = payload.data?.find((entry) => entry.id === model);
  const prompt = Number(record?.pricing?.prompt);
  const completion = Number(record?.pricing?.completion);
  const overrides = record?.pricing?.overrides ?? [];
  const promptRates = [prompt, ...overrides.map((item) => Number(item.prompt))];
  const completionRates = [
    completion,
    ...overrides.map((item) => Number(item.completion)),
  ];
  if (
    promptRates.some((value) => !Number.isFinite(value) || value < 0) ||
    completionRates.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error(
      "The model has no usable public input/output pricing; no generation was sent.",
    );
  return {
    prompt: Math.max(...promptRates),
    completion: Math.max(...completionRates),
    listed: { prompt, completion, overrides },
  };
}
async function loadSnapshot(id: string): Promise<Snapshot> {
  const snapshot = JSON.parse(
    await readFile(resolve(SNAPSHOT_DIR, `${id}.json`), "utf8"),
  ) as Snapshot;
  if (
    snapshot.format !== "marginalia-deep-study-fixture-v1" ||
    snapshot.inputHash !== hash(snapshot.input) ||
    snapshot.evidenceHash !== hash(snapshot.input.evidence)
  )
    throw new Error(`Fixture ${id} failed its immutable snapshot hash check`);
  return snapshot;
}
async function run(values: Record<string, string | boolean | undefined>) {
  if (values.generate !== true)
    throw new Error("Paid generation requires the explicit --generate flag");
  const ids = required(values, "fixtures")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!ids.length) throw new Error("--fixtures must name at least one fixture");
  const cases = await catalog();
  for (const id of ids) definedCase(cases, id);
  const modelId = required(values, "model");
  const catalogModel = MODEL_CATALOG.find((item) => item.id === modelId);
  if (!catalogModel || catalogModel.provider !== "openrouter")
    throw new Error(
      "--model must be an OpenRouter model already present in the app routing catalog",
    );
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey)
    throw new Error(
      "OPENROUTER_API_KEY must be set in the environment; it is never read from arguments or printed",
    );
  const maxCalls = positiveNumber(values, "max-calls");
  const maxCost = positiveNumber(values, "max-estimated-usd");
  const deadlineMs = positiveNumber(values, "deadline-ms");
  const perCallDeadlineMs = positiveNumber(values, "per-call-deadline-ms");
  const maxOutputTokens = positiveNumber(values, "max-output-tokens");
  if (
    ![maxCalls, deadlineMs, perCallDeadlineMs, maxOutputTokens].every(
      Number.isInteger,
    )
  )
    throw new Error(
      "Call, deadline, and output-token limits must be whole numbers",
    );
  if (maxOutputTokens !== STUDY_LIMITS.outputTokens)
    throw new Error(
      `--max-output-tokens must equal the production limit ${STUDY_LIMITS.outputTokens}`,
    );
  const reservedCalls = ids.length * 4;
  if (maxCalls < reservedCalls)
    throw new Error(
      `This paired run reserves ${reservedCalls} calls (up to two per arm per fixture); no generation was sent`,
    );
  const snapshots = await Promise.all(ids.map(loadSnapshot));
  const schemaJson = scriptureStudyEvaluationSchemaJson();
  const activeSchemaHash = hash(schemaJson);
  if (snapshots.some((snapshot) => snapshot.schemaHash !== activeSchemaHash))
    throw new Error(
      "The active result schema differs from the frozen fixture schema; this runner isolates prompt changes only",
    );
  const price = await openRouterPrice(catalogModel.model);
  const schemaBytes = Buffer.byteLength(schemaJson);
  const reservation = snapshots.reduce((sum, snapshot) => {
    const promptBytes =
      Buffer.byteLength(JSON.stringify(snapshot.input)) +
      Math.max(
        Buffer.byteLength(snapshot.baselineSystemPrompt),
        Buffer.byteLength(systemPrompt()),
      ) +
      schemaBytes;
    // UTF-8 bytes are a conservative token upper bound. The second attempt also receives the maximum draft and bounded feedback.
    const firstInputTokens = promptBytes + 16_000;
    const repairInputTokens =
      firstInputTokens + 4 * STUDY_LIMITS.outputBytes + 16_000;
    return (
      sum +
      2 *
        (firstInputTokens * price.prompt + maxOutputTokens * price.completion) +
      2 *
        (repairInputTokens * price.prompt + maxOutputTokens * price.completion)
    );
  }, 0);
  if (reservation > maxCost)
    throw new Error(
      `Estimated reservation $${reservation.toFixed(6)} exceeds --max-estimated-usd $${maxCost}; no generation was sent`,
    );
  const target = { ...catalogModel, apiKey };
  const startedAt = Date.now();
  const results: Record<string, unknown>[] = [];
  const outDir = resolve(required(values, "out"));
  await mkdir(outDir, { recursive: true });
  const runId = new Date().toISOString().replaceAll(":", "-");
  const outputPath = resolve(outDir, `run-${runId}.jsonl`);
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("Run deadline exceeded", "TimeoutError"),
      ),
    deadlineMs,
  );
  try {
    for (const [fixtureIndex, snapshot] of snapshots.entries()) {
      // Alternate arm order across fixtures to reduce systematic position bias.
      const arms: ("baseline" | "candidate")[] =
        fixtureIndex % 2 === 0
          ? ["baseline", "candidate"]
          : ["candidate", "baseline"];
      for (const arm of arms) {
        if (Date.now() - startedAt >= deadlineMs)
          throw new DOMException("Run deadline exceeded", "TimeoutError");
        const telemetry: GenerationTelemetry[] = [];
        const record: Record<string, unknown> = {
          runId,
          evaluationScope:
            "Isolated synthesis over frozen public evidence; no reader settings, private notes, or full action retrieval behavior",
          modelSelection:
            "Operator-selected supported catalog model; actual reader Deep setting is not queried",
          fixtureId: snapshot.case.id,
          split: snapshot.case.split,
          arm,
          evaluationSha: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          sourceSha: snapshot.sourceSha,
          fixtureHash: hash(snapshot),
          inputHash: snapshot.inputHash,
          evidenceHash: snapshot.evidenceHash,
          promptVersion:
            arm === "baseline" ? snapshot.promptVersion : STUDY_VERSION,
          promptHash:
            arm === "baseline" ? snapshot.promptHash : hash(systemPrompt()),
          schemaHash: snapshot.schemaHash,
          sourcePolicyVersion: snapshot.sourcePolicyVersion,
          provider: catalogModel.provider,
          requestedModel: modelId,
          reasoningEffort: "provider-default/unknown",
          maxCalls,
          reservedCalls,
          maxEstimatedUsd: maxCost,
          preflightEstimatedUsd: Number(reservation.toFixed(8)),
          inputTokenReservation:
            "UTF-8 byte bound plus 16k provider-envelope allowance; second dispatch also reserves a 4x max draft and 16k feedback",
          pricingUsdPerToken: { input: price.prompt, output: price.completion },
          pricingFromOpenRouter: price.listed,
          maxOutputTokens,
          deadlineMs,
          perCallDeadlineMs,
          startedAt: new Date().toISOString(),
        };
        try {
          const result = await generateStudyWithRepair({
            target,
            input: snapshot.input,
            verses: snapshot.verses,
            signal: controller.signal,
            leaseUntil:
              Date.now() +
              Math.max(
                1,
                Math.min(
                  perCallDeadlineMs,
                  deadlineMs - (Date.now() - startedAt),
                ),
              ),
            check: async () => {
              controller.signal.throwIfAborted();
            },
            onFailure: async () => {},
            onGeneration: (event) => telemetry.push(event),
            ...(arm === "baseline"
              ? { system: snapshot.baselineSystemPrompt }
              : {}),
          });
          const object = resultSchema.parse(result.object) as StudyResult;
          let validation: "valid" | "invalid" = "valid";
          try {
            validateResult(
              object,
              snapshot.input.evidence,
              snapshot.verses,
              snapshot.input.selection,
            );
          } catch {
            validation = "invalid";
          }
          record.state = "complete";
          record.routeModel = result.modelId;
          record.responseModel = telemetry.at(-1)?.responseModel ?? null;
          record.validation = validation;
          record.generation = result.generation;
          record.telemetry = telemetry;
          const hasUsageForEveryCall = telemetry.every(
            (event) =>
              event.tokens.input !== null && event.tokens.output !== null,
          );
          record.usageBasedEstimateUsd = hasUsageForEveryCall
            ? telemetry.reduce(
                (total, event) =>
                  total +
                  event.tokens.input! * price.prompt +
                  event.tokens.output! * price.completion,
                0,
              )
            : null;
          record.usageBasedEstimateComplete = hasUsageForEveryCall;
          record.actualBilledUsd = null;
          record.object = object;
        } catch (error) {
          record.state = controller.signal.aborted
            ? "deadline_exceeded"
            : "dispatch_failed";
          record.error = safeError(error);
          record.telemetry = telemetry;
        }
        record.finishedAt = new Date().toISOString();
        results.push(record);
        await writeFile(outputPath, `${JSON.stringify(record)}\n`, {
          flag: "a",
        });
        console.log(`${snapshot.case.id} ${arm}: ${String(record.state)}`);
        if (controller.signal.aborted)
          throw new Error("Run deadline exceeded; stopping without retries");
      }
    }
  } finally {
    clearTimeout(timer);
  }
  console.log(`wrote ${outputPath}`);
}

type ResultRow = {
  fixtureId: string;
  arm: "baseline" | "candidate";
  state: string;
  object?: StudyResult;
  [key: string]: unknown;
};
async function pair(path: string, out: string) {
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean);
  const rows = lines.map((line) => JSON.parse(line) as ResultRow);
  const grouped = new Map<
    string,
    Partial<Record<"baseline" | "candidate", ResultRow>>
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

async function inspect(ids: string[]) {
  const cases = await catalog();
  for (const id of ids.length ? ids : cases.cases.map((item) => item.id)) {
    const snapshot = await loadSnapshot(definedCase(cases, id).id);
    console.log(
      JSON.stringify({
        fixtureId: id,
        split: snapshot.case.split,
        reference: snapshot.case.reference,
        fixtureHash: hash(snapshot),
        inputHash: snapshot.inputHash,
        evidenceHash: snapshot.evidenceHash,
        promptVersion: snapshot.promptVersion,
        promptHash: snapshot.promptHash,
        schemaHash: snapshot.schemaHash,
        sourcePolicyVersion: snapshot.sourcePolicyVersion,
        sourceSha: snapshot.sourceSha,
        evidenceCount: snapshot.input.evidence.length,
        evidence: snapshot.input.evidence.map((item) => ({
          id: item.source.id,
          revision: item.source.revision,
          license: item.source.rights,
          licenseUrl: item.source.licenseUrl,
          locator: item.locator,
          contentHash: item.contentHash,
        })),
      }),
    );
  }
}

function help() {
  console.log(
    `Deep Study public fixture runner\n\nPrepare immutable snapshots (public source fetches only):\n  bun scripts/deep-study/runner.ts prepare [fixture-id]\n  bun scripts/deep-study/runner.ts inspect [fixture-id ...]\n\nExplicit paired generation (one dispatch per arm per fixture):\n  OPENROUTER_API_KEY=… bun scripts/deep-study/runner.ts run --generate --fixtures id,id --model openrouter:catalog/model --max-calls N --max-estimated-usd USD --deadline-ms N --per-call-deadline-ms N --max-output-tokens N --out DIR\n\nBlind offline comparison:\n  bun scripts/deep-study/runner.ts pair --input run.jsonl --out DIR`,
  );
}

async function main() {
  const { command, values, positionals } = parseCommand(process.argv.slice(2));
  if (command === "prepare") return prepare(positionals[0]);
  if (command === "inspect") return inspect(positionals);
  if (command === "run") return run(values);
  if (command === "pair")
    return pair(required(values, "input"), required(values, "out"));
  help();
}
main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown runner failure";
  console.error(message);
  process.exitCode = 1;
});
