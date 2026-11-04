"use client";
import { type RefObject, useEffect, useRef, useState } from "react";
import { getArticleBody } from "./paragraphs";

export function epubFragmentTarget(body: HTMLElement | null, hash: string) {
  if (!body || !hash.startsWith("#") || hash.length === 1) return null;
  let id: string;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    return null;
  }
  for (const candidate of [id, hash.slice(1)]) {
    const target = body.ownerDocument.getElementById(candidate);
    if (target instanceof HTMLElement && body.contains(target)) return target;
  }
  return null;
}

export function useEpubFragment(
  containerRef: RefObject<HTMLElement | null>,
  unitKey: string,
  enabled: boolean,
) {
  const [hash, setHash] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash,
  );
  const landed = useRef<string | null>(null);
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  useEffect(() => {
    if (!enabled || !hash) {
      landed.current = null;
      return;
    }
    const key = `${unitKey}:${hash}`;
    if (landed.current === key) return;
    const target = epubFragmentTarget(
      getArticleBody(containerRef.current),
      hash,
    );
    if (!target) return;
    target.scrollIntoView({ block: "start", behavior: "instant" });
    landed.current = key;
  });
  return enabled && hash.length > 1;
}
