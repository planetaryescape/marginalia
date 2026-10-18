/** Keep the former per-paragraph allowance and the existing local context budget. */
export const LOCAL_PARAGRAPH_CHARS = 20_000;
export const MAX_CONTEXT_CHARS = 120_000;
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** Remainder of a selection crossing two normalized paragraphs, or null. */
export function crossInto(rest: string, paragraph: string, next: string) {
  for (let cut = Math.min(rest.length, paragraph.length); cut > 0; cut--) {
    if (!paragraph.endsWith(rest.slice(0, cut))) continue;
    const remainder = rest.slice(cut).trimStart();
    if (!remainder) return null;
    const shared = Math.min(remainder.length, next.length);
    if (
      shared > 0 &&
      cut + shared >= 12 &&
      next.startsWith(remainder.slice(0, shared))
    )
      return remainder;
  }
  return null;
}

/** Raw offsets for matches, using the reader's case/whitespace matching rules. */
function occurrencePositions(text: string, needle: string): number[] {
  let squashed = "";
  const rawOf: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (!squashed || squashed.endsWith(" ")) continue;
      squashed += " ";
    } else squashed += text[i];
    rawOf.push(i);
  }
  const lowered = squashed.toLowerCase();
  const raw: number[] = [];
  for (let k = 0; k < squashed.length; k++)
    for (let n = squashed[k].toLowerCase().length; n > 0; n--)
      raw.push(rawOf[k]);
  const target = squash(needle).toLowerCase();
  if (!target) return [];
  const positions: number[] = [];
  for (
    let at = lowered.indexOf(target);
    at >= 0;
    at = lowered.indexOf(target, at + 1)
  )
    positions.push(raw[at] ?? 0);
  return positions;
}

/** Falls back to the last match, then to the start, as passage Ask already does. */
export function occurrenceAt(
  text: string,
  needle: string,
  occurrence: number,
): number {
  const positions = occurrencePositions(text, needle);
  return positions[Math.min(occurrence, positions.length - 1)] ?? 0;
}

function excerpt(text: string, at: number, limit: number) {
  if (text.length <= limit) return { text, from: 0 };
  const room = Math.max(0, limit - 2);
  const from = Math.min(
    Math.max(0, at - Math.floor(room / 4)),
    text.length - room,
  );
  const to = from + room;
  return {
    text: `${from ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`,
    from,
  };
}

/** The selected sentence, or a bounded stretch of that sentence if it is enormous. */
export function localUsageSentence(
  text: string,
  selection: string,
  occurrence = 0,
): string {
  const normalized = squash(text);
  const at = occurrenceAt(normalized, selection, occurrence);
  const sentence = new Intl.Segmenter("en", {
    granularity: "sentence",
  })
    .segment(normalized)
    .containing(at);
  if (sentence)
    return excerpt(sentence.segment.trim(), at - sentence.index, 2000).text;
  return excerpt(normalized, at, 2000).text;
}

export interface LocalParagraph {
  index: number;
  text: string;
}

export interface BoundedLocalContext {
  paragraphs: LocalParagraph[];
  occurrence: number;
}

/**
 * Normal <=20k paragraphs are unchanged while the window fits 120k. Oversize
 * selected paragraphs are centred on the actual occurrence (or crossing edge),
 * then neighbours receive the remaining budget. Paragraph identities never move.
 */
export function boundedLocalContext(input: {
  paragraphs: readonly LocalParagraph[];
  start: number;
  end: number;
  selection: string;
  occurrence: number;
}): BoundedLocalContext {
  const marked = input.paragraphs.filter(
    (p) => p.index >= input.start && p.index <= input.end,
  );
  const perMarked = Math.min(
    LOCAL_PARAGRAPH_CHARS,
    Math.floor(MAX_CONTEXT_CHARS / Math.max(1, marked.length)),
  );
  const chosen: LocalParagraph[] = [];
  let room = MAX_CONTEXT_CHARS;
  let occurrence = input.occurrence;
  const add = (paragraph: LocalParagraph, limit: number) => {
    if (!paragraph.text || limit < 2) return;
    let at = paragraph.index < input.start ? paragraph.text.length : 0;
    if (paragraph.index === input.start) {
      if (input.end > input.start) {
        // A crossing selection starts in this paragraph's closing words.
        at = paragraph.text.length;
        const wanted = input.selection.trim();
        for (
          let cut = Math.min(wanted.length, paragraph.text.length);
          cut > 0;
          cut--
        )
          if (paragraph.text.endsWith(wanted.slice(0, cut))) {
            at = paragraph.text.length - cut;
            break;
          }
      } else
        at = occurrenceAt(paragraph.text, input.selection, input.occurrence);
    }
    const clipped = excerpt(paragraph.text, at, limit);
    if (
      paragraph.index === input.start &&
      clipped.from > 0 &&
      input.end === input.start
    ) {
      const relative = at - clipped.from + 1; // leading omission marker
      occurrence = occurrencePositions(clipped.text, input.selection).filter(
        (position) => position < relative,
      ).length;
    }
    chosen.push({ index: paragraph.index, text: clipped.text });
    room -= clipped.text.length;
  };
  for (const paragraph of marked) add(paragraph, perMarked);
  for (const paragraph of input.paragraphs)
    if (paragraph.index < input.start || paragraph.index > input.end)
      add(paragraph, Math.min(LOCAL_PARAGRAPH_CHARS, room));
  return { paragraphs: chosen.sort((a, b) => a.index - b.index), occurrence };
}
