import type { Doc } from "../_generated/dataModel";
import { parseBibleReference } from "./bible";
import { type ScriptureSelection, STUDY_LIMITS } from "./scriptureStudy";

export type ChapterVerse = { id: string; verse: number; text: string };
export function chapterVerses(
  content: string,
  reference: string,
): ChapterVerse[] {
  const chapter = parseBibleReference(reference);
  if (!chapter) throw new Error("Could not parse selected WEB chapter.");
  return content.split(/\n\s*\n/).flatMap((line) => {
    const match = /^(\d+):(\d+)\s+([\s\S]+)$/.exec(line);
    return !match || Number(match[1]) !== chapter.chapter
      ? []
      : [
          {
            id: `${chapter.bookId}.${chapter.chapter}.${Number(match[2])}`,
            verse: Number(match[2]),
            text: match[3].trim(),
          },
        ];
  });
}

function rangeKey(verses: { id: string }[]) {
  return `${verses[0].id}${verses.length > 1 ? `-${verses.at(-1)!.id}` : ""}`;
}
function contiguousRanges(verses: ChapterVerse[]) {
  const groups: ChapterVerse[][] = [];
  for (const verse of verses) {
    const current = groups.at(-1);
    if (current && verse.verse === current.at(-1)!.verse + 1)
      current.push(verse);
    else groups.push([verse]);
  }
  return groups.map(rangeKey);
}
function blocks(verses: ChapterVerse[]) {
  const result: { referenceKey: string; excerpt: string }[] = [];
  let current: ChapterVerse[] = [],
    size = 0;
  const flush = () => {
    if (current.length)
      result.push({
        referenceKey: rangeKey(current),
        excerpt: current.map((v) => `${v.id} ${v.text}`).join("\n"),
      });
    current = [];
    size = 0;
  };
  for (const verse of verses) {
    const length = `${verse.id} ${verse.text}\n`.length;
    if (
      current.length &&
      (verse.verse !== current.at(-1)!.verse + 1 ||
        size + length > STUDY_LIMITS.excerptChars)
    )
      flush();
    if (length > STUDY_LIMITS.excerptChars) continue;
    current.push(verse);
    size += length;
  }
  flush();
  return result;
}

/** Expand outwards through the fetched chapter, never across a missing verse.
 * Selected/adjacent text is already evidence; only additional text is returned.
 */
export function studyChapterContext(
  chapter: ChapterVerse[],
  selection: ScriptureSelection,
  availableChars: number,
) {
  if (
    !chapter.length ||
    new Set(chapter.map((v) => v.verse)).size !== chapter.length
  )
    throw new Error(
      "Verified WEB chapter has missing or duplicate verse identities.",
    );
  const ordered = [...chapter].sort((a, b) => a.verse - b.verse);
  const start = Number(selection.startVerseId.split(".")[2]);
  const end = Number(selection.endVerseId.split(".")[2]);
  const byVerse = new Map(ordered.map((v) => [v.verse, v]));
  const base = new Set(
    ordered
      .filter((v) => v.verse >= start - 2 && v.verse <= end + 2)
      .map((v) => v.verse),
  );
  const extra: ChapterVerse[] = [];
  let remaining = Math.max(
    0,
    Math.min(STUDY_LIMITS.chapterContextChars, availableChars),
  );
  let left = start - 1,
    right = end + 1;
  while (byVerse.has(left) || byVerse.has(right)) {
    const chooseLeft =
      byVerse.has(left) && (!byVerse.has(right) || start - left <= right - end);
    const number = chooseLeft ? left : right;
    const verse = byVerse.get(number)!;
    const size = `${verse.id} ${verse.text}\n`.length;
    if (!base.has(number)) {
      if (size > remaining || size > STUDY_LIMITS.excerptChars) {
        if (chooseLeft) left = -1;
        else right = -1;
        continue;
      }
      extra.push(verse);
      remaining -= size;
    }
    if (chooseLeft) left--;
    else right++;
  }
  const additional = extra.sort((a, b) => a.verse - b.verse);
  const evidenceBlocks = blocks(additional);
  const included = ordered.filter(
    (v) => base.has(v.verse) || additional.includes(v),
  );
  const full =
    included.length === ordered.length &&
    ordered[0].verse === 1 &&
    ordered.every((v, i) => i === 0 || v.verse === ordered[i - 1].verse + 1);
  return {
    coverage: full ? ("full_retrieved_chapter" as const) : ("bounded" as const),
    referenceKey: rangeKey(ordered),
    ranges: contiguousRanges(included),
    evidenceBlocks,
  };
}

type Note = Pick<
  Doc<"userNotes">,
  "selectedText" | "licensedQuote" | "contentPlain"
>;
export interface StudyReaderContext {
  role: "untrusted_personal_context_not_evidence";
  notes: { label: string; scope: "passage" | "chapter"; text: string }[];
  limited: boolean;
}

export function studyReaderContext(
  notes: Note[],
  articleReference: string,
  savedContent: string,
  selection: ScriptureSelection,
  scanLimited: boolean,
) {
  const article = parseBibleReference(articleReference);
  const selectedChapter = Number(selection.startVerseId.split(".")[1]);
  const selectedStart = Number(selection.startVerseId.split(".")[2]);
  const selectedEnd = Number(selection.endVerseId.split(".")[2]);
  const singleChapter =
    article?.chapter === selectedChapter &&
    article.endChapter === selectedChapter;
  const chapter = article
    ? chapterVerses(savedContent, `${article.book} ${selectedChapter}`)
    : [];
  const candidates = notes
    .flatMap((note) => {
      if (!note.contentPlain.trim()) return [];
      // Never guess an alignment from licensed wording or display offsets to WEB.
      const quote = note.selectedText.trim();
      const matches =
        !note.licensedQuote && quote
          ? savedContent
              .split(/\n\s*\n/)
              .filter(
                (line) =>
                  /^\d+:\d+\s/.test(line) &&
                  line.replace(/^\d+:\d+\s+/, "").includes(quote),
              )
          : [];
      const located =
        matches.length === 1
          ? (chapter.find(
              (v) =>
                `${selectedChapter}:${v.verse} ${v.text}` === matches[0].trim(),
            ) ?? null)
          : null;
      if (!singleChapter && !located) return [];
      return [
        {
          scope:
            located &&
            located.verse >= selectedStart &&
            located.verse <= selectedEnd
              ? ("passage" as const)
              : ("chapter" as const),
          text: note.contentPlain.trim(),
        },
      ];
    })
    .sort(
      (a, b) =>
        (a.scope === "passage" ? 0 : 1) - (b.scope === "passage" ? 0 : 1),
    );
  const readerContext: StudyReaderContext = {
    role: "untrusted_personal_context_not_evidence",
    notes: [],
    limited:
      scanLimited ||
      notes.filter((note) => note.contentPlain.trim()).length >
        candidates.length,
  };
  for (const note of candidates) {
    if (readerContext.notes.length >= STUDY_LIMITS.readerNotes) {
      readerContext.limited = true;
      break;
    }
    const item = {
      ...note,
      label: `reader-note-${readerContext.notes.length + 1}`,
      text: note.text.slice(0, STUDY_LIMITS.readerNoteChars),
    };
    if (item.text.length < note.text.length) readerContext.limited = true;
    const overflow = () =>
      JSON.stringify({
        ...readerContext,
        notes: [...readerContext.notes, item],
      }).length - STUDY_LIMITS.readerContextChars;
    while (item.text.length && overflow() > 0) {
      item.text = item.text.slice(
        0,
        Math.max(0, item.text.length - overflow()),
      );
      readerContext.limited = true;
    }
    if (item.text) readerContext.notes.push(item);
    else readerContext.limited = true;
  }
  return readerContext;
}
