// Text-range anchoring lives in the shared reader package; this keeps app imports stable.
export {
  findTextRange,
  normalizeText,
  rangeContainsPoint,
} from "@planetaryescape/reader";

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
