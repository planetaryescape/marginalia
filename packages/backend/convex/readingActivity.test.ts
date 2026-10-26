/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { ownerTest, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import { capDwell, furthestParagraph } from "./lib/readingActivity";

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
  it("resolves concurrent creation idempotently and scopes identical keys to their authenticated reader", async () => {
    const f = await secondReaderTest(modules);
    const clientKey = "2bffb0eb-fcc8-499f-b369-7c7f4c307290";
    const input = { clientKey, requestedMinutes: 17 };
    const [first, repeated] = await Promise.all([
      f.owner.mutation(api.sessions.create, input),
      f.owner.mutation(api.sessions.create, input),
    ]);
    expect(first).toBe(repeated);
    const other = await f.reader.mutation(api.sessions.create, {
      clientKey,
      requestedMinutes: 23,
    });
    expect(other).not.toBe(first);
    expect(
      await f.owner.query(api.sessions.getByClientKey, { clientKey }),
    ).toEqual({ sessionId: first });
    expect(
      await f.reader.query(api.sessions.getByClientKey, { clientKey }),
    ).toEqual({ sessionId: other });
  });
  it("keeps attribution and credits each day once when a queued finish crosses midnight", async () => {
    const { t, checkpoint } = await fixture();
    const sessionKey = "2bffb0eb-fcc8-499f-b369-7c7f4c307290";
    const first = {
      ...checkpoint,
      startedAt: checkpoint.startedAt - 86_400_000,
      updatedAt: checkpoint.updatedAt - 86_400_000,
      day: new Date(checkpoint.startedAt - 86_400_000)
        .toISOString()
        .slice(0, 10),
      sessionKey,
      requestedMinutes: 17,
    };
    const last = {
      ...checkpoint,
      sessionKey,
      requestedMinutes: 17,
      finished: true,
    };
    for (const snapshot of [first, last, first, last])
      await t.mutation(api.readingActivity.checkpoint, snapshot);
    const sessionId = await t.mutation(api.sessions.create, {
      clientKey: sessionKey,
      requestedMinutes: 17,
    });
    expect(await t.query(api.sessions.getById, { sessionId })).toMatchObject({
      timeSpentMs: 12_000,
      readingStatus: "completed",
    });
    const rows = await t.run((ctx) => ctx.db.query("readingActivity").take(5));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.sessionId === sessionId)).toBe(true);
    const interactions = await t.run((ctx) =>
      ctx.db.query("articleInteractions").take(10),
    );
    expect(
      interactions.filter((row) => row.action === "finished"),
    ).toHaveLength(1);
  });
  it("finishes against the original session before desk creation resolves, without a late open downgrading Done", async () => {
    const { t, articleId, checkpoint } = await fixture();
    const sessionKey = "2bffb0eb-fcc8-499f-b369-7c7f4c307290";
    await t.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      sessionKey,
      requestedMinutes: 17,
      finished: true,
    });
    const sessionId = await t.mutation(api.sessions.create, {
      clientKey: sessionKey,
      requestedMinutes: 17,
    });
    await t.mutation(api.sessions.updateStatus, {
      sessionId,
      articleId,
      readingStatus: "reading",
    });
    await t.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      sessionKey,
      requestedMinutes: 17,
    });
    expect(await t.query(api.sessions.getById, { sessionId })).toMatchObject({
      readingStatus: "completed",
      requestedMinutes: 17,
      timeSpentMs: 6000,
    });
    const visits = await t.run((ctx) =>
      ctx.db.query("readingActivity").take(5),
    );
    expect(visits).toHaveLength(1);
    expect(visits[0].sessionId).toBe(sessionId);
    await expect(
      t.mutation(api.readingActivity.checkpoint, {
        ...checkpoint,
        sessionKey,
        requestedMinutes: 20,
      }),
    ).rejects.toThrow("time changed");
  });
  it("fences a reading visit against a different session even at the same time window", async () => {
    const { t, checkpoint } = await fixture();
    const first = await t.mutation(api.sessions.create, {
      requestedMinutes: 10,
    });
    const second = await t.mutation(api.sessions.create, {
      requestedMinutes: 10,
    });
    await t.mutation(api.readingActivity.checkpoint, {
      ...checkpoint,
      sessionId: first,
    });
    await expect(
      t.mutation(api.readingActivity.checkpoint, {
        ...checkpoint,
        sessionId: second,
      }),
    ).rejects.toThrow("session changed");
  });
  it("copies the article's length onto the visit", async () => {
    const { t, articleId, checkpoint } = await fixture();
    await t.run((ctx) =>
      ctx.db.patch("articles", articleId, { estimatedReadMinutes: 12 }),
    );
    await t.mutation(api.readingActivity.checkpoint, checkpoint);
    const rows = await t.run((ctx) => ctx.db.query("readingActivity").take(5));
    expect(rows.map((r) => r.estimatedReadMinutes)).toEqual([12]);
  });

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

  describe("furthest place", () => {
    it("is the furthest any visit reached, and null for another reader's article", async () => {
      const { t, articleId, checkpoint } = await fixture();
      expect(await t.query(api.readingActivity.furthest, { articleId })).toBe(
        0,
      );
      expect(
        await t.query(api.readingActivity.furthestPlace, { articleId }),
      ).toEqual({ percent: 0 });
      await t.mutation(api.readingActivity.checkpoint, checkpoint);
      await t.mutation(api.readingActivity.checkpoint, {
        ...checkpoint,
        visitId: "270d1ba0-28c2-44b1-9d97-c9f9bc9e944e",
        maxScrollPercent: 65,
      });
      expect(await t.query(api.readingActivity.furthest, { articleId })).toBe(
        65,
      );
      expect(
        await t.query(api.readingActivity.furthestPlace, { articleId }),
      ).toEqual({ percent: 65 });
      const other = await t.run((ctx) =>
        ctx.db.insert("articles", {
          userId: "someone_else",
          guid: "theirs",
          url: "https://example.com/theirs",
          title: "Theirs",
          extractionStatus: "extracted",
          annotationStatus: "annotated",
          createdAt: Date.now(),
        }),
      );
      expect(
        await t.query(api.readingActivity.furthest, { articleId: other }),
      ).toBeNull();
      expect(
        await t.query(api.readingActivity.furthestPlace, { articleId: other }),
      ).toBeNull();
    });

    it("returns the paragraph recorded at the furthest scroll, and none for old rows", async () => {
      const { t, articleId, checkpoint } = await fixture();
      await t.mutation(api.readingActivity.checkpoint, {
        ...checkpoint,
        paragraphIndex: 14,
      });
      expect(
        await t.query(api.readingActivity.furthestPlace, { articleId }),
      ).toEqual({ percent: 40, paragraphIndex: 14 });
      // Another visit goes further but predates paragraphs: the stale one is not offered
      await t.mutation(api.readingActivity.checkpoint, {
        ...checkpoint,
        visitId: "270d1ba0-28c2-44b1-9d97-c9f9bc9e944e",
        maxScrollPercent: 70,
      });
      expect(
        await t.query(api.readingActivity.furthestPlace, { articleId }),
      ).toEqual({ percent: 70 });
    });

    it("keeps a visit's paragraph with its furthest scroll", async () => {
      const { t, articleId, checkpoint } = await fixture();
      await t.mutation(api.readingActivity.checkpoint, {
        ...checkpoint,
        maxScrollPercent: 60,
        paragraphIndex: 30,
      });
      // A late, shallower checkpoint cannot move the place back
      await t.mutation(api.readingActivity.checkpoint, {
        ...checkpoint,
        maxScrollPercent: 20,
        paragraphIndex: 5,
      });
      expect(
        await t.query(api.readingActivity.furthestPlace, { articleId }),
      ).toEqual({ percent: 60, paragraphIndex: 30 });
    });
  });
});

describe("furthestParagraph", () => {
  it("takes the new paragraph when the scroll goes further, even without one", () => {
    const old = { maxScrollPercent: 40, paragraphIndex: 9 };
    expect(
      furthestParagraph(old, { maxScrollPercent: 50, paragraphIndex: 12 }),
    ).toBe(12);
    expect(furthestParagraph(old, { maxScrollPercent: 50 })).toBeUndefined();
  });
  it("keeps the old paragraph for a repeat or shallower scroll", () => {
    const old = { maxScrollPercent: 40, paragraphIndex: 9 };
    expect(furthestParagraph(old, { maxScrollPercent: 40 })).toBe(9);
    expect(
      furthestParagraph(old, { maxScrollPercent: 10, paragraphIndex: 2 }),
    ).toBe(9);
  });
});
