"use node";
import { APICallError, NoObjectGeneratedError } from "ai";
import { ZodError } from "zod";
import { generateObjectWithFallback, underlyingAIError } from "./aiModels";
import type { ProviderTarget } from "./router";
import {
  resultSchema,
  type ScriptureSelection,
  STUDY_LIMITS,
  STUDY_SYSTEM_PROMPT,
  type StudyEvidence,
  type StudyFinding,
  type StudyGeneration,
  type StudyResult,
  validateResult,
} from "./scriptureStudy";
import type {
  StudyReaderContext,
  studyChapterContext,
} from "./scriptureStudyContext";
import { studyProviderSchema } from "./scriptureStudyModelSchema";
import { STUDY_TEACHING_PROMPT } from "./scriptureStudyPrompt";

const FEEDBACK = {
  "Invalid finding identity or WEB quotation.": {
    code: "invalid_anchor",
    instruction:
      "Use a unique findingId, the full selection referenceKey, a selected verseId and an exact quotation from that WEB verse.",
  },
  "Finding must cite its verified WEB anchor.": {
    code: "missing_web_anchor",
    instruction:
      "The finding's own evidenceIds must cite supplied selected-WEB evidence containing its exact anchor quote.",
  },
  "Unknown evidence citation.": {
    code: "unknown_evidence",
    instruction:
      "Remove invented evidence IDs. Reader notes are context, not citable evidence.",
  },
  "Finding exceeds available source capabilities.": {
    code: "unsupported_lens",
    instruction:
      "Use only a lens supported by the cited evidence's capabilities, or remove the finding.",
  },
  "Attributed interpretations require a supplied study note.": {
    code: "unsupported_interpretation",
    instruction:
      "Attributed interpretations must cite a supplied scholarly study-note item, never a reader note.",
  },
  "Related passage has no verified WEB evidence.": {
    code: "unsupported_related_passage",
    instruction:
      "Related passages need supplied WEB evidence with the exact referenceKey. Remove unsupported related passages.",
  },
  "Study output is too large.": {
    code: "output_too_large",
    instruction:
      "Shorten the findings to fit the output limit without losing their verified evidence.",
  },
  "Teaching paragraphs must cite supplied WEB evidence.": {
    code: "unsupported_teaching",
    instruction:
      "Ground every teaching paragraph in supplied WEB evidence and cite it; omit unsupported claims.",
  },
  "A teaching requires verified findings.": {
    code: "unsupported_teaching",
    instruction: "Return teaching: null when there are no verified findings.",
  },
  "Application must derive from verified finding steps.": {
    code: "unsupported_application",
    instruction:
      "Use only published draft findingIds in application.derivedFromFindingIds; show the warranted bridge from those steps, or omit the unsupported teaching.",
  },
} as const;
type Feedback = { findingId?: string; code: string; instruction: string };

/** A citation may be completed only by exact, unique selected-source matching.
 * This does not certify that the prose's interpretation follows from the quote.
 */
export function reviewStudyDraft(
  draft: StudyResult,
  evidence: StudyEvidence[],
  verses: { id: string; text: string }[],
  selection: ScriptureSelection,
) {
  let correctedCitations = 0;
  const amended: StudyFinding[] = [];
  const accepted: StudyFinding[] = [];
  const feedback: Feedback[] = [];
  for (const original of draft.findings) {
    let finding = original;
    let corrected = false;
    const anchors = evidence.filter(
      (item) =>
        item.source.id === "web" &&
        item.referenceKey === selection.referenceKey &&
        item.excerpt.includes(original.anchor.quote),
    );
    if (
      anchors.length === 1 &&
      !original.evidenceIds.includes(anchors[0].evidenceId) &&
      original.evidenceIds.length < 8 &&
      verses.some(
        (verse) =>
          verse.id === original.anchor.verseId &&
          verse.text.includes(original.anchor.quote),
      ) &&
      original.anchor.referenceKey === selection.referenceKey
    ) {
      finding = {
        ...original,
        evidenceIds: [...original.evidenceIds, anchors[0].evidenceId],
      };
      corrected = true;
    }
    amended.push(finding);
    try {
      validateResult(
        { findings: [...accepted, finding] },
        evidence,
        verses,
        selection,
      );
      accepted.push(finding);
      if (corrected) correctedCitations++;
    } catch (error) {
      const detail =
        error instanceof Error
          ? Object.entries(FEEDBACK).find(
              ([message]) => message === error.message,
            )?.[1]
          : null;
      if (!detail) throw error;
      feedback.push({ findingId: finding.findingId, ...detail });
    }
  }
  // Do not retain an overarching explanation whose supporting steps were omitted.
  const complete: StudyResult = { ...draft, findings: amended };
  if (draft.teaching) {
    try {
      validateResult(
        { findings: accepted, teaching: draft.teaching },
        evidence,
        verses,
        selection,
      );
    } catch (error) {
      const detail =
        error instanceof Error
          ? Object.entries(FEEDBACK).find(
              ([message]) => message === error.message,
            )?.[1]
          : null;
      if (!detail) throw error;
      feedback.push(detail);
    }
  }
  const verified: StudyResult = { findings: accepted };
  return {
    draft: complete,
    accepted: verified,
    feedback,
    correctedCitations,
  };
}

interface StudyGenerationInput {
  selection: ScriptureSelection;
  selectedVerseIds: string[];
  immediateContextRanges: string[];
  evidence: StudyEvidence[];
  chapterContext: Pick<
    ReturnType<typeof studyChapterContext>,
    "coverage" | "referenceKey" | "ranges"
  >;
  readerContext: StudyReaderContext;
}
type StudyGenerationPrompt = StudyGenerationInput & {
  validationFeedback?: Feedback[];
  previousDraft?: StudyResult;
};

export class StudyRepairExhaustedError extends Error {
  constructor() {
    super(
      "Study findings could not be verified within the two-attempt budget.",
    );
  }
}

/** The application owns the whole two-dispatch budget, including schema repair.
 * Validation feedback and untrusted drafts stay in the user-data envelope.
 */
export async function generateStudyWithRepair(options: {
  target: ProviderTarget;
  input: StudyGenerationInput;
  verses: { id: string; text: string }[];
  signal: AbortSignal;
  leaseUntil: number;
  check: () => Promise<void>;
  onFailure: NonNullable<
    Parameters<typeof generateObjectWithFallback>[0]["onFailure"]
  >;
}): Promise<{
  object: StudyResult;
  modelId: string;
  generation: StudyGeneration;
}> {
  let reviewed: ReturnType<typeof reviewStudyDraft> | undefined;
  let verifiedFallback: ReturnType<typeof reviewStudyDraft> | undefined;
  let feedback: Feedback[] | undefined;
  for (let attempt = 1; attempt <= STUDY_LIMITS.modelAttempts; attempt++) {
    await options.check();
    options.signal.throwIfAborted();
    let draft: StudyResult;
    const prompt: StudyGenerationPrompt = { ...options.input };
    if (feedback) {
      prompt.validationFeedback = feedback;
      if (
        reviewed &&
        JSON.stringify(reviewed.draft).length <= STUDY_LIMITS.outputBytes
      )
        prompt.previousDraft = reviewed.draft;
    }
    try {
      const result = await generateObjectWithFallback({
        schema: resultSchema,
        providerSchema: studyProviderSchema(options.target.id),
        targets: [options.target],
        maxOutputTokens: STUDY_LIMITS.outputTokens,
        maxParseAttempts: 1,
        deadlineMs: Math.max(1, options.leaseUntil - Date.now()),
        signal: options.signal,
        onFailure: options.onFailure,
        system: `${STUDY_SYSTEM_PROMPT}\n${STUDY_TEACHING_PROMPT}`,
        prompt: JSON.stringify(prompt),
      });
      draft = resultSchema.parse(result.object);
    } catch (caught) {
      options.signal.throwIfAborted();
      const error = underlyingAIError(caught);
      // Only recognized answer-format failures get another dispatch. Auth,
      // quota and transport errors are not instructions to repair a draft.
      const malformed =
        error instanceof ZodError ||
        NoObjectGeneratedError.isInstance(error) ||
        (APICallError.isInstance(error) &&
          error.statusCode !== undefined &&
          error.statusCode >= 200 &&
          error.statusCode < 300);
      if (!malformed) throw error;
      feedback = [
        {
          code: "invalid_structure",
          instruction:
            "Return a complete object matching the supplied schema; use only verified evidence. A zero-findings result is valid.",
        },
      ];
      continue;
    }
    await options.check();
    reviewed = reviewStudyDraft(
      draft,
      options.input.evidence,
      options.verses,
      options.input.selection,
    );
    feedback = reviewed.feedback;
    if (draft.findings.length && !draft.teaching)
      feedback.push({
        code: "missing_teaching",
        instruction:
          "Add a connected teaching with centralReading, context and justified application (principle, nullable today illustration, boundary, derivedFromFindingIds). Cite WEB evidence on textual claims, not the modern illustration. Do not merely relabel or repeat the findings.",
      });
    if (
      reviewed.accepted.findings.length &&
      feedback.length &&
      reviewed.accepted.findings.length >=
        (verifiedFallback?.accepted.findings.length ?? 0)
    )
      verifiedFallback = reviewed;
    // A repair's empty result must not erase an already verified subset.
    if (!draft.findings.length && attempt > 1) break;
    if (!feedback.length)
      return {
        object: reviewed.draft,
        modelId: options.target.id,
        generation: {
          modelAttempts: attempt,
          repairAttempted: attempt > 1,
          correctedCitations: reviewed.correctedCitations,
          omittedFindings: 0,
        },
      };
  }
  await options.check();
  if (verifiedFallback?.accepted.findings.length)
    return {
      object: verifiedFallback.accepted,
      modelId: options.target.id,
      generation: {
        modelAttempts: STUDY_LIMITS.modelAttempts,
        repairAttempted: true,
        correctedCitations: verifiedFallback.correctedCitations,
        omittedFindings: verifiedFallback.feedback.filter(
          (item) => item.findingId,
        ).length,
        teachingOmitted: true,
      },
    };
  throw new StudyRepairExhaustedError();
}
