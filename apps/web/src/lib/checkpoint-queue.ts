import {
  furthestParagraph,
  mergeDwell,
  type ReadingCheckpoint,
  readingCheckpointSchema,
} from "@marginalia/backend/reading-activity";

export function parseCheckpoints(raw: string | null): ReadingCheckpoint[] {
  const value: unknown = JSON.parse(raw ?? "[]");
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const parsed = readingCheckpointSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
}
const sameVisitDay = (a: ReadingCheckpoint, b: ReadingCheckpoint) =>
  a.visitId === b.visitId && a.day === b.day;

export function mergeCheckpoint(
  queue: ReadingCheckpoint[],
  snapshot: ReadingCheckpoint,
) {
  const old = queue.find((entry) => sameVisitDay(entry, snapshot));
  const merged = old
    ? {
        ...old,
        updatedAt: Math.max(old.updatedAt, snapshot.updatedAt),
        activeTimeMs: Math.max(old.activeTimeMs, snapshot.activeTimeMs),
        visibleTimeMs: Math.max(old.visibleTimeMs, snapshot.visibleTimeMs),
        timeSpentMs: Math.max(old.timeSpentMs, snapshot.timeSpentMs),
        maxScrollPercent: Math.max(
          old.maxScrollPercent,
          snapshot.maxScrollPercent,
        ),
        paragraphIndex: furthestParagraph(old, snapshot),
        annotationsOpened: [
          ...new Set([...old.annotationsOpened, ...snapshot.annotationsOpened]),
        ].slice(0, 128),
        finished: old.finished || snapshot.finished,
        dwell: mergeDwell(old.dwell, snapshot.dwell),
      }
    : snapshot;
  return [
    ...queue.filter((entry) => !sameVisitDay(entry, snapshot)),
    merged,
  ].slice(-64);
}
const dwellAhead = (
  entry: Record<string, number> | undefined,
  sent: Record<string, number> | undefined,
) => Object.entries(entry ?? {}).some(([key, ms]) => ms > (sent?.[key] ?? 0));

export function acknowledgeCheckpoint(
  queue: ReadingCheckpoint[],
  sent: ReadingCheckpoint,
) {
  return queue.filter(
    (entry) =>
      !sameVisitDay(entry, sent) ||
      entry.updatedAt > sent.updatedAt ||
      entry.activeTimeMs > sent.activeTimeMs ||
      entry.visibleTimeMs > sent.visibleTimeMs ||
      entry.timeSpentMs > sent.timeSpentMs ||
      entry.maxScrollPercent > sent.maxScrollPercent ||
      entry.annotationsOpened.some(
        (id) => !sent.annotationsOpened.includes(id),
      ) ||
      dwellAhead(entry.dwell, sent.dwell) ||
      (entry.finished && !sent.finished),
  );
}
