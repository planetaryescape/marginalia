import { z } from "zod";

const duration = z
  .number()
  .finite()
  .min(0)
  .max(26 * 60 * 60 * 1000);
export const readingCheckpointSchema = z
  .object({
    articleId: z.string().min(1).max(100),
    sessionId: z.string().min(1).max(100).optional(),
    visitId: z.string().uuid(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startedAt: z.number().finite().min(0),
    updatedAt: z.number().finite().min(0),
    activeTimeMs: duration,
    visibleTimeMs: duration,
    timeSpentMs: duration,
    maxScrollPercent: z.number().finite().min(0).max(100),
    annotationsOpened: z.array(z.string().min(1).max(100)).max(128),
    finished: z.boolean().optional(),
  })
  .refine(
    (s) =>
      s.activeTimeMs <= s.visibleTimeMs &&
      s.visibleTimeMs <= s.timeSpentMs &&
      s.timeSpentMs <= s.updatedAt - s.startedAt + 1000,
    "Invalid reading durations",
  );

export type ReadingCheckpoint = z.infer<typeof readingCheckpointSchema>;

// The last paragraph is in view; footers and rounding keep exact 100 unreliable
const END_PERCENT = 95;
// Enough reading time that a skim to the bottom doesn't archive the article
const READ_TIME_SHARE = 0.4;

/** Whether this much reading, across every visit, counts as having read the article. */
export function hasReadArticle(
  reading: { maxScrollPercent: number; activeTimeMs: number },
  estimatedReadMinutes: number,
) {
  return (
    reading.maxScrollPercent >= END_PERCENT &&
    reading.activeTimeMs >= estimatedReadMinutes * 60_000 * READ_TIME_SHARE
  );
}
