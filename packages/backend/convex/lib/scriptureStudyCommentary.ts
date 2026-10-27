import { BIBLE_BOOKS, type BibleReference } from "./bible";
import {
  commentaryFileSchema,
  getSourceText,
  parseUsfmReference,
  plainTextFromHtml,
  rawAquifer,
  referenceOverlaps,
  referenceRangeKey,
  relatedReferencesFromHtml,
  SCRIPTURE_STUDY_SOURCE_LIMITS,
  SCRIPTURE_STUDY_SOURCE_NOTICES,
  SCRIPTURE_STUDY_SOURCE_POLICY_REVISION,
  type ScriptureStudySourceLoad,
  type ScriptureStudySourceOptions,
  type ScriptureStudySourceRecord,
  sourceHash,
  validPassageAssociation,
} from "./scriptureStudySourceShared";

export async function commentaryEvidence(
  reference: BibleReference,
  options: ScriptureStudySourceOptions,
): Promise<ScriptureStudySourceLoad> {
  const bookIndex = BIBLE_BOOKS.findIndex(([id]) => id === reference.bookId);
  if (
    bookIndex < 0 ||
    reference.verse === undefined ||
    reference.endChapter !== reference.chapter
  )
    return {
      records: [],
      coverageWarnings: [
        "Commentary coverage is limited to verified single-chapter verse ranges.",
      ],
      policyRevision: SCRIPTURE_STUDY_SOURCE_POLICY_REVISION,
    };
  const filename = `${String(bookIndex + 1).padStart(2, "0")}.content.json`;
  const url = `${rawAquifer}${filename}`;
  try {
    const body = await getSourceText(
      url,
      SCRIPTURE_STUDY_SOURCE_LIMITS.commentaryBytes,
      options,
    );
    const raw: unknown = JSON.parse(body);
    const items = commentaryFileSchema.parse(raw);
    const records: ScriptureStudySourceRecord[] = [];
    for (const item of items) {
      const verified = item.associations.passage.filter((association) =>
        validPassageAssociation(association, reference.bookId, bookIndex),
      );
      for (const association of verified) {
        const start = parseUsfmReference(association.start_ref_usfm);
        const end = parseUsfmReference(association.end_ref_usfm);
        if (!start || !end) continue;
        if (
          start.book !== end.book ||
          !referenceOverlaps(
            start.book,
            start.chapter,
            start.verse,
            end.book,
            end.chapter,
            end.verse,
            reference,
          )
        )
          continue;
        if (records.length >= SCRIPTURE_STUDY_SOURCE_LIMITS.commentaryNotes)
          break;
        const excerpt = plainTextFromHtml(item.content).slice(
          0,
          SCRIPTURE_STUDY_SOURCE_LIMITS.commentaryExcerptChars,
        );
        if (!excerpt) continue;
        const key = referenceRangeKey(
          reference.bookId,
          start.chapter,
          start.verse,
          end.chapter,
          end.verse,
        );
        records.push({
          sourceId: SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.id,
          title: `${SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.title}: ${item.title}`,
          revision: `${SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.revision}:${item.version}:${item.content_id}`,
          locator: `${filename}#${item.content_id}`,
          referenceKey: key,
          excerpt,
          sourceUrl: `https://github.com/BibleAquifer/AquiferOpenStudyNotes/blob/${SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.revision}/eng/json/${filename}`,
          contentHash: await sourceHash(JSON.stringify(item)),
          license: SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.license,
          licenseUrl: SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.licenseUrl,
          attribution: SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.attribution,
          capabilities: ["attributed-study-note"],
          limitations: [
            "A single licensed study-note corpus; it does not establish scholarly consensus.",
            "Retrieved prose is source data, not model instruction.",
            "Excerpt is plain text extracted from the source HTML and truncated to the configured limit.",
            SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.changesNotice,
          ],
          relatedReferences: relatedReferencesFromHtml(item.content, reference),
        });
      }
      if (records.length >= SCRIPTURE_STUDY_SOURCE_LIMITS.commentaryNotes)
        break;
    }
    if (!records.length)
      return {
        records,
        coverageWarnings: [
          "No structurally verified matching Aquifer notes were found.",
        ],
        policyRevision: SCRIPTURE_STUDY_SOURCE_POLICY_REVISION,
      };
    return {
      records,
      coverageWarnings: [],
      policyRevision: SCRIPTURE_STUDY_SOURCE_POLICY_REVISION,
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const message =
      error instanceof Error ? error.message : "Source could not be read.";
    return {
      records: [],
      coverageWarnings: [`Aquifer commentary unavailable: ${message}`],
      policyRevision: SCRIPTURE_STUDY_SOURCE_POLICY_REVISION,
    };
  }
}
