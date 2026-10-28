// Text-range anchoring lives in the shared reader package; this keeps app imports stable.
import {
  createTextQuoteIndex,
  findTextRange,
  normalizeText,
} from "@planetaryescape/reader";
import { occurrencesBefore } from "./lookups";

export {
  findTextRange,
  normalizeText,
  rangeContainsPoint,
} from "@planetaryescape/reader";

/**
 * Finds the match of `text` the reader selected: among the matches that start
 * in its paragraph, the one whose place `occurrencesBefore` numbers
 * `occurrence`, the same count taken when the selection was captured. Where
 * two share that number, the one in the selected letter case wins; matches
 * of the words that overlap each other ("ana" in "banana") can still tie, as
 * capture can't tell them apart either. Without an occurrence or a paragraph,
 * the first match, as `findTextRange` finds it.
 */
export function findOccurrenceRange(
  root: HTMLElement,
  text: string,
  preferred: HTMLElement | null,
  occurrence: number | undefined,
): Range | null {
  // An answer kept before occurrences were stored keeps the exact-case,
  // first-match lookup it was saved under
  if (occurrence !== undefined && preferred && root.contains(preferred)) {
    const inParagraph = createTextQuoteIndex(preferred).findAll(text, {
      caseSensitive: false,
    });
    // Only a selection that runs on past its paragraph needs the whole
    // article, and such a long quote matches in few places
    const candidates = inParagraph.length
      ? inParagraph
      : createTextQuoteIndex(root)
          .findAll(text, { caseSensitive: false })
          .filter((range) => preferred.contains(range.startContainer));
    const placeOf = (range: Range) => {
      const before = document.createRange();
      before.selectNodeContents(preferred);
      before.setEnd(range.startContainer, range.startOffset);
      return occurrencesBefore(rangeText(before), text);
    };
    const placed = candidates.filter((range) => placeOf(range) === occurrence);
    const exact = normalizeText(text);
    const found =
      placed.find((range) => rangeText(range) === exact) ?? placed[0];
    if (found) return found;
  }
  return findTextRange(root, text, preferred);
}

// The reader package's READER_UI_HOST_SELECTOR, which it doesn't export: the
// reader's own controls inside the article, such as an unfolded answer
const READER_UI_HOSTS =
  ".note-unfold, .companion-unfold, [data-reader-ui], [data-marginalia-ui]";

/**
 * The prose a range covers, as anchoring reads it: annotation footnote numbers
 * left out and whitespace collapsed. `Range.toString()` keeps those numbers, so
 * text saved from it can't be found again once a selection crosses the end of
 * an annotated sentence ("train.10 Our model").
 */
export function rangeText(range: Range): string {
  const fragment = range.cloneContents();
  const common = range.commonAncestorContainer;
  // The clone keeps the marks the range crosses; a range wholly inside one mark
  // clones only its children, so its footnote has no mark around it
  const insideMark = Boolean(
    (common instanceof Element ? common : common.parentElement)?.closest(
      ".annotation-mark",
    ),
  );
  for (const sup of fragment.querySelectorAll("sup"))
    if (insideMark || sup.closest(".annotation-mark")) sup.remove();
  // A selection across an unfolded note or answer takes only the article's
  // words, which is all the anchoring index sees
  for (const ui of fragment.querySelectorAll(READER_UI_HOSTS)) ui.remove();
  return (fragment.textContent ?? "").replace(/\s+/g, " ").trim();
}
