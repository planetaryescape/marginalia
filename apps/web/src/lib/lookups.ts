const sentences = (text: string): string[] =>
  Array.from(
    new Intl.Segmenter("en", { granularity: "sentence" }).segment(text),
    (s) => s.segment.trim(),
  ).filter(Boolean);

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** Where each match of `needle` starts in `text`, ignoring case. */
function matchStarts(text: string, needle: string): number[] {
  const haystack = text.toLowerCase();
  const target = needle.toLowerCase();
  const starts: number[] = [];
  for (
    let at = haystack.indexOf(target);
    at >= 0;
    at = haystack.indexOf(target, at + 1)
  )
    starts.push(at);
  return starts;
}

/**
 * How many times the selected words already appeared before the selection, so
 * the right occurrence is found again when the same word repeats in a paragraph.
 */
export function occurrencesBefore(prefix: string, selection: string): number {
  const needle = squash(selection);
  if (!needle) return 0;
  // A match that starts before the selection and runs into it counts too, as
  // the first "ana" in "banana" does when the second is selected
  const head = prefix.replace(/\s+/g, " ").replace(/^ /, "");
  return matchStarts(head + needle, needle).filter((at) => at < head.length)
    .length;
}

/**
 * The sentence of a paragraph that contains the selected word or phrase. When
 * the words occur more than once, `occurrence` says which one was selected.
 */
export function sentenceAround(
  paragraph: string,
  selection: string,
  occurrence = 0,
): string {
  const text = squash(paragraph);
  const needle = squash(selection);
  if (!needle) return text;
  const starts = matchStarts(text, needle);
  const at = starts[occurrence] ?? starts[0];
  if (at === undefined) return text;
  let offset = 0;
  for (const sentence of sentences(text)) {
    const start = text.indexOf(sentence, offset);
    const end = start + sentence.length;
    offset = end;
    if (at < end) return sentence;
  }
  return text;
}

/**
 * The one line of a definition worth keeping in the personal dictionary:
 * its first sentence, without the answer's markdown.
 */
export function senseOf(answer: string): string {
  const plain = squash(
    answer
      .trim()
      .split(/\n{2,}/)[0]
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*`]/g, "")
      .replace(/¶\s?\d+(?:\s*[–-]\s*\d+)?/g, ""),
  );
  return sentences(plain)[0] ?? plain;
}
