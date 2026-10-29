import { toJSONSchema, z } from "zod";
import { resultSchema, type StudyEvidence } from "./scriptureStudy";

/** Shared wire-schema snapshot for the local fixture runner's byte reservation. */
export function scriptureStudyEvaluationSchemaJson() {
  return JSON.stringify(toJSONSchema(resultSchema, { target: "draft-7" }));
}

const evidenceSchema = z
  .object({
    evidenceId: z.string(),
    source: z
      .object({
        id: z.string(),
        title: z.string(),
        revision: z.string(),
        rights: z.string(),
        licenseUrl: z.string(),
        attribution: z.string(),
        url: z.string(),
        capabilities: z.array(z.string()),
      })
      .strict(),
    locator: z.string(),
    referenceKey: z.string(),
    excerpt: z.string(),
    contentHash: z.string(),
    retrievedAt: z.number().finite(),
    limitations: z.array(z.string()),
  })
  .strict() satisfies z.ZodType<StudyEvidence>;

export const studyEvaluationCaseSchema = z
  .object({
    id: z.string().min(1),
    reference: z.string().min(1),
    split: z.enum(["calibration", "heldout"]),
    question: z.string().min(1),
    contraryClaims: z.array(z.string().min(1)),
    supportBoundaries: z.array(z.string().min(1)),
    criteria: z.array(z.string().min(1)),
  })
  .strict();

export const studyEvaluationCaseCatalogSchema = z
  .object({
    version: z.string().min(1),
    cases: z.array(studyEvaluationCaseSchema).min(1),
  })
  .strict();

const selectionSchema = z
  .object({
    referenceKey: z.string().min(1),
    startVerseId: z.string().min(1),
    endVerseId: z.string().min(1),
    versificationId: z.literal("web"),
  })
  .strict();

export const studyEvaluationSnapshotSchema = z
  .object({
    format: z.literal("marginalia-deep-study-fixture-v1"),
    case: studyEvaluationCaseSchema,
    createdAt: z.string().datetime(),
    sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
    promptVersion: z.string().min(1),
    baselineSystemPrompt: z.string().min(1),
    promptHash: z.string().regex(/^[a-f0-9]{64}$/),
    schemaHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourcePolicyVersion: z.string().min(1),
    input: z
      .object({
        selection: selectionSchema,
        selectedVerseIds: z.array(z.string().min(1)).min(1),
        immediateContextRanges: z.array(z.string()),
        evidence: z.array(evidenceSchema).min(1).max(16),
        chapterContext: z
          .object({
            coverage: z.enum(["full_retrieved_chapter", "bounded"]),
            referenceKey: z.string().min(1),
            ranges: z.array(z.string().min(1)),
          })
          .strict(),
        readerContext: z
          .object({
            role: z.literal("untrusted_personal_context_not_evidence"),
            notes: z.array(z.never()).max(0),
            limited: z.literal(false),
          })
          .strict(),
      })
      .strict(),
    verses: z
      .array(
        z
          .object({
            id: z.string().min(1),
            verse: z.number().int().positive(),
            text: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
    versions: z.object({ bun: z.string(), node: z.string() }).strict(),
  })
  .strict();

export type StudyEvaluationCase = z.infer<typeof studyEvaluationCaseSchema>;
export type StudyEvaluationCaseCatalog = z.infer<
  typeof studyEvaluationCaseCatalogSchema
>;
export type StudyEvaluationSnapshot = z.infer<
  typeof studyEvaluationSnapshotSchema
>;

export function validateStudyEvaluationSnapshot(value: unknown) {
  return studyEvaluationSnapshotSchema.parse(value);
}

export function validateStudyEvaluationCaseCatalog(value: unknown) {
  return studyEvaluationCaseCatalogSchema.parse(value);
}

const modelPrice = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
  .transform(Number)
  .refine((value) => Number.isFinite(value) && value >= 0);
const openRouterPricingCatalogSchema = z
  .object({
    data: z.array(z.object({ id: z.string() }).passthrough()),
  })
  .passthrough();
const modelPricingSchema = z
  .object({
    prompt: modelPrice,
    completion: modelPrice,
    web_search: modelPrice.optional(),
    input_cache_read: modelPrice.optional(),
    input_cache_write: modelPrice.optional(),
    overrides: z
      .array(
        z
          .object({
            prompt: modelPrice,
            completion: modelPrice,
            min_prompt_tokens: z.number().int().nonnegative().optional(),
            input_cache_read: modelPrice.optional(),
            input_cache_write: modelPrice.optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export function parseOpenRouterPricingPayload(value: unknown, modelId: string) {
  const catalog = openRouterPricingCatalogSchema.safeParse(value);
  if (!catalog.success)
    throw new Error("OpenRouter pricing response had an invalid structure");
  const record = catalog.data.data.find((item) => item.id === modelId);
  if (!record)
    throw new Error("The selected model was absent from OpenRouter pricing");
  const pricing = modelPricingSchema.safeParse(record.pricing);
  if (!pricing.success)
    throw new Error(
      "Selected OpenRouter model pricing had an invalid structure",
    );
  const { prompt, completion, overrides = [] } = pricing.data;
  return {
    prompt: Math.max(prompt, ...overrides.map((item) => item.prompt)),
    completion: Math.max(
      completion,
      ...overrides.map((item) => item.completion),
    ),
    listed: pricing.data,
  };
}

export const studyEvaluationResultRowSchema = z
  .object({
    fixtureId: z.string().min(1),
    arm: z.enum(["baseline", "candidate"]),
    state: z.string().min(1),
    object: resultSchema.optional(),
    error: z.unknown().optional(),
  })
  .passthrough();
export type StudyEvaluationResultRow = z.infer<
  typeof studyEvaluationResultRowSchema
>;
