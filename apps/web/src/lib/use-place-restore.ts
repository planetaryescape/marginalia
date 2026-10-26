"use client";
import { type RefObject, useEffect, useRef } from "react";
import { getArticleBody, getParagraphs } from "@/lib/paragraphs";
import {
  scrollTopForParagraph,
  scrollTopForProgress,
} from "@/lib/place-restore";

/**
 * Scrolls to the saved place once per article, after its text is laid out.
 * `percent` is null while there is nothing to restore (finished, a targeted
 * link, nothing recorded) and `version` bumps when the text is re-tagged.
 * The paragraph, when one was recorded and still exists, is the exact place;
 * rows saved before paragraphs were kept restore by `percent`.
 */
export function usePlaceRestore(
  containerRef: RefObject<HTMLElement | null>,
  key: string,
  percent: number | null,
  paragraphIndex: number | undefined,
  version: number,
) {
  const restored = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` signals the article was re-tagged
  useEffect(() => {
    if (percent === null || restored.current === key) return;
    const body = getArticleBody(containerRef.current);
    if (!body) return;
    // A reader who has already scrolled keeps their place
    if (window.scrollY > 64) {
      restored.current = key;
      return;
    }
    const rect = body.getBoundingClientRect();
    // Data loads after first paint; an unlaid-out body would clamp the scroll
    if (rect.height < window.innerHeight) return;
    const tagged = getParagraphs(containerRef.current);
    // Paragraphs are numbered a frame after the text appears; falling back to
    // the percent before then would settle on it for good. The re-tag bumps
    // `version` and runs this again.
    if (paragraphIndex !== undefined && tagged.length === 0) return;
    const paragraph =
      paragraphIndex === undefined ? undefined : tagged[paragraphIndex];
    if (paragraph) {
      restored.current = key;
      window.scrollTo({
        top: scrollTopForParagraph(
          paragraph.getBoundingClientRect().top + window.scrollY,
        ),
        behavior: "instant",
      });
      return;
    }
    const y = scrollTopForProgress(
      rect.top + window.scrollY,
      rect.height,
      window.innerHeight,
      percent,
    );
    restored.current = key;
    if (y !== null) window.scrollTo({ top: y, behavior: "instant" });
  }, [containerRef, key, percent, paragraphIndex, version]);
}
