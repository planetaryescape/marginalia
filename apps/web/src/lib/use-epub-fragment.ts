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
  const [location, setLocation] = useState(() => ({
    unitKey,
    hash: typeof window === "undefined" ? "" : window.location.hash,
  }));
  const [resolution, setResolution] = useState<{
    location: typeof location;
    status: "resolved" | "missing";
  } | null>(null);
  const landed = useRef<typeof location | null>(null);
  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash;
      setLocation((current) =>
        current.unitKey === unitKey && current.hash === hash
          ? current
          : { unitKey, hash },
      );
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [unitKey]);
  useEffect(() => {
    if (!enabled || !location.hash) {
      landed.current = null;
      return;
    }
    if (location.unitKey !== unitKey) return;
    if (landed.current === location) return;
    const body = getArticleBody(containerRef.current);
    if (!body?.hasChildNodes()) return;
    const target = epubFragmentTarget(body, location.hash);
    if (target) {
      target.scrollIntoView({ block: "start", behavior: "instant" });
      landed.current = location;
    } else landed.current = null;
    const status = target ? "resolved" : "missing";
    if (resolution?.location !== location || resolution.status !== status)
      setResolution({ location, status });
  });
  if (!enabled) return "none";
  if (location.unitKey !== unitKey) return "pending";
  if (location.hash.length <= 1) return "none";
  return resolution?.location === location ? resolution.status : "pending";
}
