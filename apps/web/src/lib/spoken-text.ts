import { paragraphText } from "./paragraphs";

/** The most one clip may carry; the backend refuses more (04-synthesis-and-cache). */
export const MAX_CLIP_CHARS = 2000;
/** The first clip of a listen stays short so the voice starts within about 2 s (D-TTS-023). */
export const LEAD_CHARS = 300;

/** What the voice says for one block, and whether the block is a heading (longer pause after it). */
export interface SpokenBlock {
  text: string;
  heading: boolean;
}

const SKIPPED_ANCESTORS = "pre, table";
const FOOTNOTE_MARKER = /^[\s\d\p{P}\p{S}]+$/u;
const BRACKETED_NUMBER = /\[\d+\]/g;
const BARE_URL = /(?:https?:\/\/|www\.)[^\s<>]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"’”]+$/;
const CLOSING_PUNCTUATION = /[.!?…:;]["'”’)\]]*$/;

function linkSentence(match: string): string {
  const trailing = match.match(TRAILING_PUNCTUATION)?.[0] ?? "";
  const url = match.slice(0, match.length - trailing.length);
  try {
    const href = /^www\./i.test(url) ? `https://${url}` : url;
    const host = new URL(href).hostname.replace(/^www\./i, "");
    return `a link to ${host}${trailing}`;
  } catch {
    return match;
  }
}

/** A block made only of code reads as noise, whatever tag wraps it. */
function isCodeOnly(el: HTMLElement): boolean {
  if (el.tagName === "CODE") return true;
  const codes = el.querySelectorAll("code");
  if (codes.length === 0) return false;
  const clone = el.cloneNode(true) as HTMLElement;
  for (const code of clone.querySelectorAll("code")) code.remove();
  return !(clone.textContent ?? "").trim();
}

/**
 * Rules 1 to 5 of the blueprint's spoken-text section: the whole text of one
 * block as the voice should say it, or `null` when the block is skipped.
 */
export function spokenBlock(el: HTMLElement): SpokenBlock | null {
  if (el.closest(SKIPPED_ANCESTORS) || isCodeOnly(el)) return null;
  const clone = el.cloneNode(true) as HTMLElement;
  for (const sup of clone.querySelectorAll("sup")) {
    if (FOOTNOTE_MARKER.test(sup.textContent ?? "")) sup.remove();
  }
  const heading = /^H[1-6]$/.test(el.tagName);
  let text = paragraphText(clone)
    .replace(BRACKETED_NUMBER, "")
    .replace(BARE_URL, linkSentence)
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (heading && !CLOSING_PUNCTUATION.test(text)) text += ".";
  return { text, heading };
}

/** What opens a listen from the top: "<title>. By <author>.", or just "<title>.". */
export function spokenTitle(title: string, author?: string | null): string {
  const named = title.replace(/\s+/g, " ").trim();
  const by = author?.replace(/\s+/g, " ").trim();
  if (!named) return by ? `By ${by}.` : "";
  const sentence = CLOSING_PUNCTUATION.test(named) ? named : `${named}.`;
  return by ? `${sentence} By ${by}.` : sentence;
}

function sentencesOf(text: string, lang: string): string[] {
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(lang, { granularity: "sentence" });
  } catch {
    // An unknown language tag still has sentences
    segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  }
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Splits one over-long sentence at the last comma or space before the limit. */
function splitLongSentence(sentence: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const at = Math.max(window.lastIndexOf(","), window.lastIndexOf(" "));
    // The backend counts UTF-16 units like `.length`, so never cut an emoji in half
    const hardCut = isHighSurrogate(window.charCodeAt(max - 1)) ? max - 1 : max;
    const cut = at > 0 ? at + 1 : hardCut;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Sentences, with any sentence longer than `max` already split. */
function sentencePieces(text: string, lang: string, max: number): string[] {
  return sentencesOf(text, lang).flatMap((sentence) =>
    sentence.length > max ? splitLongSentence(sentence, max) : [sentence],
  );
}

function pack(pieces: string[], max: number): string[] {
  const parts: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length > max) {
      parts.push(current);
      current = "";
    }
    current += piece;
  }
  if (current) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Rule 6: parts of at most `max` characters, split at sentence ends. */
export function splitSpoken(
  text: string,
  lang: string,
  max = MAX_CLIP_CHARS,
): string[] {
  if (text.length <= max) return text ? [text] : [];
  return pack(sentencePieces(text, lang, max), max);
}

/**
 * The first block of a listen: its leading sentences packed up to
 * `LEAD_CHARS` (always at least one sentence) as the first part, then the rest
 * packed as usual. A clip's wait grows with its length, so a short first part
 * is what gets the voice going quickly (D-TTS-023).
 */
export function splitLeading(
  text: string,
  lang: string,
  lead = LEAD_CHARS,
  max = MAX_CLIP_CHARS,
): string[] {
  if (text.length <= lead) return text ? [text] : [];
  const pieces = sentencePieces(text, lang, max);
  let taken = 0;
  let length = 0;
  while (taken < pieces.length) {
    const next = pieces[taken].length;
    if (taken > 0 && length + next > lead) break;
    length += next;
    taken += 1;
  }
  const first = pieces.slice(0, taken).join("").trim();
  return [first, ...pack(pieces.slice(taken), max)].filter(Boolean);
}
