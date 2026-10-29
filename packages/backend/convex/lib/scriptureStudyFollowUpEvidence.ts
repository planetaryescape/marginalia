import type { Infer } from "convex/values";
import { type BibleReference, parseBibleReference } from "./bible";
import { fetchBiblePassage } from "./bibleProvider";
import type { BibleResourceCache } from "./bibleResourceCache";
import { interruptible } from "./requestControl";
import { referenceFromKey } from "./scriptureReferences";
import type { StudyEvidence } from "./scriptureStudy";
import { chapterVerses } from "./scriptureStudyContext";
import {
  FOLLOW_UP_LIMITS,
  type followUpSourceOutcomeValidator,
} from "./scriptureStudyFollowUps";
import { sha256Hex } from "./tokens";

export type FollowUpSourceOutcome = Infer<
  typeof followUpSourceOutcomeValidator
>;
export function followUpReference(input: string) {
  const ref = referenceFromKey(input) ?? parseBibleReference(input);
  return ref &&
    ref.chapter === ref.endChapter &&
    (ref.verse === undefined ||
      (ref.endVerse ?? ref.verse) - ref.verse + 1 <= FOLLOW_UP_LIMITS.verses)
    ? ref
    : null;
}
export function evidenceVerses(evidence: StudyEvidence[], ref: BibleReference) {
  const verses = new Map<
    number,
    { id: string; verse: number; text: string; evidenceId: string }
  >();
  for (const item of evidence) {
    if (
      item.source.id !== "web" ||
      !item.source.capabilities.includes("passage_text")
    )
      continue;
    for (const line of item.excerpt.split("\n")) {
      const match = /^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)\s+(.+)$/.exec(
        line.trim(),
      );
      if (!match || match[1] !== ref.bookId || Number(match[2]) !== ref.chapter)
        continue;
      const verse = Number(match[3]);
      if (
        ref.verse !== undefined &&
        (verse < ref.verse || verse > (ref.endVerse ?? ref.verse))
      )
        continue;
      verses.set(verse, {
        id: `${ref.bookId}.${ref.chapter}.${verse}`,
        verse,
        text: match[4],
        evidenceId: item.evidenceId,
      });
    }
  }
  return [...verses.values()].sort((a, b) => a.verse - b.verse);
}
export async function followUpEvidenceIdentity(
  item: Pick<StudyEvidence, "referenceKey" | "excerpt" | "source">,
) {
  const source = item.source;
  return `followup-web-${await sha256Hex(
    JSON.stringify([
      item.referenceKey,
      item.excerpt,
      [
        source.id,
        source.title,
        source.revision,
        source.rights,
        source.licenseUrl,
        source.attribution,
        source.url,
        source.capabilities,
      ],
    ]),
  )}`;
}
export async function expandFollowUpEvidence(options: {
  requests: string[];
  evidence: StudyEvidence[];
  completeChapterKeys: string[];
  cache: BibleResourceCache;
  signal: AbortSignal;
  check: () => Promise<void>;
}) {
  const additionalEvidence: StudyEvidence[] = [];
  const sourceOutcomes: FollowUpSourceOutcome[] = [];
  const seen = new Set<string>();
  let versesUsed = 0,
    requests = 0;
  const chapters = new Map<
    string,
    Awaited<ReturnType<typeof fetchBiblePassage>>
  >();
  for (const input of options.requests.slice(
    0,
    FOLLOW_UP_LIMITS.requestedReferences,
  )) {
    await options.check();
    const ref = followUpReference(input);
    if (!ref) {
      sourceOutcomes.push({
        requestedReference: input,
        status: "invalid",
        evidenceIds: [],
      });
      continue;
    }
    if (seen.has(ref.passageId)) continue;
    seen.add(ref.passageId);
    const chapterKey = `${ref.bookId}.${ref.chapter}`;
    const supplied = evidenceVerses(
      [...options.evidence, ...additionalEvidence],
      ref,
    );
    const needed =
      ref.verse === undefined
        ? undefined
        : (ref.endVerse ?? ref.verse) - ref.verse + 1;
    if (
      supplied.length &&
      (needed === supplied.length ||
        (needed === undefined &&
          options.completeChapterKeys.includes(chapterKey)))
    ) {
      sourceOutcomes.push({
        requestedReference: input,
        referenceKey: ref.passageId,
        status: "reused",
        evidenceIds: [...new Set(supplied.map((verse) => verse.evidenceId))],
      });
      continue;
    }
    if (needed !== undefined && versesUsed + needed > FOLLOW_UP_LIMITS.verses) {
      sourceOutcomes.push({
        requestedReference: input,
        referenceKey: ref.passageId,
        status: "limit",
        evidenceIds: [],
      });
      continue;
    }
    try {
      let passage = chapters.get(chapterKey);
      if (!passage) {
        const chapter = parseBibleReference(`${ref.book} ${ref.chapter}`);
        if (!chapter) throw new Error("Invalid chapter");
        passage = await interruptible(
          fetchBiblePassage(chapter, "web", options.cache, {
            signal: options.signal,
            beforeRequest: async () => {
              await options.check();
              if (++requests > FOLLOW_UP_LIMITS.requestedReferences)
                throw new Error("Retrieval budget exhausted");
            },
          }),
          options.signal,
        );
        chapters.set(chapterKey, passage);
      }
      await options.check();
      const verses = chapterVerses(passage.content, ref.reference).filter(
        (verse) =>
          ref.verse === undefined ||
          (verse.verse >= ref.verse &&
            verse.verse <= (ref.endVerse ?? ref.verse)),
      );
      if (
        !verses.length ||
        (needed === undefined && verses[0].verse !== 1) ||
        (needed !== undefined &&
          (verses.length !== needed ||
            verses[0].verse !== ref.verse ||
            verses.at(-1)?.verse !== ref.endVerse)) ||
        verses.some(
          (verse, index) =>
            index > 0 && verse.verse !== verses[index - 1].verse + 1,
        )
      )
        throw new Error("Requested passage unavailable");
      if (versesUsed + verses.length > FOLLOW_UP_LIMITS.verses) {
        sourceOutcomes.push({
          requestedReference: input,
          referenceKey: ref.passageId,
          status: "limit",
          evidenceIds: [],
        });
        continue;
      }
      const referenceKey = `${verses[0].id}${verses.length > 1 ? `-${verses.at(-1)?.id}` : ""}`;
      const excerpt = verses
        .map((verse) => `${verse.id} ${verse.text}`)
        .join("\n");
      if (
        additionalEvidence.reduce((n, item) => n + item.excerpt.length, 0) +
          excerpt.length >
        FOLLOW_UP_LIMITS.additionalChars
      ) {
        sourceOutcomes.push({
          requestedReference: input,
          referenceKey: ref.passageId,
          status: "limit",
          evidenceIds: [],
        });
        continue;
      }
      const item = {
        source: {
          id: "web",
          title: "World English Bible",
          revision: "bible-api WEB response",
          rights: "Public domain",
          licenseUrl: "https://worldenglish.bible/",
          attribution: passage.copyright,
          url: passage.url,
          capabilities: ["passage_text"],
        },
        locator: referenceKey,
        referenceKey,
        excerpt,
        contentHash: await sha256Hex(excerpt),
        retrievedAt: Date.now(),
        limitations: [
          "Verified WEB wording requested for this follow-up; a canonical connection remains an interpretation, not established by retrieval alone.",
        ],
      };
      const evidenceId = await followUpEvidenceIdentity(item);
      if (
        ![...options.evidence, ...additionalEvidence].some(
          (entry) => entry.evidenceId === evidenceId,
        )
      )
        additionalEvidence.push({ ...item, evidenceId });
      versesUsed += verses.length;
      sourceOutcomes.push({
        requestedReference: input,
        referenceKey: ref.passageId,
        status: "retrieved",
        evidenceIds: [evidenceId],
      });
    } catch {
      options.signal.throwIfAborted();
      await options.check();
      sourceOutcomes.push({
        requestedReference: input,
        referenceKey: ref.passageId,
        status: "unavailable",
        evidenceIds: [],
      });
    }
  }
  return { additionalEvidence, sourceOutcomes };
}
