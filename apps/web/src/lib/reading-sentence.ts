export type RoomPeriod = "month" | "30days" | "90days";

export const PERIODS: RoomPeriod[] = ["month", "30days", "90days"];

export const PERIOD_LABELS = {
  month: "This month",
  "30days": "Last 30 days",
  "90days": "Last 90 days",
} satisfies Record<RoomPeriod, string>;

/** What the opening sentence is written from. Slots are `weekday * 24 + hour`, Monday first. */
export type SentenceInput = {
  period: RoomPeriod;
  activeTimeMs: number;
  readingDays: number;
  /** Active minutes per slot */
  heat: number[];
  /** Reads per slot, by length */
  shortSlots: number[];
  longSlots: number[];
};

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** A pattern has to be this much of the total, and this many reads, to be worth a clause. */
const MIN_SHARE = 0.4;
const MIN_READS = 3;

type DayPart = "night" | "early" | "morning" | "afternoon" | "evening";
const PARTS = {
  night: { when: "late at night", noun: "nights" },
  early: { when: "before 9 a.m.", noun: "early mornings" },
  morning: { when: "in the morning", noun: "mornings" },
  afternoon: { when: "in the afternoon", noun: "afternoons" },
  evening: { when: "in the evening", noun: "evenings" },
} satisfies Record<DayPart, { when: string; noun: string }>;
const PART_NAMES: DayPart[] = [
  "night",
  "early",
  "morning",
  "afternoon",
  "evening",
];

function dayPart(hour: number): DayPart {
  if (hour >= 22 || hour < 5) return "night";
  if (hour < 9) return "early";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function periodSentenceStart(period: RoomPeriod) {
  return period === "month"
    ? "This month"
    : `In the last ${period === "30days" ? 30 : 90} days`;
}

function plural(n: number, one: string) {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

/** "6 hours", "1 hour 30 minutes", "45 minutes": rounded to the nearest half hour once past an hour. */
export function describeDuration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return plural(minutes, "minute");
  let hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 10) return plural(Math.round(minutes / 60), "hour");
  if (rest >= 45) hours += 1;
  else if (rest >= 15) return `${plural(hours, "hour")} 30 minutes`;
  return plural(hours, "hour");
}

/** The largest value's index and its share of the total. Ties go to the earlier index. */
function top(values: number[]) {
  const total = values.reduce((a, b) => a + b, 0);
  let best = 0;
  values.forEach((value, i) => {
    if (value > values[best]) best = i;
  });
  return { index: best, total, share: total ? values[best] / total : 0 };
}

function byPart(slots: number[]) {
  const totals = PART_NAMES.map(() => 0);
  slots.forEach((value, slot) => {
    totals[PART_NAMES.indexOf(dayPart(slot % 24))] += value;
  });
  return totals;
}

/** Where most of these fall, such as "on Saturday afternoons", or nothing if they're spread out. */
function whenMost(slots: number[], minTotal: number) {
  const total = slots.reduce((a, b) => a + b, 0);
  if (total < minTotal) return undefined;
  // One cell per weekday and part of day: index is `weekday * 5 + part`
  const cells = new Array<number>(7 * PART_NAMES.length).fill(0);
  slots.forEach((value, slot) => {
    cells[
      Math.floor(slot / 24) * PART_NAMES.length +
        PART_NAMES.indexOf(dayPart(slot % 24))
    ] += value;
  });
  const best = top(cells);
  if (best.share >= MIN_SHARE) {
    const weekday = Math.floor(best.index / PART_NAMES.length);
    const part = PART_NAMES[best.index % PART_NAMES.length];
    return `on ${WEEKDAYS[weekday]} ${PARTS[part].noun}`;
  }
  const topPart = top(byPart(slots));
  return topPart.share >= MIN_SHARE
    ? PARTS[PART_NAMES[topPart.index]].when
    : undefined;
}

/** One sentence about the period, from the numbers alone. */
export function readingSentence(input: SentenceInput) {
  const { period, activeTimeMs, readingDays } = input;
  if (activeTimeMs < 60_000 || readingDays < 1)
    return period === "month"
      ? "No reading yet this month."
      : `No reading yet in the last ${period === "30days" ? 30 : 90} days.`;

  const base = `${periodSentenceStart(period)} you read for ${describeDuration(activeTimeMs)} over ${plural(readingDays, "day")}`;
  const short = whenMost(input.shortSlots, MIN_READS);
  const long = whenMost(input.longSlots, MIN_READS);
  if (short && long)
    return `${base}, mostly short reads ${short} and long ones ${long}.`;
  if (short) return `${base}, mostly short reads ${short}.`;
  if (long) return `${base}, with long reads mostly ${long}.`;

  const minutes = whenMost(input.heat, 1);
  return minutes ? `${base}, mostly ${minutes}.` : `${base}.`;
}
