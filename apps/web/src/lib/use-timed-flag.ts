"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** "Saved" fades in over 160 ms, holds 1.6 s and fades out over 160 ms (the rung 7 comp). */
export const SAVED_MS = 160 + 1600 + 160;
/** A changed row's surface wash lasts this long. */
export const WASH_MS = 600;

/**
 * A flag that turns on and clears itself after `ms`. Raising it again restarts
 * the clock, and unmounting clears the timer.
 */
export function useTimedFlag(ms: number) {
  const [on, setOn] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const raise = useCallback(() => {
    window.clearTimeout(timer.current);
    setOn(true);
    timer.current = window.setTimeout(() => setOn(false), ms);
  }, [ms]);
  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    setOn(false);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [on, raise, clear] as const;
}

/**
 * True for 600 ms after `value` changes. The first render never washes: a
 * value that was already there is not news.
 */
export function useChangeWash(value: unknown) {
  const [washing, raise, clear] = useTimedFlag(WASH_MS);
  const seen = useRef(value);
  useEffect(() => {
    if (Object.is(seen.current, value)) return;
    seen.current = value;
    raise();
  }, [value, raise]);
  return [washing, clear] as const;
}
