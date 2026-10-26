import { parseBibleReference } from "@marginalia/backend/bible";

/** Match study notes by verse identity, never by pretending two translations quote alike. */
export function bibleDisplayAnchors(
  reference: string,
  studyText: string,
  displayHtml: string,
) {
  const ref = parseBibleReference(reference);
  if (!ref || typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(displayHtml, "text/html");
  const verses = Array.from(
    studyText.matchAll(/(^|\n\n)(\d+):(\d+)\s([\s\S]*?)(?=\n\n\d+:\d+\s|$)/g),
  );
  const verseMarkers = Array.from(
    doc.querySelectorAll<HTMLElement>(".yv-v[v]"),
  );
  const markerOffsets = new Map<HTMLElement, number>();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ALL);
  let displayOffset = 0;
  let node = walker.nextNode();
  while (node) {
    if (node instanceof HTMLElement && node.matches(".yv-v[v]"))
      markerOffsets.set(node, displayOffset);
    if (node.nodeType === Node.TEXT_NODE)
      displayOffset += node.textContent?.length ?? 0;
    node = walker.nextNode();
  }
  let markerChapter = ref.chapter;
  let previousMarkerVerse = 0;
  const markerByVerseId = new Map<string, HTMLElement>();
  for (const marker of verseMarkers) {
    const rawVerse = marker.getAttribute("v");
    if (!rawVerse || !/^\d+$/.test(rawVerse)) continue;
    const verse = Number(rawVerse);
    if (!Number.isInteger(verse) || verse < 1 || verse > 176) continue;
    if (verse === previousMarkerVerse) continue;
    if (verse < previousMarkerVerse) markerChapter++;
    previousMarkerVerse = verse;
    markerByVerseId.set(`${ref.bookId}.${markerChapter}.${verse}`, marker);
  }
  return verses.flatMap((match, sourceParagraph) => {
    const verseId = `${ref.bookId}.${match[2]}.${match[3]}`;
    const span = Array.from(doc.querySelectorAll("[data-usfm]")).find(
      (element) =>
        element.getAttribute("data-usfm")?.split(/\s+/).includes(verseId),
    );
    const marker = markerByVerseId.get(verseId);
    if (!span && !marker) return [];
    let displayStart: number;
    let text: string;
    if (span) {
      const range = doc.createRange();
      range.selectNodeContents(span);
      text = range.toString();
      const prefix = doc.createRange();
      prefix.selectNodeContents(doc.body);
      prefix.setEndBefore(span);
      displayStart = prefix.toString().length;
    } else if (marker) {
      const markerStart = markerOffsets.get(marker);
      if (markerStart === undefined) return [];
      displayStart = markerStart + (marker.textContent?.length ?? 0);
      const nextMarker = verseMarkers[verseMarkers.indexOf(marker) + 1];
      const end = nextMarker ? markerOffsets.get(nextMarker) : displayOffset;
      if (end === undefined) return [];
      text = doc.body.textContent?.slice(displayStart, end) ?? "";
    } else {
      return [];
    }
    if (!text) return [];
    return [
      {
        start: match.index + match[1].length,
        end: match.index + match[0].length,
        text,
        verseId,
        sourceParagraph,
        displayStart,
      },
    ];
  });
}

export function mapBibleAnnotations<
  T extends {
    anchorText: string;
    anchorStartOffset?: number;
    anchorEndOffset?: number;
  },
>(
  annotations: T[],
  studyText: string,
  anchors: ReturnType<typeof bibleDisplayAnchors>,
): Array<
  Omit<T, "anchorText" | "anchorStartOffset" | "anchorEndOffset"> & {
    anchorText: string;
    anchorStartOffset: number;
    anchorEndOffset: number;
  }
> {
  return annotations.flatMap((annotation) => {
    const {
      anchorText,
      anchorStartOffset,
      anchorEndOffset: _sourceEnd,
      ...metadata
    } = annotation;
    const offset = anchorStartOffset ?? studyText.indexOf(anchorText);
    if (!Number.isInteger(offset) || offset < 0) return [];
    const verse = anchors.find((v) => offset >= v.start && offset < v.end);
    return verse
      ? [
          {
            ...metadata,
            anchorText: verse.text,
            anchorStartOffset: verse.displayStart,
            anchorEndOffset: verse.displayStart + verse.text.length,
          },
        ]
      : [];
  });
}

export function bibleVerseAtRange(reference: string, range: Range) {
  const ref = parseBibleReference(reference);
  if (!ref) return null;
  const element =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const verse =
    element
      ?.closest("[data-usfm]")
      ?.getAttribute("data-usfm")
      ?.split(/\s+/)[0] ?? element?.closest("p[id]")?.id;
  const match = verse && /^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)$/.exec(verse);
  if (!match || match[1] !== ref.bookId) return null;
  return `${ref.book} ${Number(match[2])}:${Number(match[3])}`;
}
