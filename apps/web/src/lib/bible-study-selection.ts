import { parseBibleReference } from "@marginalia/backend/bible";

export interface StudySelection {
  referenceKey: string;
  startVerseId: string;
  endVerseId: string;
  versificationId: "web";
}

const NON_PASSAGE =
  ".yv-n, [data-verse-footnote], .footnote, [data-marginalia-ui]";
const HEADING =
  "h1,h2,h3,h4,h5,h6,.s,.s1,.s2,.s3,.ms,.ms1,.ms2,.mt,.mt1,.mt2,.d,.sp,.r,.mr,.cl";
const LABEL = ".yv-vlbl, sup";
const elementOf = (node: Node) =>
  node instanceof Element ? node : node.parentElement;

/** Resolve containing verses, not an invented alignment of English words to WEB.
 * No displayed wording leaves this function. The server verifies the descriptor
 * against its owned saved source before admitting a study.
 */
export function resolveStudySelection(
  reference: string,
  sourceText: string,
  body: HTMLElement,
  range: Range,
): StudySelection | null {
  const ref = parseBibleReference(reference);
  if (
    !ref ||
    range.collapsed ||
    !body.contains(range.startContainer) ||
    !body.contains(range.endContainer)
  )
    return null;

  const startElement = elementOf(range.startContainer);
  const endElement = elementOf(range.endContainer);
  if (startElement?.closest(NON_PASSAGE) || endElement?.closest(NON_PASSAGE))
    return null;

  const sourceIds = new Set(
    Array.from(
      sourceText.matchAll(/(?:^|\n\n)(\d+):(\d+)\s/g),
      (match) => `${ref.bookId}.${Number(match[1])}.${Number(match[2])}`,
    ),
  );
  const selectedIds: string[] = [];
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_ALL);
  let chapter = ref.chapter;
  let previousVerse = 0;
  let markerId: string | null = null;
  let node = walker.nextNode();
  while (node) {
    const element = elementOf(node);
    if (!element?.closest(NON_PASSAGE)) {
      if (node instanceof Element && node.matches(".yv-v[v]")) {
        const value = node.getAttribute("v");
        const verse = value && /^\d+$/.test(value) ? Number(value) : 0;
        if (verse > 0 && verse <= 176) {
          if (verse < previousVerse) chapter += 1;
          previousVerse = verse;
          const id = `${ref.bookId}.${chapter}.${verse}`;
          markerId = sourceIds.has(id) ? id : null;
        } else markerId = null;
      }
      if (node.nodeType === Node.TEXT_NODE && range.intersectsNode(node)) {
        const text = node.textContent ?? "";
        const start = range.startContainer === node ? range.startOffset : 0;
        const end = range.endContainer === node ? range.endOffset : text.length;
        if (text.slice(start, end).trim()) {
          if (element?.closest(HEADING)) return null;
          if (!element?.closest(LABEL)) {
            const wrapper = element?.closest("[data-usfm], p[id]");
            const raw =
              wrapper?.getAttribute("data-usfm") ??
              (wrapper?.id && /^[1-3]?[A-Z]{2,3}\.\d+\.\d+$/.test(wrapper.id)
                ? wrapper.id
                : null);
            const ids = raw?.trim().split(/\s+/);
            const id = ids ? (ids.length === 1 ? ids[0] : null) : markerId;
            if (!id || !sourceIds.has(id)) return null;
            if (selectedIds.at(-1) !== id) selectedIds.push(id);
          }
        }
      }
    }
    node = walker.nextNode();
  }
  const first = selectedIds[0];
  const last = selectedIds.at(-1);
  if (!first || !last) return null;
  const [, firstChapter, firstVerse] = first.split(".");
  const [, lastChapter, lastVerse] = last.split(".");
  const from = Number(firstVerse),
    to = Number(lastVerse);
  if (firstChapter !== lastChapter || to < from || to - from >= 40) return null;
  // A missing verse must not be filled by assuming the display is contiguous.
  if (selectedIds.length !== to - from + 1) return null;
  const resolved = parseBibleReference(
    `${ref.book} ${firstChapter}:${from}${from === to ? "" : `-${to}`}`,
  );
  return resolved
    ? {
        referenceKey: resolved.passageId,
        startVerseId: first,
        endVerseId: last,
        versificationId: "web",
      }
    : null;
}

export function studyVerseElement(
  reference: string,
  body: HTMLElement,
  verseId: string,
): HTMLElement | null {
  const ref = parseBibleReference(reference);
  const match = /^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)$/.exec(verseId);
  if (!ref || !match || match[1] !== ref.bookId) return null;
  const identified = Array.from(
    body.querySelectorAll<HTMLElement>("[id], [data-usfm]"),
  ).find(
    (node) => node.id === verseId || node.getAttribute("data-usfm") === verseId,
  );
  if (identified) return identified;
  let chapter = ref.chapter,
    previous = 0;
  for (const marker of body.querySelectorAll<HTMLElement>(".yv-v[v]")) {
    const raw = marker.getAttribute("v") ?? "";
    if (!/^\d+$/.test(raw)) continue;
    const verse = Number(raw);
    if (verse < previous) chapter++;
    previous = verse;
    if (chapter === Number(match[2]) && verse === Number(match[3]))
      return marker.parentElement;
  }
  return null;
}
