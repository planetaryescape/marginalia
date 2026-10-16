/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { ownerTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import { capDwell } from "./lib/readingActivity";

const modules = import.meta.glob("./**/*.ts");
async function fixture() {
  const t = await ownerTest(modules);
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "checkpoint",
      url: "https://example.com/checkpoint",
      title: "Checkpoint fixture",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: Date.now(),
    }),
  );
  const startedAt = Date.now() - 20000;
  return {
    t,
    articleId,
    checkpoint: {
      articleId,
      visitId: "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e",
      day: new Date(startedAt).toISOString().slice(0, 10),
      startedAt,
      updatedAt: startedAt + 10000,
      activeTimeMs: 6000,
      visibleTimeMs: 8000,
      timeSpentMs: 10000,
      maxScrollPercent: 40,
      annotationsOpened: ["one"],
    },
  };
}
describe("reading checkpoints", () => {
  it("counts unfinished reading once across duplicate and out-of-order checkpoints", async () => {
    const { t, checkpoint } = await fixture();
    await t.mutation(api.readingActivity.checkpoint, checkpoint);
    await t.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      updatedAt: checkpoint.updatedAt + 5000,
      activeTimeMs: 10000,
      visibleTimeMs: 13000,
      timeSpentMs: 15000,
      maxScrollPercent: 80,
      annotationsOpened: ["one", "two"],
    });
    await t.mutation(api.readingActivity.checkpoint, checkpoint);
    const stats = await t.query(api.stats.getDashboard, {
      range: "7days",
      timeZone: "UTC",
    });
    expect(stats.thisWeek).toMatchObject({
      articlesFinished: 0,
      articlesStarted: 1,
      totalActiveTimeMs: 10000,
      annotationsOpenedCount: 2,
      untrackedOpens: 0,
    });
    expect(
      await t.run((ctx) => ctx.db.query("readingActivity").take(10)),
    ).toHaveLength(1);
    expect(await t.query(api.sessions.getInProgress, {})).toMatchObject({
      article: { _id: checkpoint.articleId },
    });
  });
  it("makes completion idempotent and doesn't add checkpoint time again to legacy history", async () => {
    const { t, checkpoint } = await fixture();
    await t.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      finished: true,
    });
    await t.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      finished: true,
    });
    await t.mutation(api.readingActivity.checkpoint, checkpoint);
    const stats = await t.query(api.stats.getDashboard, {
      range: "7days",
      timeZone: "UTC",
    });
    expect(stats.thisWeek).toMatchObject({
      articlesFinished: 1,
      totalActiveTimeMs: 6000,
    });
    expect(
      await t.run((ctx) => ctx.db.query("articleInteractions").take(10)),
    ).toHaveLength(2);
  });
  it("rejects inconsistent durations and visit reuse for a different article", async () => {
    const { t, checkpoint } = await fixture();
    await expect(
      t.mutation(api.readingActivity.checkpoint, {
        ...checkpoint,
        activeTimeMs: 9000,
      }),
    ).rejects.toThrow("durations");
    await t.mutation(api.readingActivity.checkpoint, checkpoint);
    const other = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: "default_user",
        guid: "other",
        url: "https://example.com/other",
        title: "Other",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      }),
    );
    await expect(
      t.mutation(api.readingActivity.checkpoint, {
        ...checkpoint,
        articleId: other,
      }),
    ).rejects.toThrow("another article");
  });

  describe("paragraph dwell", () => {
    const rows = (t: Awaited<ReturnType<typeof fixture>>["t"]) =>
      t.run((ctx) => ctx.db.query("paragraphDwell").collect());
    it("accepts checkpoints from before dwell existed without writing a row", async () => {
      const { t, checkpoint } = await fixture();
      await t.mutation(api.readingActivity.checkpoint, checkpoint);
      expect(await rows(t)).toHaveLength(0);
    });
    it("keeps the larger reading per paragraph across duplicate, late and beacon checkpoints", async () => {
      const { t, checkpoint } = await fixture();
      const send = (dwell: Record<string, number>, bump = 0) =>
        t.mutation(api.readingActivity.checkpoint, {
          ...checkpoint,
          updatedAt: checkpoint.updatedAt + bump,
          activeTimeMs: 6000 + bump,
          visibleTimeMs: 8000 + bump,
          timeSpentMs: 10000 + bump,
          dwell,
        });
      await send({ "1": 2000, "2": 1500 });
      await send({ "1": 3500, "3": 1200 }, 1000);
      await send({ "1": 2000, "2": 1500 });
      await send({ "1": 3500, "3": 1200 }, 1000);
      const [row] = await rows(t);
      expect(await rows(t)).toHaveLength(1);
      expect(row.dwell).toEqual({ "1": 3500, "2": 1500, "3": 1200 });
    });
    it("is independent of arrival order", async () => {
      const a = await fixture();
      const b = await fixture();
      const first = { "1": 2000, "2": 4000 };
      const second = { "2": 1500, "3": 2500 };
      const run = async (f: typeof a, order: Record<string, number>[]) => {
        for (const dwell of order)
          await f.t.mutation(api.readingActivity.checkpoint, {
            ...f.checkpoint,
            dwell,
          });
        return (await rows(f.t))[0].dwell;
      };
      expect(await run(a, [first, second])).toEqual(
        await run(b, [second, first]),
      );
    });
    it("drops glances, caps entries and clamps to the time the visit was active", async () => {
      const { t, checkpoint } = await fixture();
      const dwell: Record<string, number> = { "1": 999, "2": 50_000 };
      for (let i = 10; i < 510; i++) dwell[String(i)] = 1000 + i;
      await t.mutation(api.readingActivity.checkpoint, {
        ...checkpoint,
        dwell,
      });
      const [row] = await rows(t);
      expect(row.dwell["1"]).toBeUndefined();
      expect(row.dwell["2"]).toBe(6000);
      expect(Object.keys(row.dwell)).toHaveLength(300);
      // The longest survive: 509 is the largest of the generated run
      expect(row.dwell["509"]).toBe(1509);
      expect(row.dwell["10"]).toBeUndefined();
    });
    it("keeps the fullest checkpoint well under the 32 KB request limit", () => {
      const full = Object.fromEntries(
        Array.from({ length: 400 }, (_, i) => [String(99_000 + i), 86_400_000]),
      );
      const dwell = capDwell(full);
      expect(Object.keys(dwell ?? {})).toHaveLength(300);
      expect(JSON.stringify({ dwell }).length).toBeLessThan(8_000);
    });
    it("ignores a malformed dwell and still saves the checkpoint", async () => {
      const { t, checkpoint } = await fixture();
      await t.mutation(internal.readingActivity.record, {
        ...checkpoint,
        userId: "default_user",
        dwell: { x: 5000, "-1": 5000, "0": 5000, "1.5": 5000 },
      });
      expect(await rows(t)).toHaveLength(0);
      const visits = await t.run((ctx) =>
        ctx.db.query("readingActivity").collect(),
      );
      expect(visits).toHaveLength(1);
    });
    it("never lets another reader's visit write into this reader's dwell", async () => {
      const { t, checkpoint } = await fixture();
      await t.mutation(api.readingActivity.checkpoint, {
        ...checkpoint,
        dwell: { "1": 3000 },
      });
      await t
        .mutation(internal.readingActivity.record, {
          ...checkpoint,
          userId: "someone_else",
          dwell: { "1": 3000 },
        })
        .catch(() => {});
      const all = await rows(t);
      expect(all.every((r) => r.userId === "default_user")).toBe(true);
    });
  });
});
