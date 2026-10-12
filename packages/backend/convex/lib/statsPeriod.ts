export function localParts(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}
export function dayKey(at: number, timeZone: string) {
  const p = localParts(at, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
function localToUtc(local: number, timeZone: string) {
  let guess = local;
  for (let i = 0; i < 4; i++) {
    const p = localParts(guess, timeZone);
    const represented = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    guess += local - represented;
  }
  return guess;
}
export function statsPeriod(
  now: number,
  timeZone = "UTC",
  range: "week" | "7days" | "30days" = "week",
) {
  const p = localParts(now, timeZone); // Invalid zones fail rather than silently using server time.
  const today = Date.UTC(p.year, p.month - 1, p.day);
  const days =
    range === "30days"
      ? 30
      : range === "7days"
        ? 7
        : ((new Date(today).getUTCDay() + 6) % 7) + 1;
  const start = localToUtc(today - (days - 1) * 86_400_000, timeZone);
  const previousDays = range === "week" ? 7 : days;
  const previousStart = localToUtc(
    today - (days - 1 + previousDays) * 86_400_000,
    timeZone,
  );
  const localNow = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  const previousEnd = localToUtc(
    localNow - previousDays * 86_400_000,
    timeZone,
  );
  return {
    start,
    end: now + 1,
    previousStart,
    previousEnd,
    timeZone,
    range,
    days,
  };
}
