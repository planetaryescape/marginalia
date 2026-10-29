"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createFollower } from "./listen-follow";
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
  speed = 1,
) {
  const [state, setState] = useState<{
    index: number | null;
    paused: boolean;
    following: boolean;
  }>({ index: null, paused: false, following: true });
  const session = useRef(0);
  // An utterance's rate can't change once it is speaking, so a new speed
  // reaches the voice from the next paragraph
  const rate = useRef(speed);
  rate.current = speed;
  const shown = useRef<HTMLElement | undefined>(undefined);
  const follower = useRef<ReturnType<typeof createFollower>>(null);
  follower.current ??= createFollower(() =>
    setState((s) => ({ ...s, following: follower.current?.following ?? true })),
  );
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
    follower.current?.stop();
    shown.current = undefined;
    setState({ index: null, paused: false, following: true });
  }, [supported, clearMark]);

  const speakFrom = useCallback(
    (start: number) => {
      if (!supported) return;
      const paragraphs = getParagraphs(getArticleBody(containerRef.current));
      const token = ++session.current;
      window.speechSynthesis.cancel();
      const voice = pickVoice();
      // A skip within a listen keeps the reader's choice to follow or not
      if (!follower.current?.active) follower.current?.start();

      const speak = (i: number) => {
        if (token !== session.current) return;
        const el = paragraphs[i];
        if (!el) {
          stop();
          return;
        }
        clearMark();
        el.setAttribute("data-speaking", "");
        shown.current = el;
        follower.current?.reveal(el);
        setState({
          index: i,
          paused: false,
          following: follower.current?.following ?? true,
        });
        const utterance = new SpeechSynthesisUtterance(paragraphText(el));
        if (voice) utterance.voice = voice;
        utterance.rate = rate.current;
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

  const follow = useCallback(() => follower.current?.follow(shown.current), []);

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
    following: state.following,
    follow,
    speakFrom,
    togglePause,
    stop,
  };
}
