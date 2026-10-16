import { describe, expect, it } from "vitest";
import {
  bucketActiveMinutes,
  lengthClass,
  roomPeriod,
  skipsMostOf,
  slotter,
  splitReads,
  startOfLocalDay,
} from "./readingRoom";

// Saturday 10 October 2026, 23:30 UTC
const SAT_2330_UTC = Date.UTC(2026, 9, 10, 23, 30);
const slot = (weekday: number, hour: number) => weekday * 24 + hour;

describe("slotter", () => {
  it("reads the weekday and hour in the reader's zone, not UTC", () => {
    expect(slotter("UTC")(SAT_2330_UTC)).toBe(slot(5, 23));
    // 16:30 Saturday in Los Angeles (UTC-7 in October)
    expect(slotter("America/Los_Angeles")(SAT_2330_UTC)).toBe(slot(5, 16));
    // 12:30 Sunday in Auckland (UTC+13 in October): the day moves forward
    expect(slotter("Pacific/Auckland")(SAT_2330_UTC)).toBe(slot(6, 12));
  });

  it("puts midnight in hour 0 rather than 24", () => {
    expect(slotter("UTC")(Date.UTC(2026, 9, 12, 0, 5))).toBe(slot(0, 0));
  });
});

describe("bucketActiveMinutes", () => {
  it("adds active minutes to the local hour each visit started in", () => {
    const grid = bucketActiveMinutes(
      [
        { startedAt: SAT_2330_UTC, activeTimeMs: 10 * 60_000 },
        { startedAt: SAT_2330_UTC + 60_000, activeTimeMs: 5 * 60_000 },
        { startedAt: SAT_2330_UTC, activeTimeMs: 0 },
      ],
      "America/Los_Angeles",
    );
    expect(grid[slot(5, 16)]).toBe(15);
    expect(grid.reduce((a, b) => a + b, 0)).toBe(15);
    expect(grid).toHaveLength(168);
  });

  it("is empty for no visits", () => {
    expect(bucketActiveMinutes([], "UTC").every((m) => m === 0)).toBe(true);
  });
});

describe("splitReads", () => {
  const monday = Date.UTC(2026, 9, 12, 7, 0);
  it("sorts reads into short, middle and long, on weekdays and at weekends", () => {
    const split = splitReads(
      [
        { startedAt: monday, estimatedReadMinutes: 5 },
        { startedAt: monday, estimatedReadMinutes: 10 },
        { startedAt: monday, estimatedReadMinutes: 15 },
        { startedAt: SAT_2330_UTC, estimatedReadMinutes: 20 },
        { startedAt: SAT_2330_UTC, estimatedReadMinutes: 45 },
        { startedAt: SAT_2330_UTC, estimatedReadMinutes: 3 },
        { startedAt: monday, estimatedReadMinutes: undefined },
      ],
      "UTC",
    );
    expect(split.weekday).toEqual({ short: 2, middle: 1, long: 0 });
    expect(split.weekend).toEqual({ short: 1, middle: 0, long: 2 });
    expect(split.shortSlots[slot(0, 7)]).toBe(2);
    expect(split.longSlots[slot(5, 23)]).toBe(2);
  });

  it("counts the weekend in the reader's zone", () => {
    // Saturday 23:30 UTC is already Sunday in Auckland, still a weekend; and
    // Friday 20:00 UTC is Saturday morning in Auckland
    const friday = Date.UTC(2026, 9, 9, 20, 0);
    const read = [{ startedAt: friday, estimatedReadMinutes: 5 }];
    expect(splitReads(read, "UTC").weekday.short).toBe(1);
    expect(splitReads(read, "Pacific/Auckland").weekend.short).toBe(1);
  });

  it("puts the 10 and 20 minute edges in short and long", () => {
    expect(lengthClass(10)).toBe("short");
    expect(lengthClass(10.5)).toBe("middle");
    expect(lengthClass(19)).toBe("middle");
    expect(lengthClass(20)).toBe("long");
  });
});

describe("skipsMostOf", () => {
  it("needs a meaningful sample and an open rate under 10%", () => {
    expect(skipsMostOf(15, 1)).toBe(true);
    expect(skipsMostOf(60, 5)).toBe(true);
    expect(skipsMostOf(15, 2)).toBe(false); // 13%
    expect(skipsMostOf(20, 2)).toBe(false); // exactly 10%
    expect(skipsMostOf(14, 0)).toBe(false); // too few offers to say
    expect(skipsMostOf(0, 0)).toBe(false);
  });
});

describe("roomPeriod", () => {
  it("starts the month at local midnight of its first day", () => {
    const p = roomPeriod(
      Date.UTC(2026, 9, 16, 12, 0),
      "Pacific/Auckland",
      "month",
    );
    // 16 Oct 12:00 UTC is 17 Oct 01:00 in Auckland; the month began 1 Oct 00:00 NZDT
    expect(p.start).toBe(Date.UTC(2026, 8, 30, 11, 0));
    expect(p.days).toBe(17);
  });

  it("counts back whole local days for rolling periods", () => {
    const p = roomPeriod(Date.UTC(2026, 9, 16, 12, 0), "UTC", "30days");
    expect(p.start).toBe(Date.UTC(2026, 8, 17));
    expect(p.days).toBe(30);
  });
});

describe("startOfLocalDay", () => {
  it("steps past a midnight that doesn't exist", () => {
    // Santiago skips 00:00 to 01:00 on 6 September 2026 (UTC-4 becomes UTC-3)
    const p = roomPeriod(
      Date.UTC(2026, 9, 5, 16, 0),
      "America/Santiago",
      "30days",
    );
    expect(p.start).toBe(Date.UTC(2026, 8, 6, 4, 0));
  });

  it("still returns local midnight where it exists", () => {
    expect(startOfLocalDay(Date.UTC(2026, 8, 6), "UTC")).toBe(
      Date.UTC(2026, 8, 6),
    );
    expect(startOfLocalDay(Date.UTC(2026, 8, 6), "America/Los_Angeles")).toBe(
      Date.UTC(2026, 8, 6, 7),
    );
  });
});
