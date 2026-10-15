/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { ownerTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function library(
  articles: { title: string; minutes?: number; finished?: boolean }[],
) {
  const t = await ownerTest(modules);
  await t.run(async (ctx) => {
    for (const [i, a] of articles.entries())
      await ctx.db.insert("articles", {
        userId: "default_user",
        guid: `guid-${i}`,
        url: `https://example.com/${i}`,
        title: a.title,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        estimatedReadMinutes: a.minutes,
        finishedAt: a.finished ? Date.now() : undefined,
        createdAt: Date.now(),
      });
  });
  return t;
}

const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe("time-window suggestions", () => {
  it("offers the unread articles closest to the window", async () => {
    const t = await library([
      { title: "two", minutes: 2 },
      { title: "nine", minutes: 9 },
      { title: "ten", minutes: 10 },
      { title: "twelve", minutes: 12 },
      { title: "forty", minutes: 40 },
      { title: "ten, read", minutes: 10, finished: true },
    ]);
    const picks = await t.query(api.suggestions.forWindow, {
      requestedMinutes: 10,
    });
    expect(titles(picks)).toEqual(["ten", "nine", "twelve"]);
    expect(picks[0]).toMatchObject({
      estimatedReadMinutes: 10,
      reason: "Fits your 10-minute window",
    });
  });

  it("still offers articles that have no read-time estimate", async () => {
    const t = await library([{ title: "unknown length" }]);
    expect(
      titles(
        await t.query(api.suggestions.forWindow, { requestedMinutes: 20 }),
      ),
    ).toEqual(["unknown length"]);
  });

  it("looks past a crowd of short pieces to a long window's neighbours", async () => {
    const t = await library([
      ...Array.from({ length: 30 }, (_, i) => ({
        title: `short ${i}`,
        minutes: 3,
      })),
      { title: "half hour", minutes: 30 },
    ]);
    const picks = await t.query(api.suggestions.forWindow, {
      requestedMinutes: 30,
    });
    expect(picks[0]?.title).toBe("half hour");
  });

  it("rejects a window outside 1–180 minutes", async () => {
    const t = await library([]);
    await expect(
      t.query(api.suggestions.forWindow, { requestedMinutes: 0 }),
    ).rejects.toThrow("between 1 and 180");
  });
});
