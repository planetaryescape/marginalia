// Frozen CPU oracle from b2adecda stats.ts (legacyReadings/metrics/daily).
// Deliberately retains the old rescans; do not optimize alongside the query.
import type { Doc } from "../convex/_generated/dataModel";
import { dayKey, type statsPeriod } from "../convex/lib/statsPeriod";

const finite = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;

export function legacyReportingOracle(
  activity: Doc<"readingActivity">[],
  interactions: Doc<"articleInteractions">[],
  notes: Doc<"userNotes">[],
  reflections: Doc<"reflections">[],
  period: ReturnType<typeof statsPeriod>,
) {
  const sessions = new Map<string, Doc<"articleInteractions">>();
  for (const event of interactions) {
    if (
      !["finished", "abandoned"].includes(event.action) ||
      (event.activeTimeMs === undefined && event.timeSpentMs === undefined)
    )
      continue;
    const key = event.sessionId
      ? `${event.articleId}:${event.sessionId}`
      : event._id;
    const old = sessions.get(key);
    if (!old) {
      sessions.set(key, event);
      continue;
    }
    const latest = old.createdAt > event.createdAt ? old : event;
    sessions.set(key, {
      ...latest,
      activeTimeMs: Math.max(
        finite(old.activeTimeMs),
        finite(event.activeTimeMs),
      ),
      maxScrollPercent: Math.max(
        finite(old.maxScrollPercent),
        finite(event.maxScrollPercent),
      ),
    });
  }
  const legacySessions = [...sessions.values()];
  const within = (at: number, start: number, end: number) =>
    at >= start && at < end;
  function metrics(start: number, end: number) {
    const measured = activity.filter((s) => within(s.startedAt, start, end));
    const events = interactions.filter((s) => within(s.createdAt, start, end));
    const legacy = legacySessions.filter((s) =>
      within(s.createdAt, start, end),
    );
    const finishes = new Set(
      events.filter((s) => s.action === "finished").map((s) => s.articleId),
    );
    const started = new Set([
      ...measured.filter((s) => s.activeTimeMs > 0).map((s) => s.articleId),
      ...events.filter((s) => s.action === "opened").map((s) => s.articleId),
      ...legacy.map((s) => s.articleId),
    ]);
    const annotationIds = new Set([
      ...measured.flatMap((s) => s.annotationsOpened),
      ...events.flatMap((s) => s.annotationsOpened ?? []),
    ]);
    const totalActiveTimeMs =
      measured.reduce((n, s) => n + s.activeTimeMs, 0) +
      legacy.reduce((n, s) => n + finite(s.activeTimeMs), 0);
    const visibleTimeMs = measured.reduce((n, s) => n + s.visibleTimeMs, 0);
    const measuredActiveTimeMs = measured.reduce(
      (n, s) => n + s.activeTimeMs,
      0,
    );
    const scrolls = measured
      .map((s) => s.maxScrollPercent)
      .concat(
        legacy.flatMap((s) =>
          s.maxScrollPercent === undefined
            ? []
            : [Math.min(100, finite(s.maxScrollPercent))],
        ),
      );
    const days = new Set(
      measured
        .filter((s) => s.activeTimeMs > 0)
        .map((s) => dayKey(s.startedAt, period.timeZone)),
    );
    for (const s of legacy)
      if (finite(s.activeTimeMs) > 0)
        days.add(dayKey(s.createdAt, period.timeZone));
    const periodNotes = notes.filter(
      (n) => within(n.createdAt, start, end) && n.contentPlain.trim(),
    );
    return {
      articlesFinished: finishes.size,
      articlesStarted: started.size,
      totalActiveTimeMs,
      visibleTimeMs,
      totalWallTimeMs: measured.reduce((n, s) => n + s.timeSpentMs, 0),
      avgScrollDepth: scrolls.length
        ? Math.round(scrolls.reduce((a, b) => a + b, 0) / scrolls.length)
        : null,
      annotationsOpenedCount: annotationIds.size,
      focusRatio: visibleTimeMs
        ? Math.round((measuredActiveTimeMs / visibleTimeMs) * 100)
        : null,
      notesTaken: periodNotes.length,
      reflectionsWritten:
        periodNotes.filter((n) => n.annotationId).length +
        reflections.filter(
          (r) =>
            within(r.respondedAt ?? 0, start, end) && r.userResponse?.trim(),
        ).length,
      readingDays: days.size,
      visitsCount: new Set(
        measured.filter((s) => s.activeTimeMs > 0).map((s) => s.visitId),
      ).size,
      skippedCount: events.filter((s) => s.action === "skipped").length,
      untrackedOpens: events.filter(
        (s) =>
          s.action === "opened" &&
          (!s.visitId || !measured.some((m) => m.visitId === s.visitId)),
      ).length,
      legacyReadings: legacy.length,
    };
  }
  const weekActivity = activity.filter((s) => s.startedAt >= period.start);
  const daily = [];
  const todayKey = dayKey(period.end - 1, period.timeZone);
  const firstKey = dayKey(period.start, period.timeZone);
  for (
    let at = Date.parse(`${firstKey}T12:00:00Z`);
    at <= Date.parse(`${todayKey}T12:00:00Z`);
    at += 86_400_000
  ) {
    const date = new Date(at).toISOString().slice(0, 10);
    daily.push({
      date,
      activeTimeMs:
        weekActivity
          .filter((s) => dayKey(s.startedAt, period.timeZone) === date)
          .reduce((n, s) => n + s.activeTimeMs, 0) +
        legacySessions
          .filter(
            (s) =>
              s.createdAt >= period.start &&
              dayKey(s.createdAt, period.timeZone) === date,
          )
          .reduce((n, s) => n + finite(s.activeTimeMs), 0),
    });
  }
  return {
    thisWeek: metrics(period.start, period.end),
    lastWeek: metrics(period.previousStart, period.previousEnd),
    daily,
  };
}
