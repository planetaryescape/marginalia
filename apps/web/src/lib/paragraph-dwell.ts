"use client";
import { UI_HOST_ATTRIBUTE } from "./paragraphs";

// The reader toolbar covers the top 64px; text under it is not in view
const HEADER_PX = 64;

/**
 * Reports which numbered paragraphs are on screen. Visibility changes arrive
 * from an IntersectionObserver, so nothing runs per scroll event. Numbers are
 * the `data-para` labels `useParagraphs` assigns, which skip our own UI hosts.
 */
export function observeParagraphsInView(
  body: HTMLElement,
  onChange: (inView: number[]) => void,
): () => void {
  // Server render and older test environments have no observer to attach
  if (typeof IntersectionObserver === "undefined") return () => {};
  const visible = new Set<number>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        // SAFETY: only `[data-para]` HTMLElements are ever observed below.
        const label = Number((entry.target as HTMLElement).dataset.para);
        if (!Number.isInteger(label)) continue;
        if (entry.isIntersecting) visible.add(label);
        else visible.delete(label);
      }
      onChange([...visible].sort((a, b) => a - b));
    },
    { rootMargin: `-${HEADER_PX}px 0px 0px 0px` },
  );
  for (const el of body.querySelectorAll<HTMLElement>("[data-para]"))
    if (!el.closest(`[${UI_HOST_ATTRIBUTE}]`)) observer.observe(el);
  return () => observer.disconnect();
}
