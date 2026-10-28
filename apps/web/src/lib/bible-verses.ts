import { parseBibleReference } from "@marginalia/backend/bible";

/**
 * One displayed verse of a Bible reading, found in the rendered DOM.
 *
 * Verses cross blocks (poetry lines, continued paragraphs), so a verse is a
 * text range, never an element. `range` is one contiguous Range from the
 * verse's first word to its last, which is what the passage actions take; it
 * can contain a footnote that sits mid-verse, exactly as a mouse selection
 * would, so saved marks still find their text again. `segments` are the verse's
 * own text nodes only and are what gets painted, so numbers and footnotes are
 * never tinted.
 */
export interface DisplayedVerse {
  /** Identity in reading order: the verse id, or a bridge's ids joined. */
  key: string;
  /** "Psalms 23:4" */
  label: string;
  range: Range;
  segments: Range[];
}

// Same exclusions as bible-study-selection.ts, which decides what is passage.
const NON_PASSAGE =
  ".yv-n, [data-verse-footnote], .footnote, [data-marginalia-ui]";
const HEADING =
  "h1,h2,h3,h4,h5,h6,.s,.s1,.s2,.s3,.ms,.ms1,.ms2,.mt,.mt1,.mt2,.d,.sp,.r,.mr,.cl";
const LABEL = ".yv-vlbl, sup";
const VERSE_ID = /^[1-3]?[A-Z]{2,3}\.\d+\.\d+$/;

const elementOf = (node: Node) =>
  node instanceof Element ? node : node.parentElement;

/**
 * The verses of a rendered reading, in reading order. Verses are identified by
 * `[data-usfm]` spans or `p[id]` verse paragraphs when the display has them,
 * and otherwise by the empty `.yv-v[v]` markers that precede each verse's text.
 */
export function displayedVerses(
  reference: string,
  body: HTMLElement,
): DisplayedVerse[] {
  const ref = parseBibleReference(reference);
  if (!ref) return [];
  const doc = body.ownerDocument;
  const verses: Array<{
    key: string;
    id: string;
    nodes: Array<{ node: Text; from: number; to: number }>;
  }> = [];
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ALL);
  let chapter = ref.chapter;
  let previousVerse = 0;
  let markerId: string | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = elementOf(node);
    if (!element || element.closest(NON_PASSAGE)) continue;
    if (node instanceof Element && node.matches(".yv-v[v]")) {
      const value = node.getAttribute("v");
      const verse = value && /^\d+$/.test(value) ? Number(value) : 0;
      if (verse > 0 && verse <= 176) {
        if (verse < previousVerse) chapter += 1;
        previousVerse = verse;
        markerId = `${ref.bookId}.${chapter}.${verse}`;
      } else markerId = null;
      continue;
    }
    if (!(node instanceof Text)) continue;
    const text = node.data;
    const from = text.search(/\S/);
    if (from < 0) continue;
    if (element.closest(HEADING) || element.closest(LABEL)) continue;
    const wrapper = element.closest("[data-usfm], p[id]");
    const raw =
      wrapper?.getAttribute("data-usfm") ??
      (wrapper?.id && VERSE_ID.test(wrapper.id) ? wrapper.id : null);
    const ids = raw?.trim().split(/\s+/).filter(Boolean);
    const key = ids?.length ? ids.join(" ") : markerId;
    if (!key) continue;
    const to = text.trimEnd().length;
    const last = verses.at(-1);
    if (last?.key === key) last.nodes.push({ node, from, to });
    else
      verses.push({
        key,
        id: key.split(" ")[0],
        nodes: [{ node, from, to }],
      });
  }
  return verses.map((verse) => {
    const first = verse.nodes[0];
    const last = verse.nodes[verse.nodes.length - 1];
    const range = doc.createRange();
    range.setStart(first.node, first.from);
    range.setEnd(last.node, last.to);
    const segments = verse.nodes.map(({ node, from, to }) => {
      const segment = doc.createRange();
      segment.setStart(node, from);
      segment.setEnd(node, to);
      return segment;
    });
    const [, verseChapter, verseNumber] = verse.id.split(".");
    return {
      key: verse.key,
      label: `${ref.book} ${Number(verseChapter)}:${Number(verseNumber)}`,
      range,
      segments,
    };
  });
}

/**
 * Index of the verse to start from when the reader has no verse cursor yet:
 * the first verse that ends at or after the given block, or the last verse
 * when the block is past them all.
 */
export function verseAtOrAfter(
  verses: DisplayedVerse[],
  block: Node | null,
): number {
  if (!verses.length) return -1;
  if (!block) return 0;
  const at = verses.findIndex(
    ({ range }) =>
      !(
        block.compareDocumentPosition(range.endContainer) &
        Node.DOCUMENT_POSITION_PRECEDING
      ),
  );
  return at < 0 ? verses.length - 1 : at;
}

/** Whether two ranges share any text. */
export function rangesOverlap(a: Range, b: Range): boolean {
  return (
    a.compareBoundaryPoints(Range.END_TO_START, b) < 0 &&
    a.compareBoundaryPoints(Range.START_TO_END, b) > 0
  );
}
