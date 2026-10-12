import { describe, expect, it } from "vitest";
import { articleProgress, ReadingClock } from "./reading-clock";

const start = new Date(2026, 9, 12, 12).getTime();
describe("recorded reading time", () => {
  it("pauses at the idle boundary and resumes only with activity", () => {
    const clock = new ReadingClock(start, 0, true);
    for (let tick = 1000; tick <= 100000; tick += 1000)
      clock.tick(start + tick, tick);
    expect(clock.snapshots(start + 100000, 100000)[0]).toMatchObject({
      activeTimeMs: 90000,
      visibleTimeMs: 100000,
      timeSpentMs: 100000,
    });
    clock.activity(start + 100000, 100000);
    expect(clock.snapshots(start + 101000, 101000)[0].activeTimeMs).toBe(91000);
  });
  it("doesn't count hidden tabs or suspended timers as reading", () => {
    const clock = new ReadingClock(start, 0, true);
    clock.visibility(false, start + 1000, 1000);
    clock.tick(start + 60000, 60000);
    clock.visibility(true, start + 60000, 60000);
    clock.tick(start + 120000, 120000);
    expect(clock.snapshots(start + 120000, 120000)[0]).toMatchObject({
      activeTimeMs: 1000,
      visibleTimeMs: 1000,
      timeSpentMs: 120000,
    });
  });
  it("counts visible listening after the idle timeout, not background listening", () => {
    const clock = new ReadingClock(start, 0, true);
    clock.speech(true, start, 0);
    for (let tick = 1000; tick <= 100000; tick += 1000)
      clock.tick(start + tick, tick);
    clock.visibility(false, start + 100000, 100000);
    expect(clock.snapshots(start + 101000, 101000)[0].activeTimeMs).toBe(
      100000,
    );
  });
  it("splits a reading visit at local midnight without losing or duplicating time", () => {
    const midnight = new Date(2026, 9, 13).getTime();
    const clock = new ReadingClock(midnight - 500, 0, true);
    const samples = clock.snapshots(midnight + 500, 1000);
    expect(samples).toHaveLength(2);
    expect(samples.map((s) => s.activeTimeMs)).toEqual([500, 500]);
    expect(samples.map((s) => s.day)).toEqual(["2026-10-12", "2026-10-13"]);
  });
  it("keeps annotation opens unique and progress bounded for short articles", () => {
    const clock = new ReadingClock(start, 0, true);
    clock.annotation("one");
    clock.annotation("one");
    clock.progress(80);
    clock.progress(20);
    expect(clock.snapshots(start, 0)[0]).toMatchObject({
      annotationsOpened: ["one"],
      maxScrollPercent: 80,
    });
    expect(articleProgress(64, 400, 800)).toBe(100);
    expect(articleProgress(64, 0, 800)).toBe(0);
    expect(articleProgress(-10000, 2000, 800)).toBe(100);
    expect(articleProgress(400, 2000, 800)).toBe(0);
  });
});
