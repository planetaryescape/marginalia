import { convexToJson } from "convex/values";
import { referenceFromKey } from "./scriptureReferences";
import type { StudyEvidence } from "./scriptureStudy";
import {
  evidenceVerses,
  type FollowUpSourceOutcome,
  followUpEvidenceIdentity,
  followUpReference,
  webEvidenceVerses,
} from "./scriptureStudyFollowUpEvidence";
import { FOLLOW_UP_LIMITS, studyAnswerSchema } from "./scriptureStudyFollowUps";
import { sha256Hex } from "./tokens";

export async function validateFollowUpAnswer({
  answer: raw,
  baseEvidence,
  carriedEvidence,
  additionalEvidence,
  sourceOutcomes,
}: {
  answer: unknown;
  baseEvidence: StudyEvidence[];
  carriedEvidence: StudyEvidence[];
  additionalEvidence: StudyEvidence[];
  sourceOutcomes: FollowUpSourceOutcome[];
}) {
  const answer = studyAnswerSchema.parse(raw);
  if (
    additionalEvidence.length > FOLLOW_UP_LIMITS.additionalEvidence ||
    additionalEvidence.reduce((n, item) => n + item.excerpt.length, 0) >
      FOLLOW_UP_LIMITS.additionalChars ||
    sourceOutcomes.length > FOLLOW_UP_LIMITS.requestedReferences
  )
    throw new Error("Follow-up evidence exceeds limits.");
  let verses = 0;
  for (const item of additionalEvidence) {
    const ref = referenceFromKey(item.referenceKey);
    const markedVerses = webEvidenceVerses(item.excerpt);
    const firstVerse = ref?.verse;
    if (
      !ref ||
      ref.chapter !== ref.endChapter ||
      firstVerse === undefined ||
      item.locator !== item.referenceKey ||
      item.source.id !== "web" ||
      item.source.title !== "World English Bible" ||
      item.source.revision !== "bible-api WEB response" ||
      item.source.rights !== "Public domain" ||
      item.source.licenseUrl !== "https://worldenglish.bible/" ||
      item.source.attribution !==
        "World English Bible (WEB). Public domain. Text from bible-api.com." ||
      item.source.url !==
        `https://bible-api.com/data/web/${ref.bookId}/${ref.chapter}` ||
      JSON.stringify(item.source.capabilities) !==
        JSON.stringify(["passage_text"]) ||
      item.contentHash !== (await sha256Hex(item.excerpt)) ||
      item.evidenceId !== (await followUpEvidenceIdentity(item)) ||
      markedVerses.length !== (ref.endVerse ?? firstVerse) - firstVerse + 1 ||
      markedVerses.some(
        (verse, index) =>
          !verse.text ||
          verse.id !== `${ref.bookId}.${ref.chapter}.${firstVerse + index}`,
      ) ||
      !Number.isFinite(item.retrievedAt) ||
      item.retrievedAt > Date.now()
    )
      throw new Error("Invalid additional answer source.");
    verses += (ref.endVerse ?? firstVerse) - firstVerse + 1;
  }
  if (verses > FOLLOW_UP_LIMITS.verses)
    throw new Error("Follow-up verse limit exceeded.");
  const evidence = [...baseEvidence, ...carriedEvidence, ...additionalEvidence];
  const byId = new Map<string, StudyEvidence>();
  for (const item of evidence) {
    const existing = byId.get(item.evidenceId);
    if (existing) {
      if (
        (await followUpEvidenceIdentity(existing)) !==
          (await followUpEvidenceIdentity(item)) ||
        existing.contentHash !== item.contentHash ||
        existing.locator !== item.locator ||
        JSON.stringify(existing.limitations) !==
          JSON.stringify(item.limitations)
      )
        throw new Error("Conflicting answer source identity.");
    } else byId.set(item.evidenceId, item);
  }
  const union = [...byId.values()];
  if (
    new TextEncoder().encode(JSON.stringify(union)).byteLength >
    FOLLOW_UP_LIMITS.evidenceBytes
  )
    throw new Error("Follow-up evidence exceeds limits.");
  for (const outcome of sourceOutcomes) {
    const ref = followUpReference(outcome.requestedReference);
    if (
      outcome.status === "invalid"
        ? ref !== null
        : !ref || outcome.referenceKey !== ref.passageId
    )
      throw new Error("Invalid requested answer reference.");
    if (
      outcome.evidenceIds.some((id) => !byId.has(id)) ||
      ((outcome.status === "retrieved" || outcome.status === "reused") &&
        !outcome.evidenceIds.length) ||
      (!["retrieved", "reused"].includes(outcome.status) &&
        outcome.evidenceIds.length)
    )
      throw new Error("Invalid answer source outcome.");
    if (
      ref &&
      (outcome.status === "retrieved" || outcome.status === "reused")
    ) {
      const supported = evidenceVerses(
        union.filter((item) => outcome.evidenceIds.includes(item.evidenceId)),
        ref,
      );
      if (
        !supported.length ||
        (ref.verse !== undefined &&
          supported.length !== (ref.endVerse ?? ref.verse) - ref.verse + 1)
      )
        throw new Error("Answer source does not cover its requested passage.");
    }
  }
  if (
    additionalEvidence.some(
      (item) =>
        !sourceOutcomes.some(
          (outcome) =>
            outcome.status === "retrieved" &&
            outcome.evidenceIds.includes(item.evidenceId),
        ),
    )
  )
    throw new Error("Additional answer evidence was not requested.");
  if (answer.evidenceIds.some((id) => !byId.has(id)))
    throw new Error("Unknown answer source.");
  if (
    answer.evidenceCoverage !== "outside_saved_sources" &&
    !answer.evidenceIds.some((id) =>
      byId.get(id)?.source.capabilities.includes("passage_text"),
    )
  )
    throw new Error("An explanation requires saved-source citations.");
  if (
    sourceOutcomes.some(
      (outcome) => !["retrieved", "reused"].includes(outcome.status),
    ) &&
    answer.evidenceCoverage === "in_saved_sources"
  )
    throw new Error("Unavailable evidence requires qualified coverage.");
  return {
    answer,
    evidenceSetHash: await sha256Hex(JSON.stringify(convexToJson(union))),
  };
}
