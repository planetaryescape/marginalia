/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drain } from "../test/drain";
import {
  ownerWithKey,
  saveTestCredential,
  secondReaderTest,
} from "../test/owner";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { DAILY_CAP, sampleHash } from "./preAnnotate";
import { CLAIM_TTL_MS } from "./reannotateBackfill";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type T = Awaited<ReturnType<typeof ownerWithKey>>;

const job = {
  "preAnnotate:scan": internal.preAnnotate.scan,
  "preAnnotate:commit": internal.preAnnotate.commit,
};
const run = async (t: T, userId = OWNER) => {
  await t.mutation(internal.preAnnotate.start, { userId });
  await drain(t, job);
};

const deferred = (
  ctx: MutationCtx,
  userId: string,
  title: string,
  author: string,
  extra: Record<string, unknown> = {},
) =>
  ctx.db.insert("articles", {
    userId,
    guid: `${userId}-${title}`,
    url: `https://example.com/${userId}/${title}`,
    title,
    author,
    extractionStatus: "extracted",
    annotationStatus: "deferred",
    estimatedReadMinutes: 35,
    createdAt: Date.now(),
    ...extra,
  });

const likeAda = (ctx: MutationCtx, userId: string) =>
  ctx.db.insert("tasteProfiles", {
    userId,
    feeds: [],
    authors: [{ key: "ada lovelace", affinity: 0.8, n: 8 }],
    tags: [],
    evidence: 10,
    computedAt: Date.now(),
  });

const statuses = (t: T, ids: Id<"articles">[]) =>
  t.run(async (ctx) =>
    Promise.all(
      ids.map(async (id) => (await ctx.db.get(id))?.annotationStatus),
    ),
  );

const logged = (t: T, userId = OWNER) =>
  t.run((ctx) =>
    ctx.db
      .query("preAnnotations")
      .withIndex("by_user_chosenAt", (q) => q.eq("userId", userId))
      .collect(),
  );

const generating = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").take(500)).filter((j) =>
      j.name.includes("generateForArticle"),
    ),
  );

async function twoKinds(t: T, each: number, userId = OWNER) {
  return t.run(async (ctx) => {
    const ada: Id<"articles">[] = [];
    const zed: Id<"articles">[] = [];
    for (let i = 0; i < each; i++) {
      ada.push(await deferred(ctx, userId, `ada ${i}`, "Ada Lovelace"));
      zed.push(await deferred(ctx, userId, `zed ${i}`, "Zed"));
    }
    return { ada, zed };
  });
}

describe("annotating likely reads ahead of time", () => {
  it("starts the marginalia of the best few within the daily cap and leaves the rest", async () => {
    const t = await ownerWithKey(modules);
    const { ada, zed } = await twoKinds(t, 8);
    await t.run((ctx) => likeAda(ctx, OWNER));
    await run(t);

    const states = await statuses(t, ada);
    expect(states.filter((s) => s === "pending")).toHaveLength(DAILY_CAP);
    expect(await statuses(t, zed)).toEqual(zed.map(() => "deferred"));
    expect(await generating(t)).toHaveLength(DAILY_CAP);

    const rows = await logged(t);
    const chosen = rows.filter((r) => r.group === "chosen");
    expect(chosen).toHaveLength(DAILY_CAP);
    expect(
      chosen.every((r) => r.because === "author" && (r.score ?? 0) >= 0.15),
    ).toBe(true);
    expect(
      ada.filter((id) => chosen.some((r) => r.articleId === id)),
    ).toHaveLength(DAILY_CAP);
  });

  it("logs a control sample it passed over, and annotates none of it", async () => {
    const t = await ownerWithKey(modules);
    const { ada, zed } = await twoKinds(t, 8);
    await t.run((ctx) => likeAda(ctx, OWNER));
    await run(t);
    const rows = await logged(t);
    const control = rows.filter((r) => r.group === "control");
    expect(control).toHaveLength(DAILY_CAP);
    const chosenIds = new Set(
      rows.filter((r) => r.group === "chosen").map((r) => r.articleId),
    );
    expect(control.some((r) => chosenIds.has(r.articleId))).toBe(false);
    expect(
      control.every((r) => r.score === undefined && r.because === undefined),
    ).toBe(true);
    const controlStates = await statuses(
      t,
      control.map((r) => r.articleId),
    );
    expect(controlStates.every((s) => s === "deferred")).toBe(true);
    expect([...ada, ...zed].length).toBe(16);
  });

  it("samples the same controls on a rerun the same day", () => {
    expect(sampleHash("2026-10-16", "id1")).toBe(
      sampleHash("2026-10-16", "id1"),
    );
    expect(sampleHash("2026-10-16", "id1")).not.toBe(
      sampleHash("2026-10-17", "id1"),
    );
  });

  it("spends the cap once a day, however many times the job runs", async () => {
    const t = await ownerWithKey(modules);
    const { ada } = await twoKinds(t, 12);
    await t.run((ctx) => likeAda(ctx, OWNER));
    await run(t);
    await run(t);
    await run(t);
    expect((await logged(t)).filter((r) => r.group === "chosen")).toHaveLength(
      DAILY_CAP,
    );
    expect(
      (await statuses(t, ada)).filter((s) => s === "pending"),
    ).toHaveLength(DAILY_CAP);

    vi.setSystemTime(Date.now() + 25 * 60 * 60_000);
    await run(t);
    expect((await logged(t)).filter((r) => r.group === "chosen")).toHaveLength(
      DAILY_CAP * 2,
    );
  });

  it("never chooses an article twice", async () => {
    const t = await ownerWithKey(modules);
    await twoKinds(t, 14);
    await t.run((ctx) => likeAda(ctx, OWNER));
    await run(t);
    vi.setSystemTime(Date.now() + 25 * 60 * 60_000);
    await run(t);
    const rows = await logged(t);
    // A control stays a control, so a later day cannot pick it
    const ids = rows.map((r) => r.articleId);
    expect(new Set(ids).size).toBe(ids.length);
    const chosen = rows.filter((r) => r.group === "chosen");
    expect(chosen.length).toBeGreaterThan(DAILY_CAP);
  });

  it("does nothing without a taste profile", async () => {
    const t = await ownerWithKey(modules);
    await twoKinds(t, 4);
    await run(t);
    expect(await logged(t)).toEqual([]);
    expect(await generating(t)).toEqual([]);
  });

  it("does nothing without an AI key, so nothing is skipped for want of one", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    const reader = t as unknown as T;
    const { ada } = await twoKinds(reader, 3, readerLibraryId);
    await t.run((ctx) => likeAda(ctx, readerLibraryId));
    await run(reader, readerLibraryId);
    expect(await logged(reader, readerLibraryId)).toEqual([]);
    expect(await statuses(reader, ada)).toEqual(ada.map(() => "deferred"));
  });

  it("does nothing for a disabled library", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    const reader = t as unknown as T;
    await saveTestCredential(
      t,
      readerLibraryId,
      "openrouter",
      "reader-openrouter-key",
    );
    const { ada } = await twoKinds(reader, 3, readerLibraryId);
    await t.run(async (ctx) => {
      await likeAda(ctx, readerLibraryId);
      const row = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", readerLibraryId))
        .first();
      if (row) await ctx.db.patch(row._id, { status: "disabled" });
    });
    await run(reader, readerLibraryId);
    expect(await logged(reader, readerLibraryId)).toEqual([]);
    expect(await statuses(reader, ada)).toEqual(ada.map(() => "deferred"));
  });

  it("leaves articles the backfill has claimed, books and read articles alone", async () => {
    const t = await ownerWithKey(modules);
    const ids = await t.run(async (ctx) => ({
      claimed: await deferred(ctx, OWNER, "claimed", "Ada Lovelace", {
        reannotateClaimedAt: Date.now(),
      }),
      stale: await deferred(ctx, OWNER, "stale claim", "Ada Lovelace", {
        reannotateClaimedAt: Date.now() - CLAIM_TTL_MS - 1,
      }),
      book: await deferred(ctx, OWNER, "book", "Ada Lovelace", {
        bookUnitCount: 3,
      }),
      read: await deferred(ctx, OWNER, "read", "Ada Lovelace", {
        finishedAt: Date.now(),
      }),
    }));
    await t.run((ctx) => likeAda(ctx, OWNER));
    await run(t);
    expect(
      await statuses(t, [ids.claimed, ids.stale, ids.book, ids.read]),
    ).toEqual(["deferred", "pending", "deferred", "deferred"]);
  });

  it("rechecks each article where it starts it: one opened since the scan is not started", async () => {
    const t = await ownerWithKey(modules);
    const { ada } = await twoKinds(t, 2);
    await t.run(async (ctx) => {
      await likeAda(ctx, OWNER);
      await ctx.db.patch(ada[0], { annotationStatus: "annotated" });
    });
    const started = await t.mutation(internal.preAnnotate.commit, {
      userId: OWNER,
      best: ada.map((articleId) => ({
        articleId,
        term: 0.6,
        source: "author" as const,
      })),
      controls: [],
    });
    expect(started).toBe(1);
    expect(await statuses(t, ada)).toEqual(["annotated", "pending"]);
    expect(await generating(t)).toHaveLength(1);
  });

  it("serves one reader without touching another's articles", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    const base = t as unknown as T;
    await saveTestCredential(t, OWNER, "openrouter", "owner-openrouter-key");
    await saveTestCredential(
      t,
      readerLibraryId,
      "openrouter",
      "reader-openrouter-key",
    );
    const mine = await twoKinds(base, 3, OWNER);
    const theirs = await twoKinds(base, 3, readerLibraryId);
    await t.run(async (ctx) => {
      await likeAda(ctx, OWNER);
      await likeAda(ctx, readerLibraryId);
    });
    await run(base, OWNER);
    expect(await statuses(base, mine.ada)).toEqual(
      mine.ada.map(() => "pending"),
    );
    expect(await statuses(base, theirs.ada)).toEqual(
      theirs.ada.map(() => "deferred"),
    );
    expect(await logged(base, readerLibraryId)).toEqual([]);
    await run(base, readerLibraryId);
    expect(await statuses(base, theirs.ada)).toEqual(
      theirs.ada.map(() => "pending"),
    );
    expect(
      (await logged(base, OWNER)).every(
        (r) => mine.ada.includes(r.articleId) || mine.zed.includes(r.articleId),
      ),
    ).toBe(true);
  });
});

describe("measuring whether the choices were good", () => {
  const DAY = 24 * 60 * 60_000;

  async function seedOutcomes(t: T, userId: string) {
    const old = Date.now() - 10 * DAY;
    await t.run(async (ctx) => {
      const log = async (
        title: string,
        group: "chosen" | "control",
        opened: boolean,
        chosenAt = old,
      ) => {
        const id = await deferred(ctx, userId, title, "Ada Lovelace");
        await ctx.db.insert("preAnnotations", {
          userId,
          articleId: id,
          group,
          chosenAt,
        });
        if (opened)
          await ctx.db.insert("articleInteractions", {
            userId,
            articleId: id,
            action: "opened",
            createdAt: chosenAt + 1000,
          });
        return id;
      };
      // 3 of 4 chosen opened, 1 of 4 controls
      for (const [i, o] of [true, true, true, false].entries())
        await log(`chosen ${i}`, "chosen", o);
      for (const [i, o] of [true, false, false, false].entries())
        await log(`control ${i}`, "control", o);
      // Too recent to have been given time, so left out
      await log("recent", "chosen", false, Date.now() - DAY);
      // Opened before it was chosen does not count
      const early = await deferred(ctx, userId, "early", "Ada Lovelace");
      await ctx.db.insert("preAnnotations", {
        userId,
        articleId: early,
        group: "control",
        chosenAt: old,
      });
      await ctx.db.insert("articleInteractions", {
        userId,
        articleId: early,
        action: "opened",
        createdAt: old - 1000,
      });
    });
  }

  it("reports the open rate of chosen articles against the control sample", async () => {
    const t = await ownerWithKey(modules);
    await seedOutcomes(t, OWNER);
    const report = await t.query(internal.preAnnotate.preAnnotationReport, {
      userId: OWNER,
    });
    expect(report.chosen).toEqual({ n: 4, opened: 3, rate: 0.75 });
    expect(report.control).toEqual({ n: 5, opened: 1, rate: 0.2 });
    expect(report.lift).toBeCloseTo(0.55);
  });

  it("counts a finish as an open and ignores another reader's rows", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    const base = t as unknown as T;
    await seedOutcomes(base, readerLibraryId);
    const mine = await base.query(internal.preAnnotate.preAnnotationReport, {
      userId: OWNER,
    });
    expect(mine.chosen.n).toBe(0);
    expect(mine.lift).toBeNull();
    const theirs = await base.query(internal.preAnnotate.preAnnotationReport, {
      userId: readerLibraryId,
    });
    expect(theirs.chosen.n).toBe(4);
    await base.run(async (ctx) => {
      const row = await ctx.db
        .query("preAnnotations")
        .withIndex("by_user_chosenAt", (q) => q.eq("userId", readerLibraryId))
        .first();
      if (row)
        await ctx.db.insert("articleInteractions", {
          userId: readerLibraryId,
          articleId: row.articleId,
          action: "finished",
          createdAt: row.chosenAt + 5,
        });
    });
    const after = await base.query(internal.preAnnotate.preAnnotationReport, {
      userId: readerLibraryId,
    });
    expect(after.chosen.opened + after.control.opened).toBeGreaterThanOrEqual(
      theirs.chosen.opened + theirs.control.opened,
    );
  });

  it("is empty before anything has been chosen", async () => {
    const t = await ownerWithKey(modules);
    const report = await t.query(internal.preAnnotate.preAnnotationReport, {
      userId: OWNER,
    });
    expect(report).toEqual({
      chosen: { n: 0, opened: 0, rate: null },
      control: { n: 0, opened: 0, rate: null },
      lift: null,
    });
  });
});
