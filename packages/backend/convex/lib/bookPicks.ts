// A book is offered by its next unit, never by one that merely fits (D-DES-055).

export interface BookProgress {
  /** The last unit read to its end, or -1 */
  finishedThrough: number;
  /** The furthest unit the reader has got into, or -1 */
  furthestUnit: number;
}

export interface OutlineUnit {
  title: string;
  minutes: number;
  chapter?: string;
}

/**
 * The unit after the last one read. A unit counts as read when it was finished
 * or the reader has since moved into a later one, so opening part 12 and
 * leaving makes part 12 the next one, and part 13 is never offered over it.
 */
export function nextUnitIndex(progress: BookProgress): number {
  return Math.max(progress.finishedThrough, progress.furthestUnit - 1) + 1;
}

export interface BookCandidate {
  unitIndex: number;
  title: string;
  minutes: number;
  /** Units in the book, for "Part 12 of 58" */
  of: number;
}

/**
 * The one unit a book can offer for a window, or null when the book is read to
 * the end or its next unit is longer than the window. Nothing later is ever
 * offered in its place.
 */
export function bookCandidate(
  progress: BookProgress,
  outline: readonly OutlineUnit[],
  windowMinutes: number,
): BookCandidate | null {
  const unitIndex = nextUnitIndex(progress);
  const unit = outline[unitIndex];
  if (!unit || unit.minutes > windowMinutes) return null;
  return {
    unitIndex,
    title: unit.title,
    minutes: unit.minutes,
    of: outline.length,
  };
}

/** A unit counts as read to its end past this share of its length. */
export const UNIT_DONE_PERCENT = 90;
/** Scrolling less than this is a glance, not reading it. */
export const UNIT_STARTED_PERCENT = 5;

/** Folds one reading position into the book's progress; it only moves forward. */
export function advanceProgress(
  progress: BookProgress & { furthestScroll: number },
  at: { unitIndex: number; scrollPercent: number },
): BookProgress & { furthestScroll: number } {
  const next = { ...progress };
  if (at.scrollPercent >= UNIT_DONE_PERCENT)
    next.finishedThrough = Math.max(next.finishedThrough, at.unitIndex);
  if (at.scrollPercent >= UNIT_STARTED_PERCENT) {
    if (at.unitIndex > next.furthestUnit) {
      next.furthestUnit = at.unitIndex;
      next.furthestScroll = at.scrollPercent;
    } else if (at.unitIndex === next.furthestUnit) {
      next.furthestScroll = Math.max(next.furthestScroll, at.scrollPercent);
    }
  }
  return next;
}

/** The pencil line under a book's pick. */
export function bookReason(progress: BookProgress, unitIndex: number): string {
  if (
    progress.finishedThrough >= 0 &&
    unitIndex === progress.finishedThrough + 1
  )
    return `You finished part ${progress.finishedThrough + 1}. This picks up where you left off.`;
  if (progress.furthestUnit >= 0)
    return `You started part ${unitIndex + 1}. This picks up where you left off.`;
  return "The first part of a book you brought.";
}
