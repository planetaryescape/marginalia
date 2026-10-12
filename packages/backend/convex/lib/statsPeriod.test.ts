import { describe, expect, it } from "vitest";
import { dayKey, statsPeriod } from "./statsPeriod";

describe("reading report periods", () => {
  it("starts the week on Monday in the reader's timezone, not the server's", () => {
    const now = Date.parse("2026-10-12T00:30:00Z");
    const london = statsPeriod(now, "Europe/London");
    expect(new Date(london.start).toISOString()).toBe(
      "2026-10-11T23:00:00.000Z",
    );
    expect(london.days).toBe(1);
    const newYork = statsPeriod(now, "America/New_York");
    expect(dayKey(newYork.start, "America/New_York")).toBe("2026-10-05");
    expect(newYork.days).toBe(7);
  });
  it("respects DST instead of subtracting fixed 24-hour days for local boundaries", () => {
    const period = statsPeriod(
      Date.parse("2026-03-09T16:00:00Z"),
      "America/New_York",
      "7days",
    );
    expect(new Date(period.start).toISOString()).toBe(
      "2026-03-03T05:00:00.000Z",
    );
    expect(new Date(period.previousStart).toISOString()).toBe(
      "2026-02-24T05:00:00.000Z",
    );
    expect(new Date(period.previousEnd).toISOString()).toBe(
      "2026-03-02T17:00:00.000Z",
    );
  });
  it("compares a partial week with the same elapsed weekdays last week", () => {
    const period = statsPeriod(Date.parse("2026-10-14T12:00:00Z"), "UTC");
    expect(new Date(period.previousStart).toISOString()).toBe(
      "2026-10-05T00:00:00.000Z",
    );
    expect(new Date(period.previousEnd).toISOString()).toBe(
      "2026-10-07T12:00:00.000Z",
    );
  });
});
