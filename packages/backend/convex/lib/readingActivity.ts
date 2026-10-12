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
