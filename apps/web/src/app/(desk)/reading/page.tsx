"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { DeskPage } from "@/components/desk-page";
import { formatReadingTime } from "@/lib/reading-stats";

export default function ReadingPage() {
  const [range, setRange] = useState<"week" | "7days" | "30days">("week");
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const data = useQuery(api.stats.getDashboard, { range, timeZone });
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <DeskPage
      title="Reading activity"
      action={
        <select
          aria-label="Statistics period"
          className="min-h-11 rounded-lg bg-[var(--reader-chip)] px-3 text-sm"
          value={range}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "week" || v === "7days" || v === "30days") setRange(v);
          }}
        >
          <option value="week">This week</option>
          <option value="7days">Last 7 days</option>
          <option value="30days">Last 30 days</option>
        </select>
      }
    >
      {!data ? (
        <div role="status" className="text-sm text-[var(--reader-muted)]">
          Loading your reading activity…
        </div>
      ) : (
        <>
          <p className="text-sm text-[var(--reader-muted)] mb-7">
            {new Intl.DateTimeFormat(undefined, {
              timeZone,
              month: "short",
              day: "numeric",
            }).format(data.period.start)}{" "}
            –{" "}
            {new Intl.DateTimeFormat(undefined, {
              timeZone,
              month: "short",
              day: "numeric",
            }).format(data.period.end - 1)}{" "}
            · {timeZone}
          </p>
          {data.partial && (
            <p role="status" className="mb-5 text-sm">
              This period exceeds the report limit. These are partial totals;
              choose a shorter period.
            </p>
          )}
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-7 border-b border-[var(--reader-border)] pb-8">
            {[
              {
                label: "Active reading",
                value: formatReadingTime(data.thisWeek.totalActiveTimeMs),
              },
              {
                label: "Articles finished",
                value: data.thisWeek.articlesFinished,
              },
              {
                label: "Articles opened",
                value: data.thisWeek.articlesStarted,
              },
              {
                label: "Reading days",
                value: `${data.thisWeek.readingDays} / ${data.period.days}`,
              },
            ].map((s) => (
              <div key={s.label}>
                <dt className="text-xs text-[var(--reader-muted)] mb-2">
                  {s.label}
                </dt>
                <dd className="font-serif text-3xl tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
          {(data.thisWeek.untrackedOpens > 0 ||
            data.thisWeek.legacyReadings > 0) && (
            <p className="mt-5 text-sm text-[var(--reader-muted)]">
              Some older visits weren't fully tracked. Their missing time cannot
              be recovered; it isn't included in active reading.
            </p>
          )}
          <section
            className="py-8 border-b border-[var(--reader-border)]"
            aria-label="Daily reading time"
          >
            <h2 className="font-serif text-2xl mb-2">Your reading rhythm</h2>
            <p className="text-sm text-[var(--reader-muted)] mb-5">
              Recorded active time each day, including unfinished articles.
            </p>
            <ol className="space-y-3">
              {data.daily.map((day) => (
                <li key={day.date} className="flex items-center gap-4 text-sm">
                  <span className="w-16 shrink-0 text-[var(--reader-muted)]">
                    {new Intl.DateTimeFormat(undefined, {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    }).format(new Date(`${day.date}T12:00:00Z`))}
                  </span>
                  <div
                    aria-hidden
                    className="flex-1 h-2 bg-[var(--reader-chip)] rounded-full overflow-hidden"
                  >
                    <div
                      className="h-full bg-[var(--reader-fg-soft)] rounded-full"
                      style={{
                        width: `${(day.activeTimeMs / Math.max(1, ...data.daily.map((d) => d.activeTimeMs))) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right tabular-nums">
                    {formatReadingTime(day.activeTimeMs)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section className="py-8 border-b border-[var(--reader-border)]">
            <h2 className="font-serif text-2xl mb-5">What you kept</h2>
            <dl className="grid grid-cols-3 gap-3">
              {[
                { label: "Notes", count: data.thisWeek.notesTaken },
                {
                  label: "Reflections",
                  count: data.thisWeek.reflectionsWritten,
                },
                {
                  label: "Annotations opened",
                  count: data.thisWeek.annotationsOpenedCount,
                },
              ].map((s) => (
                <div key={s.label}>
                  <dd className="font-serif text-2xl tabular-nums">
                    {s.count}
                  </dd>
                  <dt className="text-xs text-[var(--reader-muted)] mt-1">
                    {s.label}
                  </dt>
                </div>
              ))}
            </dl>
            {data.recentNotes.map((n) => (
              <Link
                key={`${n.articleId}:${n.createdAt}`}
                href={`/read/${n.articleId}`}
                className="block min-h-11 mt-5"
              >
                <p className="font-serif text-base line-clamp-2">
                  {n.contentPlain}
                </p>
                <p className="text-xs text-[var(--reader-muted)] mt-1">
                  {n.articleTitle}
                </p>
              </Link>
            ))}
          </section>
          <section className="py-8 border-b border-[var(--reader-border)]">
            <h2 className="font-serif text-2xl mb-5">
              Articles you spent time with
            </h2>
            {!data.articles.length && (
              <p className="text-sm text-[var(--reader-muted)]">
                No reading visits recorded for this period yet.{" "}
                <Link href="/" className="underline">
                  Find something to read.
                </Link>
              </p>
            )}
            {data.articles.map((a) => (
              <div
                key={a.articleId}
                className="border-b border-[var(--reader-border)] last:border-0"
              >
                <button
                  className="w-full min-h-16 py-4 flex items-start gap-4 text-left"
                  aria-expanded={expanded === a.articleId}
                  onClick={() =>
                    setExpanded(expanded === a.articleId ? null : a.articleId)
                  }
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-serif text-base leading-snug">
                      {a.title}
                    </span>
                    <span className="block text-xs text-[var(--reader-muted)] mt-1">
                      {a.finished ? "Finished" : "In progress"}
                      {a.author ? ` · ${a.author}` : ""}
                    </span>
                  </span>
                  <span className="text-sm shrink-0 tabular-nums">
                    {a.activeTimeMs
                      ? formatReadingTime(a.activeTimeMs)
                      : "Untracked"}
                  </span>
                </button>
                {expanded === a.articleId && (
                  <div className="pb-5 text-sm space-y-2">
                    <p>
                      Furthest reached:{" "}
                      {a.maxScrollPercent === null
                        ? "Not tracked"
                        : `${a.maxScrollPercent}% of the article`}
                    </p>
                    <p>
                      {a.annotationsOpened} distinct annotation opens ·{" "}
                      {a.notesCount} notes in this period
                    </p>
                    <Link
                      href={`/read/${a.articleId}`}
                      className="inline-flex items-center min-h-11 underline"
                    >
                      {a.finished ? "Read again" : "Continue reading"}
                    </Link>
                  </div>
                )}
              </div>
            ))}
            {data.articles.length === 25 && (
              <p className="text-xs text-[var(--reader-muted)] mt-3">
                Showing the 25 most recent articles; totals include the full
                reported period.
              </p>
            )}
          </section>
          <section className="py-8">
            <h2 className="font-serif text-2xl mb-2">
              Compared with the previous period
            </h2>
            <p className="text-sm text-[var(--reader-muted)] mb-5">
              {range === "week"
                ? "The same weekdays and elapsed time last week, not an entire week against a partial one."
                : "The same number of days immediately before this period."}
            </p>
            <table className="w-full text-sm">
              <caption className="sr-only">Reading comparison</caption>
              <thead>
                <tr className="text-[var(--reader-muted)]">
                  <th scope="col" className="text-left py-3 font-normal">
                    Metric
                  </th>
                  <th scope="col" className="text-right font-normal">
                    Current
                  </th>
                  <th scope="col" className="text-right font-normal">
                    Previous
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: "Active reading",
                    current: formatReadingTime(data.thisWeek.totalActiveTimeMs),
                    previous: formatReadingTime(
                      data.lastWeek.totalActiveTimeMs,
                    ),
                  },
                  {
                    label: "Articles finished",
                    current: data.thisWeek.articlesFinished,
                    previous: data.lastWeek.articlesFinished,
                  },
                  {
                    label: "Notes",
                    current: data.thisWeek.notesTaken,
                    previous: data.lastWeek.notesTaken,
                  },
                ].map((s) => (
                  <tr
                    key={s.label}
                    className="border-t border-[var(--reader-border)]"
                  >
                    <th scope="row" className="text-left font-normal py-3">
                      {s.label}
                    </th>
                    <td className="text-right tabular-nums">{s.current}</td>
                    <td className="text-right tabular-nums">{s.previous}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <details className="text-sm text-[var(--reader-muted)] pb-6">
            <summary className="min-h-11 cursor-pointer">
              How these statistics work
            </summary>
            <p className="leading-relaxed mt-2">
              Active reading is an estimate: time in a visible, focused article,
              pausing after 90 seconds without a scroll, touch or key press.
              Listening counts while the reader is visible. Background tabs and
              suspended timers don't count. Progress measures article text, not
              the entire page; reaching the end doesn't automatically mark an
              article finished. Annotation opens are unique within each period.
              Notes use their creation date, not their last edit. Time is
              checkpointed every 15 seconds and when you leave or background the
              reader; unsynced checkpoints retry when you reconnect. No
              reading-quality or comprehension score is inferred.
            </p>
          </details>
        </>
      )}
    </DeskPage>
  );
}
