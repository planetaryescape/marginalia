"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Scrolled this far into the article before the toolbar may fade. */
export const FADE_AFTER_PX = 120;
/** A pointer this close to the top of the window brings the toolbar back. */
export const REVEAL_ZONE_PX = 64;
/** Phones keep their top bar; only wide screens fade it. */
export const WIDE_QUERY = "(min-width: 1024px)";

/** Hidden once past FADE_AFTER_PX while scrolling down; shown again on any scroll up. */
export function nextScrollHidden(hidden: boolean, y: number, lastY: number) {
  if (y < FADE_AFTER_PX) return false;
  if (y > lastY) return true;
  if (y < lastY) return false;
  return hidden;
}

/**
 * Fades the reader toolbar while the reader is moving down the text.
 * `pinned` holds it open (a menu, popover or the notes pane belongs to it).
 */
export function useToolbarFade(pinned: boolean) {
  const [wide, setWide] = useState(false);
  const [scrollHidden, setScrollHidden] = useState(false);
  const [pointerNear, setPointerNear] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!wide) {
      setScrollHidden(false);
      setPointerNear(false);
      return;
    }
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      // Captured now: the updater below runs later, after lastY has moved on
      const previous = lastY.current;
      setScrollHidden((hidden) => nextScrollHidden(hidden, y, previous));
      lastY.current = y;
    };
    const onPointerMove = (event: PointerEvent) =>
      setPointerNear(event.clientY < REVEAL_ZONE_PX);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("pointermove", onPointerMove);
    };
  }, [wide]);

  const onFocus = useCallback((event: React.FocusEvent<HTMLElement>) => {
    // Only keyboard focus reveals it; a mouse click leaves focus on a button
    // that would otherwise pin the toolbar open for the rest of the read.
    let keyboard = true;
    try {
      keyboard = event.target.matches(":focus-visible");
    } catch {}
    if (keyboard) setFocusWithin(true);
  }, []);
  const onBlur = useCallback((event: React.FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
      setFocusWithin(false);
  }, []);

  const hidden =
    wide && scrollHidden && !pointerNear && !focusWithin && !pinned;
  return { hidden, focusProps: { onFocus, onBlur } };
}
