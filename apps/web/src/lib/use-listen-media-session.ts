"use client";
import { type RefObject, useEffect, useRef } from "react";
import { getArticleBody } from "./paragraphs";
import type { ListenStatus } from "./use-natural-voice";

interface ListenControls {
  active: boolean;
  status: ListenStatus;
  togglePause: () => void;
  previous: () => void;
  next: () => void;
  stop: () => void;
}

interface ListenMetadata {
  title: string;
  author?: string | null;
  url?: string;
  /** The article's container, where an image the page already loaded is found for the lock screen. */
  container?: RefObject<HTMLElement | null>;
}

const ACTIONS = [
  "play",
  "pause",
  "stop",
  "previoustrack",
  "nexttrack",
  "seekbackward",
  "seekforward",
] as const satisfies readonly MediaSessionAction[];

/**
 * Artwork is an image the reader page has already loaded, so the lock screen
 * never makes a request the page didn't (extracted metadata can name any
 * host): the first image in the body that decoded and has a web address.
 */
function artworkFor(container: HTMLElement | null | undefined): MediaImage[] {
  const body = getArticleBody(container ?? null);
  for (const img of body?.querySelectorAll("img") ?? []) {
    if (!img.complete || img.naturalWidth === 0) continue;
    try {
      const { protocol } = new URL(img.currentSrc);
      if (protocol === "https:" || protocol === "http:")
        return [{ src: img.currentSrc }];
    } catch {
      // Not an address: try the next image
    }
  }
  return [];
}

function hostname(url: string | undefined) {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Hands Listen to the browser's media controls (05-player, Media Session), so
 * media keys and headphone buttons drive the player. Without handlers the
 * browser pauses the audio element behind the player's back, and the pill
 * keeps saying it is playing.
 */
export function useListenMediaSession(
  listen: ListenControls,
  metadata: ListenMetadata | undefined,
) {
  const controls = useRef(listen);
  controls.current = listen;
  const { active, status } = listen;
  const { title, author, url, container } = metadata ?? {};

  useEffect(() => {
    if (!active || title === undefined || !("mediaSession" in navigator))
      return;
    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({
      title,
      artist: author ?? hostname(url) ?? "",
      album: "Marginalia",
      artwork: artworkFor(container?.current),
    });
    const paused = () => controls.current.status === "paused";
    const handlers: Record<(typeof ACTIONS)[number], () => void> = {
      play: () => paused() && controls.current.togglePause(),
      pause: () => !paused() && controls.current.togglePause(),
      stop: () => controls.current.stop(),
      // A paragraph is Listen's unit, so seeking moves by paragraph too
      previoustrack: () => controls.current.previous(),
      nexttrack: () => controls.current.next(),
      seekbackward: () => controls.current.previous(),
      seekforward: () => controls.current.next(),
    };
    for (const action of ACTIONS) {
      try {
        session.setActionHandler(action, handlers[action]);
      } catch {
        // Browsers throw for actions they don't support; the rest still work
      }
    }
    // Cleared on stop, so the lock screen doesn't keep a dead player
    return () => {
      for (const action of ACTIONS) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // As above
        }
      }
      session.metadata = null;
      session.playbackState = "none";
    };
  }, [active, title, author, url, container]);

  useEffect(() => {
    if (!active || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState =
      status === "paused" || status === "failed" ? "paused" : "playing";
  }, [active, status]);
}
