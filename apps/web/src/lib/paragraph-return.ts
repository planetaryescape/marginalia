/**
 * The stack behind "Back to ¶N": where the reader was before each in-article jump.
 * Only jumps push; plain scrolling never does.
 */

export interface ReturnEntry {
  scrollY: number;
  /** Zero-based index of the paragraph at the top of the page when the jump started. */
  paragraph: number;
}

export const MAX_RETURN_ENTRIES = 5;

/**
 * Records where a jump started. A jump made while the reader is already within a
 * viewport of the newest entry adds nothing, so a run of map arrow presses leaves one
 * way back, not one per paragraph.
 */
export function pushReturn(
  stack: ReturnEntry[],
  entry: ReturnEntry,
  viewport: number,
): ReturnEntry[] {
  const top = stack[stack.length - 1];
  if (top && Math.abs(top.scrollY - entry.scrollY) <= viewport) return stack;
  return [...stack, entry].slice(-MAX_RETURN_ENTRIES);
}

/**
 * The reader has scrolled back to within a viewport of the newest entry themselves,
 * so that entry counts as returned. Returns the same array when nothing changes.
 */
export function returnedTo(
  stack: ReturnEntry[],
  scrollY: number,
  viewport: number,
): ReturnEntry[] {
  const top = stack[stack.length - 1];
  if (!top || Math.abs(top.scrollY - scrollY) > viewport) return stack;
  return stack.slice(0, -1);
}
