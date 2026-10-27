import { BIBLE_BOOKS, type BibleReference } from "./bible";
import {
  getSourceText,
  type ParsedByzTxtVariant,
  type ParsedByzTxtVerse,
  rawByzTxt,
  referenceKey,
  SCRIPTURE_STUDY_SOURCE_LIMITS,
  SCRIPTURE_STUDY_SOURCE_NOTICES,
  SCRIPTURE_STUDY_SOURCE_POLICY_REVISION,
  type ScriptureStudySourceLoad,
  type ScriptureStudySourceOptions,
  type ScriptureStudySourceRecord,
  sourceHash,
} from "./scriptureStudySourceShared";

const variantCodes = new Map([
  ["NA", "Nestle-Aland"],
  ["Byz", "Byzantine"],
  ["NA27/28", "NA27/28"],
  ["ECM", "ECM"],
  ["NA27", "NA27"],
  ["NA28", "NA28"],
]);

export function parseByzTxtCsv(
  csv: string,
  reference: BibleReference,
): ParsedByzTxtVerse[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') {
        field += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(field);
      field = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && csv[index + 1] === "\n") index++;
      row.push(field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (quoted)
    throw new Error("ByzTxt CSV contains an unterminated quoted field.");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (rows[0]?.join(",") !== "chapter,verse,text")
    throw new Error("ByzTxt CSV header is not recognized.");

  const matchedRows = rows.slice(1).filter((cells) => {
    if (
      cells.length !== 3 ||
      !/^\d+$/.test(cells[0]) ||
      !/^\d+$/.test(cells[1])
    )
      throw new Error("ByzTxt CSV contains a malformed verse row.");
    const chapter = Number(cells[0]);
    const verse = Number(cells[1]);
    return (
      chapter === reference.chapter &&
      reference.verse !== undefined &&
      verse >= reference.verse &&
      verse <= (reference.endVerse ?? reference.verse)
    );
  });
  const parsedVariants = matchedRows.map(([chapter, verse, text]) => {
    const variants: ParsedByzTxtVariant[] = [];
    const blocks = Array.from(text.matchAll(/\{([^{}]*)\}/g));
    let hasUnparsedVariantSyntax =
      (text.match(/\{/g)?.length ?? 0) !== blocks.length ||
      (text.match(/\}/g)?.length ?? 0) !== blocks.length;
    for (const block of blocks) {
      const parts = /^([A-Za-z0-9/]+)\s+([^>]+?)\s*>\s*(.+)$/.exec(block[1]);
      const edition = parts ? variantCodes.get(parts[1]) : undefined;
      const baseReading = parts?.[2].trim() ?? "";
      const alternateReading = parts?.[3].trim() ?? "";
      if (!parts || !edition || !baseReading || !alternateReading) {
        hasUnparsedVariantSyntax = true;
        continue;
      }
      variants.push({ code: parts[1], edition, baseReading, alternateReading });
    }
    return {
      chapter: Number(chapter),
      verse: Number(verse),
      sourceText: text,
      variants: variants.slice(
        0,
        SCRIPTURE_STUDY_SOURCE_LIMITS.variantsPerVerse,
      ),
      variantsTruncated:
        variants.length > SCRIPTURE_STUDY_SOURCE_LIMITS.variantsPerVerse,
      hasUnparsedVariantSyntax,
    };
  });
  return parsedVariants;
}

export async function variantEvidence(
  reference: BibleReference,
  options: ScriptureStudySourceOptions,
): Promise<ScriptureStudySourceLoad> {
  if (
    reference.verse === undefined ||
    reference.endChapter !== reference.chapter ||
    !BIBLE_BOOKS.slice(39).some(([id]) => id === reference.bookId)
  )
    return {
      records: [],
      coverageWarnings: [
        "ByzTxt printed-edition comparisons cover New Testament verses only.",
      ],
      policyRevision: SCRIPTURE_STUDY_SOURCE_POLICY_REVISION,
    };
  const aliases = new Map([
    ["JHN", "JOH"],
    ["MRK", "MAR"],
    ["JAS", "JAM"],
    ["1JN", "1JO"],
    ["2JN", "2JO"],
    ["3JN", "3JO"],
  ]);
  const sourceBook = aliases.get(reference.bookId) ?? reference.bookId;
  const filename = `${sourceBook}.csv`;
  const url = `${rawByzTxt}${filename}`;
  try {
    const body = await getSourceText(
      url,
      SCRIPTURE_STUDY_SOURCE_LIMITS.variantsBytes,
      options,
    );
    const verses = parseByzTxtCsv(body, reference);
    const records: ScriptureStudySourceRecord[] = [];
    const coverageWarnings: string[] = [];
    for (const verse of verses) {
      if (verse.hasUnparsedVariantSyntax)
        coverageWarnings.push(
          `ByzTxt variant syntax at ${referenceKey(reference.bookId, verse.chapter, verse.verse)} was not fully recognized.`,
        );
      if (verse.variantsTruncated)
        coverageWarnings.push(
          `ByzTxt comparisons at ${referenceKey(reference.bookId, verse.chapter, verse.verse)} exceeded the per-verse limit.`,
        );
      for (const variant of verse.variants) {
        if (records.length >= SCRIPTURE_STUDY_SOURCE_LIMITS.variantsPerVerse) {
          coverageWarnings.push(
            "ByzTxt comparisons were truncated at the response limit.",
          );
          break;
        }
        const key = referenceKey(reference.bookId, verse.chapter, verse.verse);
        const locator = `${filename}:${verse.chapter}:${verse.verse}:${variant.code}`;
        const excerpt = `ByzTxt source verse ${key}: ${verse.sourceText} Printed-edition comparison (${variant.code}, ${variant.edition}): ${variant.baseReading} > ${variant.alternateReading}. This is a printed-edition comparison, not a manuscript-witness collation.`;
        records.push({
          sourceId: SCRIPTURE_STUDY_SOURCE_NOTICES.byzTxt.id,
          title: SCRIPTURE_STUDY_SOURCE_NOTICES.byzTxt.title,
          revision: SCRIPTURE_STUDY_SOURCE_NOTICES.byzTxt.revision,
          locator,
          referenceKey: key,
          excerpt,
          sourceUrl: `https://github.com/byztxt/byzantine-majority-text/blob/${SCRIPTURE_STUDY_SOURCE_NOTICES.byzTxt.revision}/csv-unicode/ccat/with-variants/${filename}`,
          contentHash: await sourceHash(`${key}\n${verse.sourceText}`),
          license: SCRIPTURE_STUDY_SOURCE_NOTICES.byzTxt.license,
          licenseUrl: SCRIPTURE_STUDY_SOURCE_NOTICES.byzTxt.licenseUrl,
          attribution: SCRIPTURE_STUDY_SOURCE_NOTICES.byzTxt.attribution,
          capabilities: ["printed-edition-comparison"],
          limitations: [
            "The marker identifies a printed-edition comparison, not named manuscript witnesses.",
            "The supplied base and alternate readings do not establish which reading is original.",
            "No parsed ByzTxt marker does not mean that no manuscript variants exist.",
          ],
          variant: {
            printedEdition: variant.edition,
            baseReading: variant.baseReading,
            alternateReading: variant.alternateReading,
          },
        });
      }
      if (records.length >= SCRIPTURE_STUDY_SOURCE_LIMITS.variantsPerVerse)
        break;
    }
    if (!records.length)
      coverageWarnings.push(
        "No recognized ByzTxt printed-edition comparison was found for this range; this does not establish absence of manuscript variants.",
      );
    return {
      records,
      coverageWarnings,
      policyRevision: SCRIPTURE_STUDY_SOURCE_POLICY_REVISION,
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const message =
      error instanceof Error ? error.message : "Source could not be read.";
    return {
      records: [],
      coverageWarnings: [`ByzTxt variant data unavailable: ${message}`],
      policyRevision: SCRIPTURE_STUDY_SOURCE_POLICY_REVISION,
    };
  }
}
