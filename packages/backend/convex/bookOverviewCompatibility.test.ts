/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveTestCredential, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import { BATCH_DELAY_MS } from "./catchUp";
import { CLAIM_TTL_MS } from "./lib/bookIndex";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected provider request");
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A paid overview is in flight; all unit work has already settled. */
async function fixture({ legacy = true, reader = false } = {}) {
  const f = await secondReaderTest(modules);
  const userId = reader ? f.readerLibraryId : "default_user";
  await saveTestCredential(
    f.t,
    userId,
    "openrouter",
    "sk-or-legacy-overview-fixture",
  );
  const claim = Date.now();
  const seeded = await f.t.run(async (ctx) => {
    const articleId = await ctx.db.insert("articles", {
      userId,
      guid: "upload:legacy-book",
      url: "upload:legacy-book",
      title: "Fixture Book",
      extractionStatus: "extracted",
      annotationStatus: "skipped",
      createdAt: claim,
      bookUnitCount: 2,
      bookOutline: [
        { title: "One", minutes: 1 },
        { title: "Two", minutes: 1 },
      ],
    });
    const bookId = await ctx.db.insert("books", {
      userId,
      articleId,
      unitCount: 2,
      finishedThrough: -1,
      furthestUnit: -1,
      furthestScroll: 0,
      finished: false,
      createdAt: claim,
    });
    for (const index of [0, 1]) {
      await ctx.db.insert("bookUnits", {
        userId,
        articleId,
        index,
        title: `Unit ${index + 1}`,
        content: "Fixture words.",
        contentHtml: "<p>Fixture words.</p>",
        wordCount: 100,
        estimatedReadMinutes: 1,
        annotationStatus: "deferred",
      });
      await ctx.db.insert("bookIndexUnits", {
        userId,
        articleId,
        stage: "summary",
        unitIndex: index,
        status: "done",
        claimedAt: claim - 1000,
        attempts: 1,
        summary: `Paid summary ${index + 1}.`,
      });
      await ctx.db.insert("bookIndexUnits", {
        userId,
        articleId,
        stage: "passages",
        unitIndex: index,
        status: "done",
        claimedAt: claim - 1000,
        attempts: 1,
        passageCount: 1,
      });
    }
    const stateId = await ctx.db.insert("bookIndexState", {
      userId,
      articleId,
      runId: 7,
      running: true,
      phase: "point",
      cursor: 0,
      pointAttempts: 1,
      pointClaimedAt: claim,
      queued: 4,
      startedAt: claim - 2000,
      updatedAt: claim,
      protocol: legacy ? undefined : 2,
    });
    const summaryId = await ctx.db.insert("summaries", {
      userId,
      articleId,
      thesis: "From the first part.",
      gist: "Original gist.",
      model: "fixture",
      createdAt: claim,
    });
    return { articleId, bookId, stateId, summaryId };
  });
  const args = { userId, articleId: seeded.articleId, runId: 7, claim };
  const overview = {
    thesis: "Paid whole-book point.",
    gist: "Paid whole-book gist.",
    model: "fixture",
  };
  return {
    ...f,
    ...seeded,
    args,
    overview,
    oldWrite: { userId, articleId: seeded.articleId, ...overview },
    state: () => f.t.run((ctx) => ctx.db.get("bookIndexState", seeded.stateId)),
    summary: () => f.t.run((ctx) => ctx.db.get("summaries", seeded.summaryId)),
    step: (runId = 7) =>
      f.t.mutation(internal.bookIndex.step, {
        userId,
        articleId: seeded.articleId,
        runId,
      }),
  };
}

describe("book overview mixed-version writes", () => {
  it("does not consume retained legacy permission on invalid content or mismatched new identity", async () => {
    const f = await fixture();
    await f.step();
    const retained = { runId: 7, claim: f.args.claim };
    for (const invalid of [
      { thesis: " " },
      { gist: " " },
      { runId: 6, claim: f.args.claim },
      { runId: 7 },
    ]) {
      expect(
        await f.t.mutation(internal.summaries.saveBookOverview, {
          ...f.oldWrite,
          ...invalid,
        }),
      ).toBeNull();
      expect((await f.state())?.legacyPoint).toEqual(retained);
      expect((await f.state())?.overviewDone).toBe(false);
    }
    vi.setSystemTime(f.args.claim + CLAIM_TTL_MS - 1);
    expect(
      await f.t.mutation(internal.summaries.saveBookOverview, f.oldWrite),
    ).toBe(f.summaryId);
    expect(await f.summary()).toMatchObject(f.overview);
  });

  it.each([
    "before-upgrade",
    "after-upgrade",
    "upgrade-after-save",
  ])("retains the old bare-query/save/completion sequence: %s", async (timing) => {
    const f = await fixture();
    expect(
      await f.t.query(internal.bookIndex.summariesForPoint, {
        articleId: f.articleId,
      }),
    ).toMatchObject({
      lines: [{ summary: "Paid summary 1." }, { summary: "Paid summary 2." }],
    });
    if (timing === "after-upgrade") {
      await f.step();
      expect((await f.state())?.legacyPoint).toEqual({
        runId: 7,
        claim: f.args.claim,
      });
    }
    expect(
      await f.t.mutation(internal.summaries.saveBookOverview, f.oldWrite),
    ).toBe(f.summaryId);
    expect(await f.state()).toMatchObject({
      overviewDone: true,
      pointAttempts: 1,
    });
    expect((await f.state())?.legacyPoint).toBeUndefined();
    // The allowance is one-shot even before the old action releases its claim.
    expect(
      await f.t.mutation(internal.summaries.saveBookOverview, {
        ...f.oldWrite,
        thesis: "Duplicate before completion.",
      }),
    ).toBeNull();
    if (timing === "upgrade-after-save") {
      await f.step();
      expect((await f.state())?.overviewDone).toBe(true);
    }
    await f.t.mutation(internal.bookIndex.pointWritten, f.args);
    expect(
      await f.t.mutation(internal.summaries.saveBookOverview, {
        ...f.oldWrite,
        thesis: "Duplicate after completion.",
      }),
    ).toBeNull();
    expect(await f.summary()).toMatchObject(f.overview);
    expect((await f.state())?.pointClaimedAt).toBeUndefined();
  });

  it.each([
    false,
    true,
  ])("does not repeat a paid legacy overview when its final completion is lost (adopted: %s)", async (adopted) => {
    const f = await fixture();
    if (adopted) await f.step();
    await f.t.mutation(internal.summaries.saveBookOverview, f.oldWrite);
    vi.setSystemTime(Date.now() + CLAIM_TTL_MS + 1000);
    await f.t.mutation(internal.bookIndex.pointWatchdog, f.args);
    await f.step();
    vi.setSystemTime(Date.now() + BATCH_DELAY_MS);
    await f.step();
    expect(await f.state()).toMatchObject({
      phase: "done",
      overviewDone: true,
      running: false,
      pointAttempts: 1,
      queued: 4,
    });
    expect(await f.summary()).toMatchObject(f.overview);
    const jobs = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(30),
    );
    expect(
      jobs.filter((job) => job.name.includes("indexBook:writeOverview")),
    ).toEqual([]);
    expect(
      await f.t.run((ctx) => ctx.db.query("readerLimits").take(10)),
    ).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fences a valid new overview through pointWritten and consumes any retained legacy allowance", async () => {
    const f = await fixture();
    await f.step();
    await f.t.mutation(internal.bookIndex.pointWritten, {
      ...f.args,
      overview: f.overview,
    });
    expect(await f.summary()).toMatchObject(f.overview);
    expect(await f.state()).toMatchObject({
      phase: "passages",
      overviewDone: true,
    });
    expect((await f.state())?.legacyPoint).toBeUndefined();
    expect(
      await f.t.mutation(internal.summaries.saveBookOverview, f.oldWrite),
    ).toBeNull();
  });

  it("accepts a matching new writer without legacy permission, but rejects missing, partial and stale identity", async () => {
    const f = await fixture({ legacy: false });
    for (const identity of [
      {},
      { runId: 7 },
      { claim: f.args.claim },
      { runId: 6, claim: f.args.claim },
      { runId: 7, claim: f.args.claim - 1 },
    ]) {
      expect(
        await f.t.mutation(internal.summaries.saveBookOverview, {
          ...f.oldWrite,
          ...identity,
        }),
      ).toBeNull();
      expect((await f.summary())?.thesis).toBe("From the first part.");
      expect((await f.state())?.overviewDone).toBeUndefined();
    }
    expect(
      await f.t.mutation(internal.summaries.saveBookOverview, {
        ...f.oldWrite,
        ...f.args,
      }),
    ).toBe(f.summaryId);
    expect(await f.summary()).toMatchObject(f.overview);
    expect(
      await f.t.mutation(internal.summaries.saveBookOverview, {
        ...f.oldWrite,
        ...f.args,
        thesis: "Duplicate new write.",
      }),
    ).toBeNull();
  });

  it.each([
    false,
    true,
  ])("invalidates old permission on a true restart, not just while no point claim exists (adopted: %s)", async (adopted) => {
    const f = await fixture();
    await f.t.query(internal.bookIndex.summariesForPoint, {
      articleId: f.articleId,
    });
    if (adopted) await f.step();
    await f.t.run((ctx) =>
      ctx.db.patch("bookIndexState", f.stateId, { running: false }),
    );
    await f.t.mutation(internal.bookIndex.start, {
      userId: f.args.userId,
      articleId: f.articleId,
    });
    expect(await f.state()).toMatchObject({ protocol: 2, runId: 8 });
    expect((await f.state())?.legacyPoint).toBeUndefined();
    expect(
      await f.t.mutation(internal.summaries.saveBookOverview, f.oldWrite),
    ).toBeNull();
    vi.setSystemTime(Date.now() + BATCH_DELAY_MS);
    await f.step(8);
    const current = await f.state();
    expect(current).toMatchObject({ phase: "point", pointAttempts: 2 });
    expect(current?.pointClaimedAt).not.toBe(f.args.claim);
    expect(
      await f.t.mutation(internal.summaries.saveBookOverview, f.oldWrite),
    ).toBeNull();
    await f.t.mutation(internal.bookIndex.pointWritten, f.args);
    expect((await f.summary())?.thesis).toBe("From the first part.");
    expect((await f.state())?.pointClaimedAt).toBe(current?.pointClaimedAt);
  });

  it("invalidates the legacy allowance when an expired claim is replaced within the same run", async () => {
    const f = await fixture();
    await f.step();
    vi.setSystemTime(Date.now() + CLAIM_TTL_MS + 1);
    await f.step();
    const current = await f.state();
    expect(current).toMatchObject({
      runId: 7,
      phase: "point",
      pointAttempts: 2,
    });
    expect(current?.legacyPoint).toBeUndefined();
    expect(current?.pointClaimedAt).not.toBe(f.args.claim);
    expect(
      await f.t.mutation(internal.summaries.saveBookOverview, f.oldWrite),
    ).toBeNull();
    expect(
      await f.t.mutation(internal.summaries.saveBookOverview, {
        ...f.oldWrite,
        ...f.args,
      }),
    ).toBeNull();
    if (current?.pointClaimedAt === undefined)
      throw new Error("Expected replacement claim");
    await f.t.mutation(internal.bookIndex.pointWritten, {
      ...f.args,
      claim: current.pointClaimedAt,
      overview: f.overview,
    });
    expect(await f.summary()).toMatchObject(f.overview);
  });

  it.each([
    "failure",
    "watchdog",
    "pause",
  ])("invalidates the retained permission on point %s", async (transition) => {
    const f = await fixture();
    await f.step();
    if (transition === "failure")
      await f.t.mutation(internal.bookIndex.pointFailed, f.args);
    else if (transition === "watchdog") {
      vi.setSystemTime(Date.now() + CLAIM_TTL_MS + 1);
      await f.t.mutation(internal.bookIndex.pointWatchdog, f.args);
    } else
      await f.t.mutation(internal.bookIndex.pauseIndex, {
        ...f.args,
        stage: "point",
        reason: "unusable_key",
      });
    expect((await f.state())?.legacyPoint).toBeUndefined();
    expect((await f.state())?.pointClaimedAt).toBeUndefined();
    expect(
      await f.t.mutation(internal.summaries.saveBookOverview, f.oldWrite),
    ).toBeNull();
  });

  it.each([
    "summaries",
    "passages",
    "done",
  ] as const)("does not infer legacy permission from a book in phase %s", async (phase) => {
    const f = await fixture();
    await f.t.run((ctx) =>
      ctx.db.patch("bookIndexState", f.stateId, { phase }),
    );
    expect(
      await f.t.mutation(internal.summaries.saveBookOverview, f.oldWrite),
    ).toBeNull();
    expect((await f.summary())?.thesis).toBe("From the first part.");
  });

  it.each([
    false,
    true,
  ])("rejects a claimless legacy result at the expiry boundary (adopted: %s)", async (adopted) => {
    const f = await fixture();
    if (adopted) await f.step();
    vi.setSystemTime(Date.now() + CLAIM_TTL_MS);
    expect(
      await f.t.mutation(internal.summaries.saveBookOverview, f.oldWrite),
    ).toBeNull();
    expect((await f.summary())?.thesis).toBe("From the first part.");
  });

  it.each([
    "book",
    "article",
    "state",
  ])("cannot recreate an overview after deleting its %s", async (target) => {
    const f = await fixture();
    await f.step();
    await f.t.run(async (ctx) => {
      await ctx.db.delete("summaries", f.summaryId);
      if (target === "book") await ctx.db.delete("books", f.bookId);
      else if (target === "article")
        await ctx.db.delete("articles", f.articleId);
      else await ctx.db.delete("bookIndexState", f.stateId);
    });
    for (const identity of [{}, f.args])
      expect(
        await f.t.mutation(internal.summaries.saveBookOverview, {
          ...f.oldWrite,
          ...identity,
        }),
      ).toBeNull();
    await f.t.mutation(internal.bookIndex.pointWritten, {
      ...f.args,
      overview: f.overview,
    });
    expect(await f.t.run((ctx) => ctx.db.query("summaries").take(10))).toEqual(
      [],
    );
  });

  it("does not write while the library is disabled or while/after the account is deleted", async () => {
    const f = await fixture({ reader: true });
    await f.step();
    const readerId = await f.t.run(async (ctx) => {
      const row = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.args.userId))
        .unique();
      if (!row) throw new Error("Expected reader");
      await ctx.db.patch("readers", row._id, { status: "disabled" });
      return row._id;
    });
    for (const identity of [{}, f.args])
      expect(
        await f.t.mutation(internal.summaries.saveBookOverview, {
          ...f.oldWrite,
          ...identity,
        }),
      ).toBeNull();
    expect((await f.summary())?.thesis).toBe("From the first part.");
    await f.t.run((ctx) =>
      ctx.db.patch("readers", readerId, { status: "active" }),
    );
    await f.reader.mutation(api.account.deleteMine, { confirmation: "DELETE" });
    for (const identity of [{}, f.args])
      expect(
        await f.t.mutation(internal.summaries.saveBookOverview, {
          ...f.oldWrite,
          ...identity,
        }),
      ).toBeNull();
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.state()).toBeNull();
    expect(await f.summary()).toBeNull();
    expect(
      await f.t.mutation(internal.summaries.saveBookOverview, f.oldWrite),
    ).toBeNull();
    await f.t.mutation(internal.bookIndex.pointWritten, {
      ...f.args,
      overview: f.overview,
    });
    expect(await f.t.run((ctx) => ctx.db.query("summaries").take(10))).toEqual(
      [],
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
