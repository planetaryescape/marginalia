/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { readerTest, secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
// Wednesday 14 October 2026, 18:00 UTC
const NOW = Date.UTC(2026, 9, 14, 18, 0);
afterEach(() => vi.useRealTimers());

async function seed(t: Awaited<ReturnType<typeof secondReaderTest>>["t"]) {
  return t.run(async (ctx) => {
    const feedId = await ctx.db.insert("feeds", {
      userId: OWNER,
      url: "https://owner.example/feed",
      title: "Owner feed",
      isActive: true,
      createdAt: 1,
    });
    const quietFeed = await ctx.db.insert("feeds", {
      userId: OWNER,
      url: "https://owner.example/quiet",
      title: "Quiet feed",
      isActive: true,
      createdAt: 1,
    });
    const article = (guid: string, minutes: number) =>
      ctx.db.insert("articles", {
        userId: OWNER,
        guid,
        url: `https://example.com/${guid}`,
        title: guid,
        estimatedReadMinutes: minutes,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
    const short = await article("short", 5);
    const long = await article("long", 30);
    const visit = (
      articleId: typeof short,
      visitId: string,
      startedAt: number,
      activeTimeMs: number,
      userId = OWNER,
    ) =>
      ctx.db.insert("readingActivity", {
        userId,
        visitId,
        day: new Date(startedAt).toISOString().slice(0, 10),
        articleId,
        startedAt,
        updatedAt: startedAt,
        activeTimeMs,
        visibleTimeMs: activeTimeMs,
        timeSpentMs: activeTimeMs,
        maxScrollPercent: 50,
        annotationsOpened: [],
      });
    // Tuesday 07:15 UTC, five minutes
    await visit(short, "v1", Date.UTC(2026, 9, 13, 7, 15), 5 * 60_000);
    // Saturday 10 October 15:00 UTC, twenty minutes
    await visit(long, "v2", Date.UTC(2026, 9, 10, 15, 0), 20 * 60_000);
    // Before the month began
    await visit(long, "v3", Date.UTC(2026, 8, 20, 15, 0), 20 * 60_000);
    // Under the accidental-open threshold
    await visit(short, "v4", Date.UTC(2026, 9, 12, 9, 0), 5_000);
    await ctx.db.insert("feedStats", {
      userId: OWNER,
      feedId,
      offered: 40,
      opened: 2,
      finished: 1,
      skipped: 30,
      updatedAt: 1,
    });
    await ctx.db.insert("feedStats", {
      userId: OWNER,
      feedId: quietFeed,
      offered: 9,
      opened: 0,
      finished: 0,
      skipped: 9,
      updatedAt: 1,
    });
    return { short, long };
  });
}

describe("readingRoom", () => {
  it("aggregates the period's visits by local hour and read length", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { t, owner } = await secondReaderTest(modules);
    await seed(t);
    const room = await owner.query(api.stats.readingRoom, {
      timeZone: "UTC",
      period: "month",
    });
    expect(room.partial).toBe(false);
    // The September visit is outside "this month"; the 5 second one is a visit but not a read
    expect(room.activeTimeMs).toBe(25 * 60_000 + 5_000);
    expect(room.readingDays).toBe(3);
    expect(room.heat[1 * 24 + 7]).toBe(5);
    expect(room.heat[5 * 24 + 15]).toBe(20);
    expect(room.weekday).toEqual({ short: 1, middle: 0, long: 0 });
    expect(room.weekend).toEqual({ short: 0, middle: 0, long: 1 });
    expect(room.feeds).toMatchObject([
      { title: "Owner feed", offered: 40, opened: 2, skipsMost: true },
      { title: "Quiet feed", offered: 9, skipsMost: false },
    ]);
    const la = await owner.query(api.stats.readingRoom, {
      timeZone: "America/Los_Angeles",
      period: "month",
    });
    // 15:00 UTC is 08:00 in Los Angeles
    expect(la.heat[5 * 24 + 8]).toBe(20);
  });

  it("is empty for a month with no reading", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { owner } = await secondReaderTest(modules);
    const room = await owner.query(api.stats.readingRoom, {
      timeZone: "UTC",
      period: "month",
    });
    expect(room.activeTimeMs).toBe(0);
    expect(room.feeds).toEqual([]);
    expect(room.heat.every((m) => m === 0)).toBe(true);
  });

  it("never shows another reader's visits, feeds or lengths", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { t, reader } = await secondReaderTest(modules);
    await seed(t);
    const room = await reader.query(api.stats.readingRoom, {
      timeZone: "UTC",
      period: "30days",
    });
    expect(room.activeTimeMs).toBe(0);
    expect(room.feeds).toEqual([]);
    expect(room.weekday).toEqual({ short: 0, middle: 0, long: 0 });
  });

  it("rejects a caller who isn't signed in", async () => {
    const t = readerTest(modules);
    await expect(
      t.query(api.stats.readingRoom, { timeZone: "UTC", period: "month" }),
    ).rejects.toThrow();
    await expect(
      t.query(api.stats.readingTopics, { timeZone: "UTC", period: "month" }),
    ).rejects.toThrow();
  });
});

describe("readingTopics", () => {
  it("has no topics until tags exist", async () => {
    const { owner, reader } = await secondReaderTest(modules);
    const args = { timeZone: "UTC", period: "month" as const };
    expect(await owner.query(api.stats.readingTopics, args)).toEqual([]);
    expect(await reader.query(api.stats.readingTopics, args)).toEqual([]);
  });
});
