/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { ownerTest } from "../test/owner";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";

describe("reading room backfill", () => {
  it("copies lengths and titles onto old rows, marks deleted articles and can run twice", async () => {
    vi.useFakeTimers();
    const t = await ownerTest(modules);
    const ids = await t.run(async (ctx) => {
      const article = (guid: string, minutes?: number) =>
        ctx.db.insert("articles", {
          userId: OWNER,
          guid,
          url: `https://example.com/${guid}`,
          title: `Title ${guid}`,
          estimatedReadMinutes: minutes,
          extractionStatus: "extracted",
          annotationStatus: "annotated",
          createdAt: 1,
        });
      const live = await article("live", 7);
      const gone = await article("gone", 3);
      await ctx.db.delete("articles", gone);
      // More rows than one batch
      for (let i = 0; i < 20; i++)
        await ctx.db.insert("readingActivity", {
          userId: OWNER,
          visitId: `v${i}`,
          day: "2026-10-13",
          articleId: live,
          startedAt: i,
          updatedAt: i,
          activeTimeMs: 1,
          visibleTimeMs: 1,
          timeSpentMs: 1,
          maxScrollPercent: 1,
          annotationsOpened: [],
        });
      for (const [articleId, word] of [
        [live, "alive"],
        [gone, "dead"],
      ] as const)
        await ctx.db.insert("lookups", {
          userId: OWNER,
          articleId,
          word,
          wordKey: word,
          sentence: "s",
          sense: "n. x",
          createdAt: 1,
        });
      // Another reader's article under the owner's rows: never copied from
      const other = await ctx.db.insert("articles", {
        userId: "someone_else",
        guid: "other",
        url: "https://example.com/other",
        title: "Not yours",
        estimatedReadMinutes: 99,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
      await ctx.db.insert("readingActivity", {
        userId: OWNER,
        visitId: "foreign",
        day: "2026-10-13",
        articleId: other,
        startedAt: 99,
        updatedAt: 99,
        activeTimeMs: 1,
        visibleTimeMs: 1,
        timeSpentMs: 1,
        maxScrollPercent: 1,
        annotationsOpened: [],
      });
      await ctx.db.insert("lookups", {
        userId: OWNER,
        articleId: other,
        word: "foreign",
        wordKey: "foreign",
        sentence: "s",
        sense: "n. x",
        createdAt: 1,
      });
      return { live };
    });
    for (let pass = 0; pass < 2; pass++) {
      await t.mutation(internal.readingRoomBackfill.run, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    }
    const { activity, lookups } = await t.run(async (ctx) => ({
      activity: await ctx.db.query("readingActivity").collect(),
      lookups: await ctx.db.query("lookups").collect(),
    }));
    expect(activity).toHaveLength(21);
    expect(
      activity
        .filter((r) => r.visitId !== "foreign")
        .every((r) => r.estimatedReadMinutes === 7),
    ).toBe(true);
    expect(
      activity.find((r) => r.visitId === "foreign")?.estimatedReadMinutes,
    ).toBeUndefined();
    const byWord = Object.fromEntries(lookups.map((l) => [l.wordKey, l]));
    expect(byWord.alive).toMatchObject({ articleTitle: "Title live" });
    expect(byWord.alive.articleGone).toBeUndefined();
    expect(byWord.dead).toMatchObject({ articleGone: true });
    expect(byWord.dead.articleTitle).toBeUndefined();
    expect(byWord.foreign.articleTitle).toBeUndefined();
    expect(byWord.foreign.articleGone).toBeUndefined();
    expect(ids.live).toBeTruthy();
    vi.useRealTimers();
  });
});
