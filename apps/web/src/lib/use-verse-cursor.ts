"use client";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type DisplayedVerse,
  displayedVerses,
  verseAtOrAfter,
} from "./bible-verses";
import { getArticleBody } from "./paragraphs";

const HIGHLIGHT = "verse-cursor";

/** Keeps the verse's first line clear of the fixed bar, as scroll-padding-top does for anchors. */
const TOP_CLEARANCE = 96;

/**
 * The j/k cursor for a Bible reading: one verse at a time. A verse can cross
 * blocks, so the cursor is a text range painted with the CSS Custom Highlight
 * API. Nothing in the article DOM is wrapped or marked. The cursor is held by
 * verse identity and its ranges are rebuilt on demand, because annotation
 * decoration splits and replaces text nodes under any Range kept across a render.
 */
export function useVerseCursor({
  articleRef,
  reference,
  enabled,
  version,
}: {
  articleRef: RefObject<HTMLElement | null>;
  reference: string | undefined;
  enabled: boolean;
  /** Changes when the article's prose is re-tagged, which can replace its text nodes. */
  version: number;
}) {
  const [key, setKey] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const set = useCallback((next: string | null) => {
    keyRef.current = next;
    setKey(next);
    if (next === null) setAnnouncement("");
  }, []);

  const verses = useCallback((): DisplayedVerse[] => {
    const body = getArticleBody(articleRef.current);
    return enabled && reference && body ? displayedVerses(reference, body) : [];
  }, [articleRef, reference, enabled]);

  const current = useCallback(
    () => verses().find((verse) => verse.key === keyRef.current) ?? null,
    [verses],
  );

  const move = useCallback(
    (direction: 1 | -1, fromBlock: Node | null): boolean => {
      const list = verses();
      if (!list.length) return false;
      const at = list.findIndex((verse) => verse.key === keyRef.current);
      const next =
        at < 0
          ? fromBlock
            ? verseAtOrAfter(list, fromBlock)
            : firstOnScreen(list)
          : Math.max(0, Math.min(list.length - 1, at + direction));
      const verse = list[next];
      window.getSelection()?.removeAllRanges();
      set(verse.key);
      setAnnouncement(
        `${verse.label}. ${verse.segments.map((s) => s.toString()).join(" ")}`,
      );
      scrollToStart(verse);
      return true;
    },
    [verses, set],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: repaint after the prose is re-tagged
  useEffect(() => {
    if (key === null || typeof CSS === "undefined" || !("highlights" in CSS))
      return;
    const verse = current();
    if (!verse) return;
    CSS.highlights.set(HIGHLIGHT, new Highlight(...verse.segments));
    return () => {
      CSS.highlights.delete(HIGHLIGHT);
    };
  }, [key, version, current]);

  // A different reading starts without a cursor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on the reading, not on every render
  useEffect(() => {
    set(null);
  }, [reference, enabled, set]);

  // Pointing at the text means the reader has moved on from the keyboard cursor.
  useEffect(() => {
    const article = articleRef.current;
    if (key === null || !article) return;
    const onPointerDown = () => set(null);
    article.addEventListener("pointerdown", onPointerDown);
    return () => article.removeEventListener("pointerdown", onPointerDown);
  }, [key, articleRef, set]);

  return {
    active: key !== null,
    key,
    announcement,
    move,
    clear: () => set(null),
    /** A fresh range over the cursor verse, or null with no cursor. */
    range: (): Range | null => current()?.range.cloneRange() ?? null,
    /** The element holding the verse's first word. */
    startElement: (): Element | null => {
      const container = current()?.range.startContainer;
      return container instanceof Element
        ? container
        : (container?.parentElement ?? null);
    },
  };
}

function scrollToStart(verse: DisplayedVerse) {
  const start = verse.range.cloneRange();
  start.collapse(true);
  const text = start.startContainer;
  if (text.nodeType === Node.TEXT_NODE) {
    // A collapsed range has no box in some engines, so measure its first character.
    start.setEnd(
      text,
      Math.min(start.startOffset + 1, text.textContent?.length ?? 0),
    );
  }
  const rect = start.getBoundingClientRect();
  const top = Math.max(window.innerHeight / 2 - rect.height / 2, TOP_CLEARANCE);
  window.scrollBy({ top: rect.top - top, behavior: "instant" });
}

/**
 * Where a first j or k lands when the display has no numbered paragraphs to
 * measure from (verse markup is often divs): the first verse not yet scrolled
 * past, or the last one when the reader is beyond them all.
 */
function firstOnScreen(verses: DisplayedVerse[]): number {
  const at = verses.findIndex(
    ({ range }) => range.getBoundingClientRect().bottom > 0,
  );
  return at < 0 ? verses.length - 1 : at;
}
