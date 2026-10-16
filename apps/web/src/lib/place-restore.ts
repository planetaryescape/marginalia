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

/** Clearance under the fixed header when a paragraph is placed at the top of the view. */
const PARAGRAPH_HEADER = 64;

/**
 * Index of the paragraph at the top of the reader's view: the first whose
 * bottom edge is below the header. Null when there are none.
 */
export function paragraphAtViewTop(
  bottoms: readonly number[],
  header = PARAGRAPH_HEADER,
): number | null {
  if (!bottoms.length) return null;
  const i = bottoms.findIndex((bottom) => bottom > header);
  // Past the last paragraph (footer in view): the reader is at the end
  return i < 0 ? bottoms.length - 1 : i;
}

/**
 * Where to scroll so the paragraph whose top is `paragraphTop` (document
 * coordinates) sits at the top of the view, the inverse of `paragraphAtViewTop`.
 */
export function scrollTopForParagraph(
  paragraphTop: number,
  header = PARAGRAPH_HEADER,
): number {
  return Math.max(0, Math.round(paragraphTop - header));
}
