export const MIN_SPEED = 0.8;
export const MAX_SPEED = 2;
export const SPEED_STEP = 0.05;
/** What the pill's speed button steps through, in order, then back to the first (02-design-concept). */
export const SPEED_PRESETS = [1, 1.2, 1.5, 1.75, 2, 0.8] as const;

const SPEED_KEY = "marginalia.listenSpeed";

/** Snaps to the 0.05 grid inside 0.8–2; anything that isn't a number reads as 1. */
export function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const snapped = Math.round(value / SPEED_STEP) * SPEED_STEP;
  return (
    Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, snapped)) * 100) / 100
  );
}

/** The preset after `speed`; a speed between presets goes to the next one up, else back to 1×. */
export function nextSpeed(speed: number): number {
  const at = SPEED_PRESETS.findIndex((preset) => preset === speed);
  if (at !== -1) return SPEED_PRESETS[(at + 1) % SPEED_PRESETS.length];
  return SPEED_PRESETS.find((preset) => preset > speed) ?? SPEED_PRESETS[0];
}

/** "1×", "1.2×", "1.75×". */
export function formatSpeed(speed: number): string {
  return `${Number(speed.toFixed(2))}×`;
}

export function readSpeed(): number {
  try {
    const stored = window.localStorage.getItem(SPEED_KEY);
    return stored === null ? 1 : clampSpeed(Number(stored));
  } catch {
    return 1;
  }
}

export function writeSpeed(speed: number) {
  try {
    window.localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    // Without storage the speed lasts until the page closes
  }
}
