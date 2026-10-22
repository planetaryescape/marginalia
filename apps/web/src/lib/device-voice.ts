"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getArticleBody, getParagraphs, paragraphText } from "./paragraphs";

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

/** Reads the article aloud paragraph by paragraph with the Web Speech API: the device voice (D-TTS-013). */
export function useDeviceVoice(
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
