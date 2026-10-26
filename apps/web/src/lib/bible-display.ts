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
  return verses.flatMap((match, sourceParagraph) => {
    const verseId = `${ref.bookId}.${match[2]}.${match[3]}`;
    const span = Array.from(doc.querySelectorAll("[data-usfm]")).find(
      (element) =>
        element.getAttribute("data-usfm")?.split(/\s+/).includes(verseId),
    );
    const text = span?.textContent?.replace(/\s+/g, " ").trim();
    if (!span || !text) return [];
    const prefix = doc.createRange();
    prefix.selectNodeContents(doc.body);
    prefix.setEndBefore(span);
    const displayStart = prefix.toString().length;
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
