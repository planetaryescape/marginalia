"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDeviceVoice } from "./device-voice";
import {
  observeParagraphGeometry,
  paragraphGeometry,
} from "./paragraph-geometry";
import { getArticleBody } from "./paragraphs";
import { spokenTitle } from "./spoken-text";
import {
  type ClipSource,
  type ListenStatus,
  useNaturalVoice,
} from "./use-natural-voice";

export interface ReadingPosition {
  current: number | null;
  firstVisible: number | null;
  lastVisible: number | null;
}

/** Tracks which paragraph sits at the reading line (40% down the viewport) and marks it `data-current`. */
export function useReadingPosition(
  containerRef: React.RefObject<HTMLElement | null>,
  version: number,
): ReadingPosition {
  const [position, setPosition] = useState<ReadingPosition>({
    current: null,
    firstVisible: null,
    lastVisible: null,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` bumps whenever the article is re-tagged
  useEffect(() => {
    const body = getArticleBody(containerRef.current);
    if (!body) return;
    let marked: HTMLElement | null = null;

    const measure = () => {
      const geometry = paragraphGeometry(containerRef.current);
      if (!geometry) return;
      const paragraphs = geometry.elements;
      const line = window.innerHeight * 0.4;
      let current: number | null = null;
      let nearest = Number.POSITIVE_INFINITY;
      let firstVisible: number | null = null;
      let lastVisible: number | null = null;
      paragraphs.forEach((_el, i) => {
        const rect = geometry.rects[i];
        if (rect.bottom > 56 && rect.top < window.innerHeight) {
          firstVisible ??= i;
          lastVisible = i;
        }
        const distance =
          rect.top <= line && rect.bottom >= line
            ? 0
            : Math.min(Math.abs(rect.top - line), Math.abs(rect.bottom - line));
        if (distance < nearest) {
          nearest = distance;
          current = i;
        }
      });
      const next = current === null ? null : paragraphs[current];
      if (marked !== next) {
        marked?.removeAttribute("data-current");
        next?.setAttribute("data-current", "");
        marked = next;
      }
      setPosition((p) =>
        p.current === current &&
        p.firstVisible === firstVisible &&
        p.lastVisible === lastVisible
          ? p
          : { current, firstVisible, lastVisible },
      );
    };

    const stop = observeParagraphGeometry(containerRef.current, measure);
    return () => {
      stop();
      marked?.removeAttribute("data-current");
    };
  }, [containerRef, version]);

  return position;
}

// "Use the device voice" holds for the browser session, not for good (D-TTS-013)
const DEVICE_CHOICE_KEY = "marginalia.listenVoice";

function readDeviceChoice(): boolean {
  try {
    return window.sessionStorage.getItem(DEVICE_CHOICE_KEY) === "device";
  } catch {
    return false;
  }
}

function writeDeviceChoice() {
  try {
    window.sessionStorage.setItem(DEVICE_CHOICE_KEY, "device");
  } catch {
    // Without storage the choice just lasts until the page closes
  }
}

/**
 * Reads the article aloud. Natural voices (the reader's OpenRouter key, through
 * `clipSource`) are used when the key is saved; the device voice is a named
 * fallback the reader chooses, never one we switch to on failure (D-TTS-013).
 * Without a `clipSource` there is no natural voice to offer, so the device
 * voice stays as today.
 */
export function useListen(
  containerRef: React.RefObject<HTMLElement | null>,
  articleId?: string,
  unitKey?: string | null,
  content?: string,
  contentHtml?: string,
  clipSource?: ClipSource,
  heading?: { title: string; author?: string | null },
) {
  const capabilities = useQuery(api.providerCredentials.capabilities, {});
  const [deviceChosen, setDeviceChosen] = useState(readDeviceChoice);
  const [choosing, setChoosing] = useState(false);
  const pendingStart = useRef(0);
  const device = useDeviceVoice(
    containerRef,
    articleId,
    unitKey,
    content,
    contentHtml,
  );
  const natural = useNaturalVoice(
    containerRef,
    articleId,
    unitKey,
    content,
    contentHtml,
    clipSource,
    heading ? spokenTitle(heading.title, heading.author) : undefined,
  );

  const mode: "natural" | "device" =
    deviceChosen || !clipSource ? "device" : "natural";
  // While the capabilities load we try the natural voice; a missing key then
  // arrives as the server's own sentence in the failed state
  const missingKey =
    mode === "natural" &&
    capabilities?.providers.includes("openrouter") === false;
  const voice = mode === "device" ? device : natural;

  const { stop: stopVoice, speakFrom: speakVoice } = voice;
  const speakFrom = useCallback(
    (start: number) => {
      if (missingKey) {
        pendingStart.current = start;
        setChoosing(true);
        return;
      }
      setChoosing(false);
      speakVoice(start);
    },
    [missingKey, speakVoice],
  );
  const stop = useCallback(() => {
    setChoosing(false);
    stopVoice();
  }, [stopVoice]);

  const chooseDeviceVoice = useCallback(() => {
    writeDeviceChoice();
    setDeviceChosen(true);
    setChoosing(false);
    device.speakFrom(pendingStart.current);
  }, [device.speakFrom]);

  const deviceIndex = device.index;
  const deviceSpeakFrom = device.speakFrom;
  const previous = useCallback(() => {
    if (deviceIndex !== null) deviceSpeakFrom(Math.max(0, deviceIndex - 1));
  }, [deviceIndex, deviceSpeakFrom]);
  const next = useCallback(() => {
    if (deviceIndex !== null) deviceSpeakFrom(deviceIndex + 1);
  }, [deviceIndex, deviceSpeakFrom]);

  if (mode === "natural") {
    return {
      mode,
      supported: natural.supported,
      index: natural.index,
      paused: natural.paused,
      active: natural.active,
      status: natural.status,
      error: natural.error,
      needsKey: choosing && missingKey,
      deviceSupported: device.supported,
      speakFrom,
      togglePause: natural.togglePause,
      stop,
      previous: natural.previous,
      next: natural.next,
      retry: natural.retry,
      chooseDeviceVoice,
    };
  }
  const status: ListenStatus = !device.active
    ? "idle"
    : device.paused
      ? "paused"
      : "playing";
  return {
    mode,
    supported: device.supported,
    index: device.index,
    paused: device.paused,
    active: device.active,
    status,
    error: null,
    needsKey: false,
    deviceSupported: device.supported,
    speakFrom,
    togglePause: device.togglePause,
    stop,
    previous,
    next,
    retry: () => undefined,
    chooseDeviceVoice,
  };
}
