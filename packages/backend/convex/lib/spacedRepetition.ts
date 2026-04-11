// Fibonacci-based spaced repetition intervals for loved articles
// Intervals grow: 3, 5, 8, 13, 21, 34, 55 days
// After exhausting the array, stay at 55 days
// Add ±15% jitter to avoid mechanical feeling

export const INTERVALS_DAYS = [3, 5, 8, 13, 21, 34, 55] as const;

/**
 * Calculate the next review timestamp for a loved article.
 * @param reviewIndex - How many times the article has been reviewed (0 = first review)
 * @param now - Current timestamp in ms
 * @param jitterSeed - Optional seed for deterministic jitter (0-1). Random if omitted.
 */
export function nextReviewAt(
  reviewIndex: number,
  now: number,
  jitterSeed?: number,
): number {
  const idx = Math.max(0, Math.min(reviewIndex, INTERVALS_DAYS.length - 1));
  const baseDays = INTERVALS_DAYS[idx];
  const seed = jitterSeed ?? Math.random();
  // Jitter: 85% to 115% of base interval
  const jitterMultiplier = 0.85 + seed * 0.3;
  const days = baseDays * jitterMultiplier;
  return now + Math.round(days * 24 * 60 * 60 * 1000);
}

/**
 * Calculate snooze timestamp (3 days from now, no jitter).
 */
export function snoozeReviewAt(now: number): number {
  return now + 3 * 24 * 60 * 60 * 1000;
}

/**
 * Check if an article is due for review.
 */
export function isDueForReview(nextReviewAt: number, now: number): boolean {
  return nextReviewAt <= now;
}
