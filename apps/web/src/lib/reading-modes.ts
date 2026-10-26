"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  observeParagraphGeometry,
  paragraphGeometry,
} from "./paragraph-geometry";
import { getArticleBody, getParagraphs, paragraphText } from "./paragraphs";

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

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const lang = document.documentElement.lang || "en";
  const matching = voices.filter((v) =>
    v.lang.toLowerCase().startsWith(lang.slice(0, 2)),
  );
  const pool = matching.length ? matching : voices;
  return (
    pool.find((v) => /natural|premium|enhanced/i.test(v.name)) ??
    pool.find((v) => /google|samantha|daniel/i.test(v.name)) ??
    pool.find((v) => v.default) ??
    pool[0] ??
    null
  );
}

/** Reads the article aloud paragraph by paragraph with the Web Speech API. */
export function useListen(
  containerRef: React.RefObject<HTMLElement | null>,
  articleId?: string,
  unitKey?: string | null,
  content?: string,
  contentHtml?: string,
) {
  const [state, setState] = useState<{ index: number | null; paused: boolean }>(
    {
      index: null,
      paused: false,
    },
  );
  const session = useRef(0);
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const clearMark = useCallback(() => {
    for (const el of document.querySelectorAll("[data-speaking]"))
      el.removeAttribute("data-speaking");
  }, []);

  const stop = useCallback(() => {
    session.current += 1;
    if (supported) window.speechSynthesis.cancel();
    clearMark();
    setState({ index: null, paused: false });
  }, [supported, clearMark]);

  const speakFrom = useCallback(
    (start: number) => {
      if (!supported) return;
      const paragraphs = getParagraphs(getArticleBody(containerRef.current));
      const token = ++session.current;
      window.speechSynthesis.cancel();
      const voice = pickVoice();

      const speak = (i: number) => {
        if (token !== session.current) return;
        const el = paragraphs[i];
        if (!el) {
          stop();
          return;
        }
        clearMark();
        el.setAttribute("data-speaking", "");
        const rect = el.getBoundingClientRect();
        if (rect.top < 80 || rect.bottom > window.innerHeight - 80) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        setState({ index: i, paused: false });
        const utterance = new SpeechSynthesisUtterance(paragraphText(el));
        if (voice) utterance.voice = voice;
        utterance.onend = () => speak(i + 1);
        utterance.onerror = (e) => {
          if (e.error !== "interrupted" && e.error !== "canceled") speak(i + 1);
        };
        window.speechSynthesis.speak(utterance);
      };
      speak(Math.max(0, start));
    },
    [supported, containerRef, stop, clearMark],
  );

  const togglePause = useCallback(() => {
    if (!supported) return;
    setState((s) => {
      if (s.paused) window.speechSynthesis.resume();
      else window.speechSynthesis.pause();
      return { ...s, paused: !s.paused };
    });
  }, [supported]);

  // Prose identity, not paragraph geometry or arriving annotations, ends speech.
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity changes invalidate the captured paragraph array
  useEffect(() => {
    stop();
    return stop;
  }, [stop, articleId, unitKey, content, contentHtml]);

  return {
    supported,
    index: state.index,
    paused: state.paused,
    active: state.index !== null,
    speakFrom,
    togglePause,
    stop,
  };
}
