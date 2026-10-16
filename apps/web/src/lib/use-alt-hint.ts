"use client";
import { useEffect, useState } from "react";

export const ALT_HOLD_MS = 400;

/**
 * True while Alt (Option) has been held on its own for 400 ms. Listeners are
 * passive and never prevent default, so Alt-based browser and OS shortcuts
 * keep working; any other key pressed with Alt cancels the hint.
 */
export function useAltHint(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const clear = () => {
      window.clearTimeout(timer);
      timer = undefined;
      setShown(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Alt") return clear();
      if (event.repeat || timer !== undefined) return;
      timer = window.setTimeout(() => setShown(true), ALT_HOLD_MS);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") clear();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clear);
      window.clearTimeout(timer);
    };
  }, []);
  return shown;
}
