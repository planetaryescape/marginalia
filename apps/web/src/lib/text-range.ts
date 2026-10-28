// Text-range anchoring lives in the shared reader package; this keeps app imports stable.
import { createTextQuoteIndex, findTextRange } from "@planetaryescape/reader";

export {
  findTextRange,
  normalizeText,
  rangeContainsPoint,
} from "@planetaryescape/reader";

/**
 * Finds the `occurrence`-th match of `text` in its paragraph, the one the
 * reader selected, else the first match anywhere. Matches are counted as
 * `occurrencesBefore` counts them when a selection is captured: ignoring
 * case, overlapping ones separately.
 */
export function findOccurrenceRange(
  root: HTMLElement,
  text: string,
  preferred: HTMLElement | null,
  occurrence: number | undefined,
): Range | null {
  if (occurrence && preferred && root.contains(preferred)) {
    const range = createTextQuoteIndex(preferred).find(text, {
      occurrence,
      caseSensitive: false,
    });
    if (range) return range;
  }
  return findTextRange(root, text, preferred);
}

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
  return (fragment.textContent ?? "").replace(/\s+/g, " ").trim();
}
