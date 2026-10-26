"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import type { ReaderSettings } from "@/lib/reader-settings";
import { type MarginMode, marginModeFor, measureGutter } from "./margin-mode";

/**
 * Which margin the reader is showing. Re-measured on resize, when the notes
 * pane docks or undocks, and whenever `layoutKey` changes (text settings,
 * article HTML), so notes never read a stale gutter.
 */
export function useMarginMode(
  containerRef: React.RefObject<HTMLElement | null>,
  ready: boolean,
  layoutKey: ReaderSettings,
): MarginMode {
  const [mode, setMode] = useState<MarginMode>("sheet");

  // biome-ignore lint/correctness/useExhaustiveDependencies: `layoutKey` asks for a re-measure
  useLayoutEffect(() => {
    const article = containerRef.current;
    if (!ready || !article) return;
    let frame = 0;
    const measure = () =>
      setMode(marginModeFor(window.innerWidth, measureGutter(article)));
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", schedule);
    // The notes pane docks by setting an attribute on <html>.
    const attributes = new MutationObserver(schedule);
    attributes.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-notes-open"],
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(article);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      attributes.disconnect();
      resize.disconnect();
    };
  }, [containerRef, ready, layoutKey]);

  return mode;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
