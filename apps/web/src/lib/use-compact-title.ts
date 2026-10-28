"use client";
import { useEffect, useState } from "react";

/** Matches --motion-quick: the compact title's text leaves the bar once its fade has finished. */
export const COMPACT_TITLE_FADE_MS = 160;
/** The toolbar covers the top of the window, so a heading under it has scrolled away. Matches the 5rem scroll padding on html. */
const BAR_INSET_PX = 80;

/** True once the article heading has scrolled up under the toolbar or out of the window. */
export function useHeadingScrolledAway(heading: Element | null) {
  const [away, setAway] = useState(false);
  useEffect(() => {
    if (!heading || typeof IntersectionObserver === "undefined") {
      setAway(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setAway(!entry.isIntersecting),
      { rootMargin: `-${BAR_INSET_PX}px 0px 0px 0px` },
    );
    observer.observe(heading);
    return () => observer.disconnect();
  }, [heading]);
  return away;
}

/**
 * The text the toolbar's middle slot holds. It is empty while the heading is
 * on screen, so the title never shows twice, and it keeps its text for the
 * length of the fade when the heading comes back.
 */
export function useCompactTitle(title: string, away: boolean) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (away) {
      setText(title);
      return;
    }
    const timer = setTimeout(() => setText(""), COMPACT_TITLE_FADE_MS);
    return () => clearTimeout(timer);
  }, [away, title]);
  return text;
}
