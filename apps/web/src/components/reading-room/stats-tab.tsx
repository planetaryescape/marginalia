"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useState } from "react";
import {
  PERIOD_LABELS,
  PERIODS,
  type RoomPeriod,
  readingSentence,
} from "@/lib/reading-sentence";
import { ShortAndLong } from "./short-and-long";
import { TopicMap } from "./topic-map";
import { WhenYouRead } from "./when-you-read";
import { YourSources } from "./your-sources";

/** A mirror of how the reader reads: one sentence, then the pictures. No goals or streaks. */
export function StatsTab() {
  const [period, setPeriod] = useState<RoomPeriod>("month");
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const room = useQuery(api.stats.readingRoom, { timeZone, period });
  const topics = useQuery(api.stats.readingTopics, { timeZone, period });

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        {room ? (
          <p className="max-w-[860px] font-serif text-[clamp(1.5rem,3vw,2.125rem)] font-light leading-snug">
            {readingSentence({
              period,
              activeTimeMs: room.activeTimeMs,
              readingDays: room.readingDays,
              heat: room.heat,
              shortSlots: room.shortSlots,
              longSlots: room.longSlots,
            })}
          </p>
        ) : (
          <p role="status" className="text-sm text-[var(--reader-muted)]">
            Loading your reading…
          </p>
        )}
        <label className="relative shrink-0 text-sm text-[var(--reader-muted)]">
          <span className="sr-only">Period</span>
          <select
            className="min-h-11 cursor-pointer appearance-none bg-transparent py-2 pr-5 text-sm text-[var(--reader-muted)] hover:text-[var(--reader-fg)]"
            value={period}
            onChange={(e) => {
              const next = PERIODS.find((p) => p === e.target.value);
              if (next) setPeriod(next);
            }}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
          <span
            aria-hidden
            className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2"
          >
            ▾
          </span>
        </label>
      </div>

      {room && (
        <div className="grid gap-x-14 gap-y-10 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <WhenYouRead heat={room.heat} timeZone={timeZone} />
            <ShortAndLong weekday={room.weekday} weekend={room.weekend} />
          </div>
          <div className="space-y-9">
            {topics && <TopicMap topics={topics} />}
            <YourSources feeds={room.feeds} />
          </div>
        </div>
      )}

      {room && (room.partial || room.readsPartial) && (
        <p role="status" className="mt-8 text-xs text-[var(--reader-muted)]">
          {room.partial
            ? "This period has more visits than the room reads, so it shows the most recent ones. Choose a shorter period for every visit."
            : "Short against long counts your most recent reads only."}
        </p>
      )}
    </div>
  );
}
