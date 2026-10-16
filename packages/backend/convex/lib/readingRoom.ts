import { localParts, localToUtc } from "./statsPeriod";

export type RoomPeriod = "month" | "30days" | "90days";

/** A visit shorter than this in total for an article is an accidental open, not a read. */
export const MIN_READ_MS = 30_000;
/** Reads of this many minutes or fewer are short, and of this many or more are long. */
export const SHORT_READ_MINUTES = 10;
export const LONG_READ_MINUTES = 20;
/** A feed needs this many offers before its open rate says anything. */
export const SKIP_HINT_MIN_OFFERED = 15;
export const SKIP_HINT_MAX_OPEN_RATE = 0.1;

/** Hours of the week, Monday first: index is `weekday * 24 + hour`. */
export const SLOTS = 7 * 24;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Local midnight of the period's first day to `now`, in the reader's time zone. */
export function roomPeriod(now: number, timeZone: string, period: RoomPeriod) {
  const p = localParts(now, timeZone); // Invalid zones throw rather than using the server's
  const today = Date.UTC(p.year, p.month - 1, p.day);
  const days = period === "month" ? p.day : period === "30days" ? 30 : 90;
  const start = localToUtc(today - (days - 1) * 86_400_000, timeZone);
  return { start, end: now + 1, timeZone, period, days };
}

/**
 * Slot (weekday and local hour) of an instant. The formatter is built once:
 * constructing one per row would dominate a few thousand rows.
 */
export function slotter(timeZone: string) {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  });
  return (at: number) => {
    const parts = format.formatToParts(at);
    const weekday = WEEKDAYS.indexOf(
      parts.find((p) => p.type === "weekday")?.value ?? "",
    );
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    return weekday * 24 + hour;
  };
}

/** Active minutes per slot, by the local hour each visit started in. */
export function bucketActiveMinutes(
  rows: { startedAt: number; activeTimeMs: number }[],
  timeZone: string,
) {
  const slot = slotter(timeZone);
  const minutes = new Array<number>(SLOTS).fill(0);
  for (const row of rows) {
    if (!(row.activeTimeMs > 0)) continue;
    minutes[slot(row.startedAt)] += row.activeTimeMs / 60_000;
  }
  return minutes.map((m) => Math.round(m * 10) / 10);
}

export type LengthClass = "short" | "middle" | "long";
export function lengthClass(minutes: number): LengthClass {
  if (minutes <= SHORT_READ_MINUTES) return "short";
  return minutes >= LONG_READ_MINUTES ? "long" : "middle";
}

type Split = { short: number; middle: number; long: number };

/**
 * How many reads were short, in between or long, on weekdays and at
 * weekends, and the slots the short and the long ones started in.
 */
export function splitReads(
  reads: { startedAt: number; estimatedReadMinutes: number | undefined }[],
  timeZone: string,
) {
  const slot = slotter(timeZone);
  const empty = (): Split => ({ short: 0, middle: 0, long: 0 });
  const weekday = empty();
  const weekend = empty();
  const shortSlots = new Array<number>(SLOTS).fill(0);
  const longSlots = new Array<number>(SLOTS).fill(0);
  for (const read of reads) {
    // An article without a length can't be placed
    if (
      read.estimatedReadMinutes === undefined ||
      !(read.estimatedReadMinutes > 0)
    )
      continue;
    const at = slot(read.startedAt);
    const kind = lengthClass(read.estimatedReadMinutes);
    (Math.floor(at / 24) >= 5 ? weekend : weekday)[kind]++;
    if (kind === "short") shortSlots[at]++;
    if (kind === "long") longSlots[at]++;
  }
  return { weekday, weekend, shortSlots, longSlots };
}

/** Whether a feed offered plenty and was almost never opened. Only ever a suggestion. */
export function skipsMostOf(offered: number, opened: number) {
  return (
    offered >= SKIP_HINT_MIN_OFFERED &&
    opened / offered < SKIP_HINT_MAX_OPEN_RATE
  );
}
