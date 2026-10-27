import type { BibleReference } from "./bible";
import { commentaryEvidence } from "./scriptureStudyCommentary";
import type {
  ScriptureStudySourceLoad,
  ScriptureStudySourceOptions,
} from "./scriptureStudySourceShared";
import { SCRIPTURE_STUDY_SOURCE_POLICY_REVISION } from "./scriptureStudySourceShared";
import { parseByzTxtCsv, variantEvidence } from "./scriptureStudyVariants";

export {
  type ParsedByzTxtVariant,
  type ParsedByzTxtVerse,
  SCRIPTURE_STUDY_SOURCE_LIMITS,
  SCRIPTURE_STUDY_SOURCE_NOTICES,
  SCRIPTURE_STUDY_SOURCE_POLICY_REVISION,
  type ScriptureStudySourceLoad,
  type ScriptureStudySourceOptions,
  type ScriptureStudySourceRecord,
} from "./scriptureStudySourceShared";
export { parseByzTxtCsv };

export async function loadAdditionalStudyEvidence(
  reference: BibleReference,
  options: ScriptureStudySourceOptions = {},
): Promise<ScriptureStudySourceLoad> {
  const [commentary, variants] = await Promise.all([
    commentaryEvidence(reference, options),
    variantEvidence(reference, options),
  ]);
  return {
    records: [...commentary.records, ...variants.records],
    coverageWarnings: [
      ...commentary.coverageWarnings,
      ...variants.coverageWarnings,
    ],
    policyRevision: SCRIPTURE_STUDY_SOURCE_POLICY_REVISION,
  };
}
