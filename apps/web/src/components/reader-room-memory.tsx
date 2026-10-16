"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  canReach,
  isReaderPath,
  recordRoom,
  rememberScroll,
  savedScroll,
} from "@/lib/reader-return";

/** How long to wait for a room's data before giving up on its scroll position. */
const RESTORE_MS = 1500;
/** Input that means the reader has taken over scrolling, so a restore stops. */
const USER_SCROLL_EVENTS = [
  "wheel",
  "touchstart",
  "keydown",
  "mousedown",
] as const;

/**
 * Remembers each room's scroll position while it is shown, and restores it when
 * the reader comes back from an article. Only a return from a reader path
 * restores; a plain click into a room starts at the top.
 */
export function ReaderRoomMemory() {
  const pathname = usePathname();
  const room = useRef<string | null>(null);
  const previous = useRef<string | null>(null);
  const restoring = useRef<(() => void) | null>(null);
  // Next's own scroll-to-top, and the restore's jump, both arrive as scroll events. Saves
  // wait until the restore has settled, so the room keeps the position it was left at.
  const holdSaves = useRef(false);

  useEffect(() => {
    const cameFromReader =
      previous.current !== null && isReaderPath(previous.current);
    previous.current = pathname;
    restoring.current?.();
    restoring.current = null;
    if (isReaderPath(pathname)) return;
    recordRoom(pathname);
    room.current = pathname;
    const target = cameFromReader ? savedScroll(pathname) : undefined;
    if (target === undefined) return;

    const deadline = performance.now() + RESTORE_MS;
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      for (const type of USER_SCROLL_EVENTS)
        window.removeEventListener(type, stop);
      restoring.current = null;
      // Two frames lets the restore's own scroll event land before saves resume
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          holdSaves.current = false;
        }),
      );
    };
    holdSaves.current = true;
    for (const type of USER_SCROLL_EVENTS)
      window.addEventListener(type, stop, { passive: true });
    restoring.current = stop;
    const step = () => {
      const viewport = window.innerHeight;
      const height = document.documentElement.scrollHeight;
      if (canReach(target, height, viewport) || performance.now() > deadline) {
        window.scrollTo({
          top: Math.min(target, Math.max(0, height - viewport)),
          behavior: "instant",
        });
        stop();
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }, [pathname]);

  useEffect(() => {
    const onScroll = () => {
      const current = room.current;
      // Ignore the reader's own pages and the jump a restore is making.
      if (
        !current ||
        isReaderPath(window.location.pathname) ||
        restoring.current ||
        holdSaves.current
      )
        return;
      rememberScroll(current, window.scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return null;
}
