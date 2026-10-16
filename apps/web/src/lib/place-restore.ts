/**
 * Where to scroll so the page sits at `percent` of the article body, the
 * inverse of `articleProgress` in reading-clock.ts. `bodyTop` is the body's
 * top edge in document coordinates. Null when the body fits on one screen.
 */
export function scrollTopForProgress(
  bodyTop: number,
  height: number,
  viewport: number,
  percent: number,
  header = 64,
): number | null {
  if (!Number.isFinite(height) || height <= 0) return null;
  const available = Math.max(1, viewport - header - 24);
  if (height <= available) return null;
  const p = Math.min(100, Math.max(0, percent));
  return Math.max(
    0,
    Math.round(bodyTop - header + (p / 100) * (height - available)),
  );
}

/** Below this the reader has barely begun; opening at the top is right. */
export const RESTORE_MIN_PERCENT = 3;

/**
 * Whether reopening should scroll to the saved place. A finished article, or a
 * link that names a passage, opens where it says.
 */
export function shouldRestorePlace(input: {
  percent: number | null | undefined;
  finished: boolean;
  hasTarget: boolean;
}): boolean {
  if (input.percent == null || input.finished || input.hasTarget) return false;
  return input.percent >= RESTORE_MIN_PERCENT;
}
