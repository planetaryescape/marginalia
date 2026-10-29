import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { GenerationTelemetry } from "../../packages/backend/convex/lib/aiModels";
import { underlyingAIError } from "../../packages/backend/convex/lib/aiModels";
import { MODEL_CATALOG } from "../../packages/backend/convex/lib/providers";
import {
  resultSchema,
  STUDY_LIMITS,
  STUDY_SYSTEM_PROMPT,
  STUDY_VERSION,
  type StudyGeneration,
  type StudyResult,
  validateResult,
} from "../../packages/backend/convex/lib/scriptureStudy";
import { studyFailureDiagnostic } from "../../packages/backend/convex/lib/scriptureStudyDiagnostics";
import {
  parseOpenRouterPricingPayload,
  scriptureStudyEvaluationSchemaJson,
} from "../../packages/backend/convex/lib/scriptureStudyEvaluationSchema";
import { generateStudyWithRepair } from "../../packages/backend/convex/lib/scriptureStudyGeneration";
import { STUDY_TEACHING_PROMPT } from "../../packages/backend/convex/lib/scriptureStudyPrompt";
import { positiveNumber, type RunnerValues, required } from "./cliArgs";
import { catalog, definedCase, hash, loadSnapshot } from "./fixtures";

type StudyEvaluationOutcome =
  | {
      state: "complete";
      routeModel: string;
      responseModel: string | null;
      validation: "valid" | "invalid";
      generation: StudyGeneration;
      telemetry: GenerationTelemetry[];
      usageBasedEstimateUsd: number | null;
      usageBasedEstimateComplete: boolean;
      actualBilledUsd: null;
      object: StudyResult;
    }
  | {
      state: "dispatch_failed" | "deadline_exceeded";
      error: ReturnType<typeof safeError>;
      telemetry: GenerationTelemetry[];
    };

export function systemPrompt() {
  return `${STUDY_SYSTEM_PROMPT}\n${STUDY_TEACHING_PROMPT}`;
}
function safeError(error: unknown) {
  const diagnostic = studyFailureDiagnostic(underlyingAIError(error));
  return {
    errorType: diagnostic.errorType,
    statusCode: diagnostic.status,
    signals: diagnostic.signals,
    parameters: diagnostic.parameters,
  };
}
export async function openRouterPrice(model: string) {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      `OpenRouter pricing lookup failed with status ${response.status}; no generation was sent.`,
    );
  const payload: unknown = await response.json();
  try {
    return parseOpenRouterPricingPayload(payload, model);
  } catch {
    throw new Error(
      "OpenRouter pricing response could not be validated; no generation was sent.",
    );
  }
}
export async function run(values: RunnerValues) {
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
        const metadata = {
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
        let outcome: StudyEvaluationOutcome;
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
            system:
              arm === "baseline" ? snapshot.baselineSystemPrompt : undefined,
          });
          const object = resultSchema.parse(result.object);
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
          const hasUsageForEveryCall = telemetry.every(
            (event) =>
              event.tokens.input !== null && event.tokens.output !== null,
          );
          const usageBasedEstimateUsd = hasUsageForEveryCall
            ? telemetry.reduce(
                (total, event) =>
                  total +
                  event.tokens.input! * price.prompt +
                  event.tokens.output! * price.completion,
                0,
              )
            : null;
          outcome = {
            state: "complete",
            routeModel: result.modelId,
            responseModel: telemetry.at(-1)?.responseModel ?? null,
            validation,
            generation: result.generation,
            telemetry,
            usageBasedEstimateUsd,
            usageBasedEstimateComplete: hasUsageForEveryCall,
            actualBilledUsd: null,
            object,
          };
        } catch (error) {
          outcome = {
            state: controller.signal.aborted
              ? "deadline_exceeded"
              : "dispatch_failed",
            error: safeError(error),
            telemetry,
          };
        }
        const record = {
          ...metadata,
          ...outcome,
          finishedAt: new Date().toISOString(),
        };
        await writeFile(outputPath, `${JSON.stringify(record)}\n`, {
          flag: "a",
        });
        console.log(`${snapshot.case.id} ${arm}: ${outcome.state}`);
        if (controller.signal.aborted)
          throw new Error("Run deadline exceeded; stopping without retries");
      }
    }
  } finally {
    clearTimeout(timer);
  }
  console.log(`wrote ${outputPath}`);
}
