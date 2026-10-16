const sentences = (text: string): string[] =>
  Array.from(
    new Intl.Segmenter("en", { granularity: "sentence" }).segment(text),
    (s) => s.segment.trim(),
  ).filter(Boolean);

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** The sentence of a paragraph that contains the selected word or phrase. */
export function sentenceAround(paragraph: string, selection: string): string {
  const text = squash(paragraph);
  const needle = squash(selection);
  if (!needle) return text;
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return text;
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
