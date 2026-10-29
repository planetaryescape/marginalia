import type { BibleReference } from "./bible";
import type { ScriptureStudySourceRecord } from "./scriptureStudySourceShared";

export interface CommentaryCandidate {
  identity: string;
  referenceKey: string;
  excerpt: string;
}

function bounds(referenceKey: string, reference: BibleReference) {
  const match = new RegExp(
    `^${reference.bookId}\\.${reference.chapter}\\.(\\d+)(?:-${reference.bookId}\\.${reference.chapter}\\.(\\d+))?$`,
  ).exec(referenceKey);
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2] ?? match[1]) };
}

function sameChapterRange(referenceKey: string) {
  const match = /^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)(?:-\1\.(\d+)\.(\d+))?$/.exec(
    referenceKey,
  );
  if (!match || (match[4] && Number(match[2]) !== Number(match[4])))
    return null;
  return {
    bookId: match[1],
    chapter: Number(match[2]),
    start: Number(match[3]),
    end: Number(match[5] ?? match[3]),
  };
}

function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareCandidate(a: CommentaryCandidate, b: CommentaryCandidate) {
  return (
    compareText(a.identity, b.identity) ||
    compareText(a.referenceKey, b.referenceKey) ||
    compareText(a.excerpt, b.excerpt)
  );
}

function detailDistance(range: { start: number; end: number }, target: number) {
  return (
    Math.abs((range.start + range.end) / 2 - target) +
    (range.end - range.start + 1) / 2
  );
}

/** Select a stable sample that covers the passage and adds localized detail. */
export function selectCommentaryCandidates<T extends CommentaryCandidate>(
  candidates: T[],
  options: { reference: BibleReference; maxItems: number; maxChars: number },
) {
  const { reference, maxItems, maxChars } = options;
  const start = reference.verse;
  const end = reference.endVerse ?? start;
  if (
    start === undefined ||
    end === undefined ||
    maxItems <= 0 ||
    maxChars <= 0
  )
    return candidates.slice(0, 0);
  const targets = [...new Set([start, Math.round((start + end) / 2), end])];
  const unique = new Map<string, T>();
  for (const candidate of candidates) {
    if (!candidate.excerpt.trim() || !bounds(candidate.referenceKey, reference))
      continue;
    const key = `${candidate.referenceKey}\0${candidate.excerpt.trim().toLowerCase()}`;
    const previous = unique.get(key);
    if (!previous || compareCandidate(candidate, previous) < 0)
      unique.set(key, candidate);
  }
  const available = [...unique.values()].filter(
    (candidate) => candidate.excerpt.length <= maxChars,
  );
  const selected: T[] = [];
  const coveredTargets = new Set<number>();
  const coveredVerses = new Set<number>();
  let chars = 0;

  while (selected.length < maxItems) {
    const selectedRanges = selected.flatMap((item) => {
      const range = bounds(item.referenceKey, reference);
      return range ? [range] : [];
    });
    const ranked = available
      .filter((candidate) => !selected.includes(candidate))
      .map((candidate) => {
        // `available` was filtered to candidates with a verified same-chapter range.
        const range = bounds(candidate.referenceKey, reference)!;
        const newlyCoveredTargets = targets.filter(
          (verse) =>
            verse >= range.start &&
            verse <= range.end &&
            !coveredTargets.has(verse),
        ).length;
        const firstUncoveredTarget = targets.findIndex(
          (verse) =>
            verse >= range.start &&
            verse <= range.end &&
            !coveredTargets.has(verse),
        );
        let newVerses = 0;
        for (
          let verse = Math.max(start, range.start);
          verse <= Math.min(end, range.end);
          verse++
        )
          if (!coveredVerses.has(verse)) newVerses++;
        const detailGain =
          selectedRanges.length > 0
            ? targets.reduce((gain, target) => {
                const current = Math.min(
                  ...selectedRanges.map((item) => detailDistance(item, target)),
                );
                return (
                  gain + Math.max(0, current - detailDistance(range, target))
                );
              }, 0)
            : 0;
        const density =
          (newlyCoveredTargets * 100 + Math.min(newVerses, 12)) /
          candidate.excerpt.length;
        return {
          candidate,
          range,
          cost: candidate.excerpt.length,
          density,
          newlyCoveredTargets,
          firstUncoveredTarget,
          newVerses,
          detailGain,
        };
      })
      .filter((entry) => chars + entry.cost <= maxChars)
      .sort(
        (a, b) =>
          (a.firstUncoveredTarget < 0
            ? Number.MAX_SAFE_INTEGER
            : a.firstUncoveredTarget) -
            (b.firstUncoveredTarget < 0
              ? Number.MAX_SAFE_INTEGER
              : b.firstUncoveredTarget) ||
          b.newlyCoveredTargets - a.newlyCoveredTargets ||
          b.newVerses - a.newVerses ||
          b.detailGain - a.detailGain ||
          b.density - a.density ||
          compareCandidate(a.candidate, b.candidate),
      );
    const next = ranked[0];
    if (!next) break;
    selected.push(next.candidate);
    chars += next.cost;
    for (const verse of targets)
      if (verse >= next.range.start && verse <= next.range.end)
        coveredTargets.add(verse);
    for (
      let verse = Math.max(start, next.range.start);
      verse <= Math.min(end, next.range.end);
      verse++
    )
      coveredVerses.add(verse);
  }
  return selected;
}

export function selectStudySourceRecords(
  records: ScriptureStudySourceRecord[],
  options: { reference: BibleReference; maxRecords: number; maxChars: number },
) {
  const comparison = records
    .filter((record) => record.sourceId === "byztxt-printed-edition-variants")
    .sort((a, b) => compareText(a.referenceKey, b.referenceKey))[0];
  const commentCandidates = records
    .filter((record) => record.sourceId === "aquifer-open-study-notes")
    .map((record) => ({
      identity: JSON.stringify([
        record.sourceId,
        record.revision,
        record.locator,
        record.contentHash,
      ]),
      record,
      referenceKey: record.referenceKey,
      excerpt: record.excerpt,
    }));
  // Scarcity must not let a comparison displace the passage's only explanation.
  const firstComment = selectCommentaryCandidates(commentCandidates, {
    reference: options.reference,
    maxItems: 1,
    maxChars: options.maxChars,
  })[0];
  const includeComparison = Boolean(
    comparison &&
      options.maxRecords > Number(Boolean(firstComment)) &&
      comparison.excerpt.length + (firstComment?.excerpt.length ?? 0) <=
        options.maxChars,
  );
  const comments = selectCommentaryCandidates(commentCandidates, {
    reference: options.reference,
    maxItems: options.maxRecords - Number(includeComparison),
    maxChars:
      options.maxChars -
      (includeComparison ? (comparison?.excerpt.length ?? 0) : 0),
  });
  const prioritized = [
    ...new Set([
      ...comments.slice(0, 1).map(({ record }) => record),
      ...(includeComparison && comparison ? [comparison] : []),
      ...comments.slice(1).map(({ record }) => record),
    ]),
  ];
  const result: ScriptureStudySourceRecord[] = [];
  let chars = 0;
  for (const record of prioritized) {
    if (
      result.length >= options.maxRecords ||
      chars + record.excerpt.length > options.maxChars
    )
      continue;
    result.push(record);
    chars += record.excerpt.length;
  }
  return result;
}

export function rankRelatedReferences(
  records: ScriptureStudySourceRecord[],
  reference: BibleReference,
) {
  const counts = new Map<string, number>();
  for (const record of records)
    for (const key of record.relatedReferences ?? [])
      counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts.keys()].sort((a, b) => {
    const aBounds = bounds(a, reference);
    const bBounds = bounds(b, reference);
    const aParsed = /^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)/.exec(a);
    const bParsed = /^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)/.exec(b);
    const aContext = aBounds
      ? -100
      : aParsed?.[1] === reference.bookId &&
          Math.abs(Number(aParsed[2]) - reference.chapter) <= 1
        ? 2
        : 0;
    const bContext = bBounds
      ? -100
      : bParsed?.[1] === reference.bookId &&
          Math.abs(Number(bParsed[2]) - reference.chapter) <= 1
        ? 2
        : 0;
    return (
      bContext - aContext ||
      (counts.get(b) ?? 0) - (counts.get(a) ?? 0) ||
      compareText(a, b)
    );
  });
}

export function selectRelatedReferences(
  records: ScriptureStudySourceRecord[],
  options: {
    reference: BibleReference;
    suppliedRanges: string[];
    limit: number;
  },
) {
  const unsupplied: string[] = [];
  const alreadyCovered: string[] = [];
  for (const referenceKey of rankRelatedReferences(
    records,
    options.reference,
  )) {
    const isAlreadyCovered = (() => {
      const candidate = sameChapterRange(referenceKey);
      if (!candidate) return false;
      return options.suppliedRanges.some((key) => {
        const range = sameChapterRange(key);
        return (
          range &&
          range.bookId === candidate.bookId &&
          range.chapter === candidate.chapter &&
          candidate.start >= range.start &&
          candidate.end <= range.end
        );
      });
    })();
    (isAlreadyCovered ? alreadyCovered : unsupplied).push(referenceKey);
  }
  return [...unsupplied, ...alreadyCovered].slice(
    0,
    Math.max(0, options.limit),
  );
}
