"use client";

import { useEffect, useState } from "react";

/** VisualViewport handles iOS keyboards, which do not resize the layout viewport. */
export function PwaRuntime() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const viewport = window.visualViewport;
    const measure = () => {
      // Pinch zoom must not be mistaken for an on-screen keyboard.
      if (viewport && viewport.scale !== 1) return;
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      const root = document.documentElement;
      root.style.setProperty("--app-viewport-height", `${height}px`);
      root.style.setProperty("--app-viewport-top", `${top}px`);
      root.style.setProperty(
        "--app-keyboard-inset",
        `${Math.max(0, window.innerHeight - height - top)}px`,
      );
    };
    measure();
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      // Failure doesn't block reading or falsely report that offline support is ready.
      void navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .catch(() => {});
    }
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);
  return offline ? (
    <div
      role="status"
      className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4rem)] z-[60] mx-auto max-w-lg rounded-lg bg-[var(--reader-surface)] p-3 font-sans text-sm text-[var(--reader-fg)] ring-1 ring-[var(--reader-border-strong)] shadow-lg"
    >
      Offline. Keep unsaved notes open until you reconnect and they say Saved.
    </div>
  ) : null;
}
