// Turns the positioned text a PDF holds into headings and paragraphs. PDF has
// no paragraphs, only glyph runs at coordinates, so structure is inferred from
// size, spacing and repetition (spike S7). Pure functions: the pdf.js side is
// in extract.ts.

/** The fields of a pdf.js `TextItem` this module reads. */
export interface PdfTextItem {
  str: string;
  /** [a, b, c, d, x, y] */
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

export interface PdfPage {
  /** 1-based */
  number: number;
  width: number;
  height: number;
  items: readonly PdfTextItem[];
}

/** One baseline of text on a page. */
export interface Line {
  font: string;
  page: number;
  pageHeight: number;
  y: number;
  x: number;
  /** Where the line's text ends, so a following run can join it. */
  x2: number;
  size: number;
  text: string;
}

export type BlockKind = "h1" | "h2" | "h3" | "p";

export interface Block {
  kind: BlockKind;
  text: string;
  /** 1-based page the block starts on */
  page: number;
}

// Icon glyphs in the private-use block would otherwise become empty headings
const PRIVATE_USE = /[-]/g;
const SAME_LINE_TOLERANCE = 2;
const HEADING_SIZE_RATIO = 1.15;
const MAX_SIZE_HEADING_CHARS = 120;
const MAX_NUMBERED_HEADING_CHARS = 80;
/** A wrapped heading never grows past this; more is a run of lines, not a title. */
export const MAX_HEADING_CHARS = 300;
// Header and footer candidates sit in the top or bottom of the page
const EDGE_FRACTION = 0.09;
const NUMBERED_HEADING = /^(\d+\.)*\d+\.?\s+[A-Z]/;
// A table of contents line: text, a run of dots, a page number
const DOT_LEADER = /\.{4,}|(\. ){4,}/;

/** Text turned sideways or upside down: margin stamps such as the arXiv id. */
function isRotated([a, b]: number[]): boolean {
  return Math.abs(b) > Math.abs(a) * 0.1 + 0.01;
}

/**
 * Groups a page's text runs into lines by baseline, in the order the PDF draws
 * them. That order keeps the columns of a two-column paper apart, because
 * typesetters write one column after the other. Rotated runs are skipped.
 */
export function pageToLines(page: PdfPage): Line[] {
  const rows: Line[] = [];
  for (const item of page.items) {
    if (!item.str) continue;
    if (isRotated(item.transform)) continue;
    const size = Math.abs(item.transform[3]) || item.height;
    const x = item.transform[4];
    const y = item.transform[5];
    const last = rows.at(-1);
    if (
      last &&
      Math.abs(last.y - y) < SAME_LINE_TOLERANCE &&
      x >= last.x2 - 1
    ) {
      const gap = x - last.x2;
      const needsSpace =
        gap > size * 0.15 &&
        !last.text.endsWith(" ") &&
        !item.str.startsWith(" ");
      last.text += (needsSpace ? " " : "") + item.str;
      last.x2 = x + item.width;
      last.size = Math.max(last.size, size);
    } else {
      rows.push({
        font: item.fontName,
        page: page.number,
        pageHeight: page.height,
        y,
        x,
        x2: x + item.width,
        size,
        text: item.str,
      });
    }
  }
  const lines: Line[] = [];
  for (const row of rows) {
    const text = row.text.replace(PRIVATE_USE, "").replace(/\s+/g, " ").trim();
    if (text) lines.push({ ...row, text });
  }
  return lines;
}

function mostCommon<T>(weights: Map<T, number>): T | undefined {
  let best: T | undefined;
  let bestWeight = -1;
  for (const [key, weight] of weights) {
    if (weight > bestWeight) {
      best = key;
      bestWeight = weight;
    }
  }
  return best;
}

function addWeight<T>(weights: Map<T, number>, key: T, amount: number) {
  weights.set(key, (weights.get(key) ?? 0) + amount);
}

const normalise = (text: string) => text.replace(/\d+/g, "#").toLowerCase();

function isOnEdge(line: Line) {
  return (
    line.y > line.pageHeight * (1 - EDGE_FRACTION) ||
    line.y < line.pageHeight * EDGE_FRACTION
  );
}

/**
 * Lines at the top or bottom of a page that repeat on enough pages to be a
 * running header or footer, and bare page numbers.
 */
function dropRunningHeadersAndFooters(
  lines: readonly Line[],
  pageCount: number,
): Line[] {
  const pagesByPattern = new Map<string, Set<number>>();
  for (const line of lines) {
    if (!isOnEdge(line)) continue;
    const key = normalise(line.text);
    const pages = pagesByPattern.get(key) ?? new Set<number>();
    pages.add(line.page);
    pagesByPattern.set(key, pages);
  }
  const threshold = Math.max(3, pageCount * 0.25);
  return lines.filter((line) => {
    if (!isOnEdge(line)) return true;
    const repeated =
      (pagesByPattern.get(normalise(line.text))?.size ?? 0) >= threshold;
    // A lone "c" or "i" is not a page number; two or more roman letters are
    const pageNumber =
      /^\d{1,4}$/.test(line.text) || /^[ivxlcdm]{2,}$/i.test(line.text);
    return !(repeated || pageNumber);
  });
}

/**
 * Joins a line to the text before it. A word broken at a hyphen is made whole
 * only when the next line starts in lower case, carries on without another
 * hyphen, and the part before the hyphen isn't capitalised: "con-|nection"
 * becomes "connection", while "English-|to-German" keeps its hyphens, as does
 * "Anglo-|American".
 */
export function joinLines(text: string, next: string): string {
  const broken = /(\p{L}+)-$/u.exec(text);
  if (!broken) return `${text} ${next}`;
  const firstWord = /^\S+/.exec(next)?.[0] ?? "";
  const wordContinues =
    /^\p{Ll}/u.test(next) &&
    !firstWord.includes("-") &&
    !/^\p{Lu}/u.test(broken[1]);
  return wordContinues ? text.slice(0, -1) + next : text + next;
}

/**
 * Headings and paragraphs from the lines of a whole document.
 * `pageCount` is the number of pages in the PDF, not only those with text.
 */
export function buildBlocks(
  allLines: readonly Line[],
  pageCount: number,
): Block[] {
  const lines = dropRunningHeadersAndFooters(
    allLines.filter((line) => !DOT_LEADER.test(line.text)),
    pageCount,
  );
  if (!lines.length) return [];

  const bodyFont = mostCommon(
    lines.reduce((weights, line) => {
      addWeight(weights, line.font, line.text.length);
      return weights;
    }, new Map<string, number>()),
  );
  const bodySize =
    mostCommon(
      lines.reduce((weights, line) => {
        addWeight(weights, Math.round(line.size * 2) / 2, line.text.length);
        return weights;
      }, new Map<number, number>()),
    ) ?? 12;

  const isSizeHeading = (line: Line) =>
    line.size > bodySize * HEADING_SIZE_RATIO &&
    line.text.length < MAX_SIZE_HEADING_CHARS;
  const isNumberedHeading = (line: Line) =>
    NUMBERED_HEADING.test(line.text) &&
    line.font !== bodyFont &&
    line.text.length < MAX_NUMBERED_HEADING_CHARS &&
    !/[.,;]$/.test(line.text);

  // Larger type is a higher heading; ties to the same rank
  const headingSizes = [
    ...new Set(
      lines.filter(isSizeHeading).map((line) => Math.round(line.size)),
    ),
  ].sort((a, b) => b - a);

  const levelOf = (line: Line): 1 | 2 | 3 => {
    if (isNumberedHeading(line) && line.size <= bodySize * HEADING_SIZE_RATIO) {
      const number = /^((\d+\.)*\d+)/.exec(line.text)?.[1];
      const depth = number ? number.split(".").length : 1;
      return Math.min(3, depth + 1) as 1 | 2 | 3;
    }
    const rank = headingSizes.indexOf(Math.round(line.size)) + 1;
    return Math.min(3, Math.max(1, rank || 3)) as 1 | 2 | 3;
  };

  const blocks: Block[] = [];
  let paragraph: { text: string; page: number } | null = null;
  let previous: Line | null = null;
  const flush = () => {
    if (paragraph) blocks.push({ kind: "p", ...paragraph });
    paragraph = null;
  };

  for (const line of lines) {
    if (isSizeHeading(line) || isNumberedHeading(line)) {
      flush();
      const kind = `h${levelOf(line)}` as BlockKind;
      const last = blocks.at(-1);
      // A heading that wraps onto a second line is one heading, but a run of
      // heading-sized lines is not: past MAX_HEADING_CHARS it starts another
      if (
        last &&
        last.kind === kind &&
        last.page === line.page &&
        previous?.size === line.size &&
        last.text.length + line.text.length < MAX_HEADING_CHARS
      )
        last.text += ` ${line.text}`;
      else blocks.push({ kind, text: line.text, page: line.page });
      previous = line;
      continue;
    }
    const endsSentence = previous !== null && /[.!?:"”)]$/.test(previous.text);
    const startsParagraph =
      paragraph === null ||
      (previous !== null &&
        (previous.page === line.page
          ? previous.y - line.y > line.size * 1.7 ||
            // First-line indent after a sentence end
            (line.x > previous.x + line.size * 0.8 && endsSentence)
          : // A paragraph runs over a page break unless the sentence ended
            endsSentence));
    if (startsParagraph || !paragraph) {
      flush();
      paragraph = { text: line.text, page: line.page };
    } else {
      // Join a word broken across lines; a real compound at the break loses
      // its hyphen, which is the cheaper mistake
      paragraph.text = joinLines(paragraph.text, line.text);
    }
    previous = line;
  }
  flush();
  return blocks;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function blocksToHtml(blocks: readonly Block[]): string {
  return blocks
    .map((b) =>
      b.kind === "p"
        ? `<p>${escapeHtml(b.text)}</p>`
        : `<${b.kind}>${escapeHtml(b.text)}</${b.kind}>`,
    )
    .join("\n");
}

export function blocksToText(blocks: readonly Block[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}

/**
 * A scanned PDF has pages but no text layer. Refused when the average is under
 * about 100 characters a page, or most pages carry under 20.
 */
export function looksScanned(pageChars: readonly number[]): boolean {
  if (!pageChars.length) return true;
  const total = pageChars.reduce((sum, n) => sum + n, 0);
  const nearlyEmpty = pageChars.filter((n) => n < 20).length;
  return total / pageChars.length < 100 || nearlyEmpty > pageChars.length / 2;
}
