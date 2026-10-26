/**
 * How much of the article the import pass reads (~20k words). Reading
 * alongside is not held to it: its sections cover the whole article.
 */
export const MAX_ARTICLE_CHARS = 120_000;

// The article is searched section by section so a claim deep in the piece can
// find its own matches, not just whatever the introduction is about. Reading
// alongside (rung 2f) annotates the same sections one at a time.
export const MAX_SECTIONS = 12;
const MIN_SECTION_CHARS = 3_000;

/** How far through a section the reader is when the next one is queued. */
export const QUEUE_NEXT_AT = 0.4;

export interface SectionRange {
  index: number;
  /** Offsets into the text that was split; `text` is the trimmed slice. */
  start: number;
  end: number;
  text: string;
}

/** The sections of an article's text, with where each one sits in it. */
export function sectionRanges(text: string): SectionRange[] {
  const size = Math.max(
    MIN_SECTION_CHARS,
    Math.ceil(text.length / MAX_SECTIONS),
  );
  const found: { start: number; end: number; text: string }[] = [];
  let start = 0;
  while (start < text.length && found.length < MAX_SECTIONS) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      // Prefer to cut at a paragraph or sentence boundary
      const window = text.slice(start + Math.floor(size * 0.7), end);
      const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". "));
      if (cut > 0) end = start + Math.floor(size * 0.7) + cut + 1;
    }
    if (found.length === MAX_SECTIONS - 1) end = text.length;
    const raw = text.slice(start, end);
    const trimmed = raw.trim();
    const lead = raw.length - raw.trimStart().length;
    found.push({
      start: start + lead,
      end: start + lead + trimmed.length,
      text: trimmed,
    });
    start = end;
  }
  return found
    .filter((section) => section.text)
    .map((section, index) => ({ ...section, index }));
}

/**
 * Whether the import pass never read some of this section, so nothing it
 * drew on is a baseline to compare with. Such a section's first pass is made
 * even if the library has not changed, and again after a pass that made no
 * pass that skipped or failed (only a finished pass records what it drew on).
 */
export function beyondImportPass(
  section: Pick<SectionRange, "end">,
  pass: { contextHash?: string } | null | undefined,
): boolean {
  return section.end > MAX_ARTICLE_CHARS && !pass?.contextHash;
}

export function splitIntoSections(text: string): string[] {
  return sectionRanges(text).map((section) => section.text);
}

/**
 * The section the reader has got far enough through to queue the one after
 * it, or null. `progress` is how far through the whole text they are (0 to 1),
 * and `textLength` the full length of the text the ranges were made from.
 */
export function sectionToQueueFrom(
  ranges: readonly SectionRange[],
  progress: number,
  textLength: number,
): number | null {
  if (ranges.length < 2 || textLength <= 0) return null;
  const at = Math.min(Math.max(progress, 0), 1) * textLength;
  const current = ranges.findLast((section) => section.start <= at);
  if (!current || current.index >= ranges.length - 1) return null;
  const through =
    (at - current.start) / Math.max(1, current.end - current.start);
  return through >= QUEUE_NEXT_AT ? current.index : null;
}
