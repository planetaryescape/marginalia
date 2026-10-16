"use client";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

export const ALT_HOLD_MS = 400;

const AltHintContext = createContext(false);

/**
 * Listens for Alt (Option) held on its own once for the whole app, so every
 * keycap hint reveals on the same timing. Listeners are passive and never
 * prevent default, so Alt-based browser and OS shortcuts keep working; any
 * other key pressed with Alt cancels the hint.
 */
export function AltHintProvider({ children }: { children: ReactNode }) {
  const shown = useAltHintListener();
  return (
    <AltHintContext.Provider value={shown}>{children}</AltHintContext.Provider>
  );
}

/** True while the app-wide Alt hint is showing. */
export function useAltHint(): boolean {
  return useContext(AltHintContext);
}

function useAltHintListener(): boolean {
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
