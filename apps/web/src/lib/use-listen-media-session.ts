"use client";
import { useEffect, useRef } from "react";
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
  /** The article's image, shown on the lock screen. */
  imageUrl?: string;
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

/** Lock screens fetch the artwork themselves, so only a web address is worth handing over. */
function artworkFor(imageUrl: string | undefined): MediaImage[] {
  if (!imageUrl) return [];
  try {
    const { protocol } = new URL(imageUrl);
    return protocol === "https:" || protocol === "http:"
      ? [{ src: imageUrl }]
      : [];
  } catch {
    return [];
  }
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
  const { title, author, url, imageUrl } = metadata ?? {};

  useEffect(() => {
    if (!active || title === undefined || !("mediaSession" in navigator))
      return;
    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({
      title,
      artist: author ?? hostname(url) ?? "",
      album: "Marginalia",
      artwork: artworkFor(imageUrl),
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
  }, [active, title, author, url, imageUrl]);

  useEffect(() => {
    if (!active || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState =
      status === "paused" || status === "failed" ? "paused" : "playing";
  }, [active, status]);
}
