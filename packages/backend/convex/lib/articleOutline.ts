// The headings an article has past the annotation window, so the margin notes
// on its opening know the shape of the rest. Pure functions: the article's
// stored HTML gives the headings and the stored plain text gives the sizes.
import { htmlToPlainText } from "./ingest";

// Headings are read at the levels the PDF import uses (h1 to h3), so a chapter
// and its sections are both listed while nested markup doesn't flood the outline.
const HEADING = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;

export const MAX_OUTLINE_HEADINGS = 60;
export const MAX_OUTLINE_CHARS = 4_000;
const MAX_HEADING_CHARS = 120;
// Room kept for the "and N more" line, so the outline stays within its bound
const OMITTED_LINE_ROOM = 60;

export interface OutlineHeading {
  title: string;
  /** Offset of the heading in the plain text. */
  start: number;
  /** Words from this heading to the next one, or to the end. */
  words: number;
}

/**
 * Every heading in the article, with where it sits in its plain text. The
 * plain text is built piece by piece, one piece per run of body markup and one
 * per heading; joining them with a space gives exactly what htmlToPlainText
 * gives for the whole HTML, so the offsets match the stored `content`. Returns
 * null when they don't (a row written by an older import), since offsets from
 * a different text would place headings wrongly.
 */
export function headingsWithOffsets(
  html: string,
  plainText: string,
): OutlineHeading[] | null {
  const pieces: { plain: string; title?: string }[] = [];
  let last = 0;
  for (const match of html.matchAll(HEADING)) {
    pieces.push({ plain: htmlToPlainText(html.slice(last, match.index)) });
    const title = htmlToPlainText(match[2]);
    pieces.push({ plain: title, title });
    last = match.index + match[0].length;
  }
  pieces.push({ plain: htmlToPlainText(html.slice(last)) });

  const joined = pieces
    .map((piece) => piece.plain)
    .filter(Boolean)
    .join(" ");
  if (joined !== plainText) return null;

  const found: { title: string; start: number }[] = [];
  let offset = 0;
  for (const piece of pieces) {
    if (!piece.plain) continue;
    if (offset > 0) offset += 1;
    if (piece.title) found.push({ title: piece.title, start: offset });
    offset += piece.plain.length;
  }
  return found.map((heading, i) => {
    const bodyStart = heading.start + heading.title.length;
    const end = found[i + 1]?.start ?? plainText.length;
    return {
      title: heading.title,
      start: heading.start,
      words: countWords(plainText.slice(bodyStart, end)),
    };
  });
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Rounded to the nearest ten, since the figure is only a guide to length. */
export const roughWords = (words: number) =>
  Math.max(10, Math.round(words / 10) * 10);

/**
 * The outline of what follows the annotation window, one line per heading
 * with its rough length, or null when nothing past the window has a heading.
 * Bounded by MAX_OUTLINE_HEADINGS and MAX_OUTLINE_CHARS; headings beyond the
 * bounds are summarised as a count, and when there are too many headings the
 * ones listed are spread across the rest of the piece rather than taken from
 * its start.
 */
export function outlineAfterWindow(
  input: { content: string; contentHtml?: string },
  windowChars: number,
): string | null {
  if (!input.contentHtml) return null;
  const headings = headingsWithOffsets(input.contentHtml, input.content);
  if (!headings) return null;
  const after = headings.filter((heading) => heading.start >= windowChars);
  if (!after.length) return null;

  const shown =
    after.length <= MAX_OUTLINE_HEADINGS
      ? after
      : Array.from(
          { length: MAX_OUTLINE_HEADINGS },
          (_, i) =>
            after[Math.floor((i * after.length) / MAX_OUTLINE_HEADINGS)],
        );

  const lines: string[] = [];
  let size = 0;
  for (const heading of shown) {
    const title =
      heading.title.length > MAX_HEADING_CHARS
        ? `${heading.title.slice(0, MAX_HEADING_CHARS)}…`
        : heading.title;
    const line = `- ${title} (about ${roughWords(heading.words)} words)`;
    // Leave room for the line that counts what was not listed
    if (size + line.length + 1 > MAX_OUTLINE_CHARS - OMITTED_LINE_ROOM) break;
    lines.push(line);
    size += line.length + 1;
  }
  const omitted = after.length - lines.length;
  if (omitted > 0) lines.push(`… and ${omitted} more headings not listed`);
  return lines.join("\n");
}
