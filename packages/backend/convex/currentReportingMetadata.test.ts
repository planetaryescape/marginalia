/// <reference types="vite/client" />
import { appendFileSync } from "node:fs";
import { getFunctionName } from "convex/server";
import { getDocumentSize } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { addReader } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import authSchema from "./betterAuth/schema";
import { purgeCurrentReporting } from "./lib/currentReporting";
import { metadataTriggers } from "./lib/metadataTriggers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
type Kind = "visits" | "dwell";
afterEach(() => vi.useRealTimers());
function evidence(label: string, value: string) {
  console.info(label, value);
  if (process.env.CURRENT_REPORT_EVIDENCE)
    appendFileSync(
      process.env.CURRENT_REPORT_EVIDENCE,
      `{"label":${JSON.stringify(label)},"value":${value}}\n`,
    );
}

async function fixture(now = "2026-11-02T12:00:00Z") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  const t = convexTest({ schema, modules, transactionLimits: true });
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("./betterAuth/**/*.ts"),
  );
  const { client, libraryId: userId } = await addReader(t, {
    email: "current-reports@example.com",
  });
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId,
      guid: "report",
      title: "Report",
      url: "https://example.com/report",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
      estimatedReadMinutes: 5,
    }),
  );
  const visit = (
    patch: Partial<Omit<Doc<"readingActivity">, "_id" | "_creationTime">> = {},
  ) => ({
    userId,
    articleId,
    visitId: "visit",
    day: "device-day",
    startedAt: Date.now() - 100,
    updatedAt: Date.now() - 100,
    activeTimeMs: 60_000,
    visibleTimeMs: 60_000,
    timeSpentMs: 60_000,
    maxScrollPercent: 50,
    annotationsOpened: [],
    estimatedReadMinutes: 5,
    ...patch,
  });
  const dwell = (
    patch: Partial<Omit<Doc<"paragraphDwell">, "_id" | "_creationTime">> = {},
  ) => ({
    userId,
    articleId,
    visitId: "visit",
    day: "device-day",
    updatedAt: Date.now() - 100,
    dwell: {
      a: 1000,
      b: 2000,
      c: 3000,
      d: 4000,
      e: 5000,
      f: 6000,
      g: 7000,
      h: 8000,
    },
    ...patch,
  });
  const migrate = (kind: Kind) =>
    t.mutation(internal.currentReportingMetadata.migrate, { userId, kind });
  const activate = (kind: Kind) =>
    t.mutation(internal.currentReportingMetadata.verifyAndActivate, {
      userId,
      kind,
    });
  const state = (kind: Kind) =>
    t.query(internal.currentReportingMetadata.status, { userId, kind });
  async function finish(kind: Kind) {
    for (let i = 0; i < 4200; i++) if ((await migrate(kind)).done) return;
    throw new Error("Fixture migration did not finish");
  }
  async function ready() {
    for (const kind of ["visits", "dwell"] as const) {
      await finish(kind);
      expect(await activate(kind)).toBe(true);
    }
  }
  async function tag(name = "Topic") {
    return t.run(async (ctx) => {
      const tagId = await ctx.db.insert("tags", {
        userId,
        name,
        key: name.toLowerCase(),
        status: "active",
        count: 1,
        aliases: [],
        createdAt: 1,
      });
      await ctx.db.insert("articleTags", {
        userId,
        articleId,
        tagId,
        createdAt: 1,
      });
      return tagId;
    });
  }
  return {
    t,
    client,
    userId,
    articleId,
    visit,
    dwell,
    migrate,
    activate,
    state,
    finish,
    ready,
    tag,
  };
}

it.each([
  "visits",
  "dwell",
] as const)("requires separate %s canonical proof, including genuinely empty libraries", async (kind) => {
  const f = await fixture();
  expect(await f.activate(kind)).toBe(false);
  expect(await f.migrate(kind)).toEqual({
    done: true,
    migrated: 0,
    retained: true,
  });
  expect(await f.state(kind)).toMatchObject({
    backfilled: true,
    ready: false,
    cursor: null,
  });
  expect(await f.activate(kind)).toBe(true);
  const metrics = await f.t.run(async (ctx) => {
    expect(
      await ctx.runMutation(internal.currentReportingMetadata.migrate, {
        userId: f.userId,
        kind,
      }),
    ).toEqual({ done: true, migrated: 0, retained: true });
    return ctx.meta.getTransactionMetrics();
  });
  expect(metrics.documentsWritten.used).toBe(0);
});

it("purges singleton current metadata across all three tables in one finite account round", async () => {
  const f = await fixture();
  await f.ready();
  await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    await db.insert("readingActivity", f.visit());
    await db.insert("paragraphDwell", f.dwell());
  });
  const result = await f.t.run(async (ctx) => ({
    page: await purgeCurrentReporting(ctx, f.userId),
    metrics: await ctx.meta.getTransactionMetrics(),
  }));
  expect(result.page).toMatchObject({ removed: 4, complete: true });
  expect(result.metrics.bytesRead.used).toBeLessThan(2 * 1024 * 1024);
  expect(
    await f.t.run((ctx) => purgeCurrentReporting(ctx, f.userId)),
  ).toMatchObject({ removed: 0, complete: true });
});

it("reserves physical purge bytes before every read, even for oversized raw metadata arrays", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 25; i++) {
      const dwellId = await ctx.db.insert("paragraphDwell", f.dwell());
      // Deliberately larger than the canonical <=1024-entry projection. The
      // schema permits 8192 values; account cleanup must not take(100) blindly.
      await ctx.db.insert("dwellReportingMetadata", {
        dwellId,
        userId: f.userId,
        articleId: f.articleId,
        sourceCreationTime: i,
        updatedAt: Date.now(),
        values: Array.from({ length: 8192 }, () => 1),
      });
    }
  });
  const first = await f.t.run(async (ctx) => ({
    page: await purgeCurrentReporting(ctx, f.userId),
    metrics: await ctx.meta.getTransactionMetrics(),
  }));
  expect(first.page.removed).toBeGreaterThan(0);
  expect(first.page.removed).toBeLessThan(25);
  expect(first.page.complete).toBe(false);
  expect(first.metrics.bytesRead.used).toBeLessThan(2 * 1024 * 1024);
  let removed = first.page.removed;
  for (let round = 0; round < 10; round++) {
    const page = await f.t.run((ctx) => purgeCurrentReporting(ctx, f.userId));
    removed += page.removed;
    if (page.complete) break;
  }
  expect(removed).toBe(25);
  expect(
    await f.t.run((ctx) => purgeCurrentReporting(ctx, f.userId)),
  ).toMatchObject({ removed: 0, complete: true });
});

it("migrates both kinds one source row at a time while generic changes move behind the cursor", async () => {
  const f = await fixture();
  const ids = await f.t.run(async (ctx) => ({
    a: await ctx.db.insert("readingActivity", f.visit()),
    b: await ctx.db.insert(
      "readingActivity",
      f.visit({ startedAt: Date.now() - 1000 }),
    ),
    d: await ctx.db.insert("paragraphDwell", f.dwell()),
    e: await ctx.db.insert("paragraphDwell", f.dwell()),
  }));
  for (const kind of ["visits", "dwell"] as const) {
    expect(await f.migrate(kind)).toMatchObject({ done: false, migrated: 1 });
    expect(await f.activate(kind)).toBe(false);
  }
  await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    await db.patch(ids.a, { startedAt: Date.now() - 10_000, activeTimeMs: -5 });
    await db.delete(ids.b);
    await db.patch(ids.d, { updatedAt: Date.now() - 1, dwell: { x: 1, y: 2 } });
    await db.delete(ids.e);
    await db.insert(
      "readingActivity",
      f.visit({ startedAt: Date.now() - 20_000 }),
    );
    await db.insert("paragraphDwell", f.dwell());
  });
  await f.ready();
  expect(await f.state("visits")).toMatchObject({ ready: true });
  expect(await f.state("dwell")).toMatchObject({ ready: true });
});

it.each([
  "missing",
  "extra",
  "duplicate",
  "stale",
  "order",
] as const)("production activation refuses %s metadata for both kinds", async (damage) => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    await db.insert("readingActivity", f.visit());
    await db.insert("paragraphDwell", f.dwell());
    await db.insert("readingActivity", f.visit());
    await db.insert("paragraphDwell", f.dwell());
  });
  await f.ready();
  await f.t.run(async (ctx) => {
    const v = await ctx.db.query("visitReportingMetadata").first();
    const d = await ctx.db.query("dwellReportingMetadata").first();
    if (!v || !d) throw new Error("Missing fixture metadata");
    if (damage === "missing") {
      await ctx.db.delete(v._id);
      await ctx.db.delete(d._id);
    } else if (damage === "stale") {
      await ctx.db.patch(v._id, { activeTimeMs: -100 });
      await ctx.db.patch(d._id, { values: [100] });
    } else if (damage === "order") {
      await ctx.db.patch(v._id, {
        sourceCreationTime: v.sourceCreationTime + 100,
      });
      await ctx.db.patch(d._id, { values: [...d.values].reverse() });
    } else {
      const { _id: _v, _creationTime: _vc, ...vf } = v;
      const { _id: _d, _creationTime: _dc, ...df } = d;
      const activityId =
        damage === "extra"
          ? await ctx.db.insert("readingActivity", f.visit())
          : v.activityId;
      const dwellId =
        damage === "extra"
          ? await ctx.db.insert("paragraphDwell", f.dwell())
          : d.dwellId;
      if (damage === "extra") {
        await ctx.db.delete(activityId);
        await ctx.db.delete(dwellId);
      }
      await ctx.db.insert("visitReportingMetadata", { ...vf, activityId });
      await ctx.db.insert("dwellReportingMetadata", { ...df, dwellId });
    }
  });
  for (const kind of ["visits", "dwell"] as const) {
    expect(await f.activate(kind)).toBe(false);
    expect(await f.state(kind)).toMatchObject({ ready: false });
  }
});

it("generic insert/patch/replace/delete maintain projections without touching source size or irrelevant fields", async () => {
  const f = await fixture();
  await f.ready();
  const ids = await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    return {
      v: await db.insert("readingActivity", f.visit()),
      d: await db.insert("paragraphDwell", f.dwell()),
    };
  });
  const noops = await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    await db.patch(ids.v, {
      updatedAt: Date.now(),
      visibleTimeMs: 9,
      visitId: "different",
      day: "elsewhere",
      annotationsOpened: ["annotation"],
      maxScrollPercent: 99,
    });
    // Map keys and visit/day are not current-report inputs. Equal ordered
    // values must not produce another metadata write.
    await db.patch(ids.d, {
      visitId: "different",
      day: "elsewhere",
      dwell: {
        aa: 1000,
        bb: 2000,
        cc: 3000,
        dd: 4000,
        ee: 5000,
        ff: 6000,
        gg: 7000,
        hh: 8000,
      },
    });
    return ctx.meta.getTransactionMetrics();
  });
  expect(noops.documentsWritten.used).toBe(2); // only the requested canonical writes
  await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    const articleId = await ctx.db.insert("articles", {
      userId: f.userId,
      guid: "moved",
      title: "Moved",
      url: "https://example.com/moved",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    });
    await db.replace(
      ids.v,
      f.visit({
        articleId,
        startedAt: Date.now() - 999,
        activeTimeMs: -1,
        estimatedReadMinutes: undefined,
      }),
    );
    await db.replace(
      ids.d,
      f.dwell({
        articleId,
        updatedAt: Date.now() - 999,
        dwell: { x: 1e16, y: 1, z: -1e16 },
      }),
    );
    expect(await ctx.db.get(ids.v)).toMatchObject({ activeTimeMs: -1 });
    expect(await ctx.db.query("visitReportingMetadata").first()).toMatchObject({
      articleId,
    });
    expect(await ctx.db.query("dwellReportingMetadata").first()).toMatchObject({
      articleId,
    });
  });
  expect(await f.activate("visits")).toBe(true);
  expect(await f.activate("dwell")).toBe(true);
  await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    await db.delete(ids.v);
    await db.delete(ids.d);
    expect(await ctx.db.query("visitReportingMetadata").first()).toBeNull();
    expect(await ctx.db.query("dwellReportingMetadata").first()).toBeNull();
  });
});

it("retains disabled libraries, removes foreign-owner moves, and never recreates absent/deleting libraries", async () => {
  const f = await fixture();
  await f.ready();
  await f.t.run(async (ctx) => {
    const access = await ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", f.userId))
      .unique();
    if (!access) throw new Error("No access");
    await ctx.db.patch(access._id, { status: "disabled" });
    const { db } = metadataTriggers.wrapDB(ctx);
    const v = await db.insert("readingActivity", f.visit());
    const d = await db.insert("paragraphDwell", f.dwell());
    expect(await ctx.db.query("visitReportingMetadata").first()).not.toBeNull();
    await db.patch(v, { userId: "absent" });
    await db.patch(d, { userId: "absent" });
    expect(await ctx.db.query("visitReportingMetadata").first()).toBeNull();
    expect(await ctx.db.query("dwellReportingMetadata").first()).toBeNull();
    await ctx.db.patch(access._id, { deletingAt: Date.now() });
    await db.patch(v, { userId: f.userId });
    await db.patch(d, { userId: f.userId });
    expect(await ctx.db.query("visitReportingMetadata").first()).toBeNull();
    expect(await ctx.db.query("dwellReportingMetadata").first()).toBeNull();
  });
  for (const kind of ["visits", "dwell"] as const) {
    expect(await f.migrate(kind)).toMatchObject({ retained: false });
    expect(await f.activate(kind)).toBe(false);
  }
  await f.t.run(async (ctx) => {
    while ((await purgeCurrentReporting(ctx, f.userId)).removed) {
      /* bounded fixture */
    }
    expect(await ctx.db.query("currentReportingState").first()).toBeNull();
    const v = await ctx.db.query("readingActivity").first();
    const d = await ctx.db.query("paragraphDwell").first();
    if (!v || !d) throw new Error("Missing retained deletion sources");
    const { db } = metadataTriggers.wrapDB(ctx);
    await db.patch(v._id, { activeTimeMs: 1 });
    await db.patch(d._id, { updatedAt: Date.now() });
    expect(await ctx.db.query("visitReportingMetadata").first()).toBeNull();
    expect(await ctx.db.query("dwellReportingMetadata").first()).toBeNull();
    expect(await ctx.db.query("currentReportingState").first()).toBeNull();
  });
  await expect(
    f.client.query(api.stats.readingRoom, { timeZone: "UTC", period: "month" }),
  ).rejects.toThrow();
});

it.each([
  "month",
  "30days",
  "90days",
] as const)("actual public %s reports preserve canonical payloads across London/NY DST with zero writes", async (period) => {
  const f = await fixture();
  await f.tag();
  await f.t.run(async (ctx) => {
    const times = [
      "2026-11-01T05:30:00Z",
      "2026-11-01T06:30:00Z",
      "2026-10-25T00:30:00Z",
      "2026-10-25T01:30:00Z",
      "2026-10-03T04:00:00Z",
      "2026-08-05T00:00:00Z",
    ];
    for (const [i, time] of times.entries()) {
      const at = Date.parse(time);
      await ctx.db.insert(
        "readingActivity",
        f.visit({
          startedAt: at,
          activeTimeMs: i === 2 ? -1000 : 60_000,
          estimatedReadMinutes: i === 1 ? undefined : 5,
        }),
      );
      await ctx.db.insert("paragraphDwell", f.dwell({ updatedAt: at }));
    }
    await ctx.db.insert(
      "readingActivity",
      f.visit({ userId: "foreign", activeTimeMs: 123456789 }),
    );
    await ctx.db.insert(
      "paragraphDwell",
      f.dwell({ userId: "foreign", dwell: { a: 1e30 } }),
    );
  });
  const endpoints = [
    api.stats.readingRoom,
    api.stats.readingTopics,
    api.readingHabits.readingLinger,
  ];
  for (const timeZone of ["Europe/London", "America/New_York"]) {
    const args = { timeZone, period };
    await f.t.run(async (ctx) => {
      for (const row of await ctx.db.query("currentReportingState").collect())
        await ctx.db.patch(row._id, { ready: false });
    });
    const before = await Promise.all(
      endpoints.map((endpoint) => f.client.query(endpoint, args)),
    );
    await f.ready();
    for (const [index, endpoint] of endpoints.entries()) {
      const result = await f.client.run(async (ctx) => {
        const value = await ctx.runQuery(endpoint, args);
        return { value, metrics: await ctx.meta.getTransactionMetrics() };
      });
      expect(result.metrics.documentsWritten.used).toBe(0);
      expect(result.value).toEqual(before[index]);
    }
  }
});

it("uses no cursor journal across a moving clock and canonical-to-compact readiness switch", async () => {
  const f = await fixture();
  await f.t.run((ctx) => ctx.db.insert("readingActivity", f.visit()));
  const args = { timeZone: "Europe/London", period: "month" } as const;
  for (const compact of [false, true]) {
    if (compact) {
      vi.setSystemTime(Date.now() + 1000);
      await f.ready();
    }
    const room = await f.client.run(async (ctx) => {
      const prototype = Object.getPrototypeOf(
        ctx.db
          .query("readingActivity")
          .withIndex("by_user_started", (q) => q.eq("userId", f.userId)),
      );
      // Test-only tripwire for the actual live InvalidCursor failure class.
      // convex-test does not emulate the server's reactive pagination journal.
      const journal = vi
        .spyOn(prototype, "paginate")
        .mockRejectedValue(
          new Error("Reactive pagination journal must not be reused"),
        );
      try {
        const value = await ctx.runQuery(api.stats.readingRoom, args);
        expect(journal).not.toHaveBeenCalled();
        return value;
      } finally {
        journal.mockRestore();
      }
    });
    expect(room).toMatchObject({ activeTimeMs: 60_000, partial: false });
  }
});

it("preserves Object.values order across rows rather than regrouping IEEE additions", async () => {
  const f = await fixture();
  await f.tag();
  await f.t.run(async (ctx) => {
    await ctx.db.insert("readingActivity", f.visit());
    // Newest is summed first: 1000 + 1e20 - 1e20 = 0. Per-row
    // subtotals instead yield 1000 + 0 = 1000, visibly 0.1 seconds/paragraph
    // rather than 0 after public rounding. Eight paragraphs meet the threshold.
    await ctx.db.insert(
      "paragraphDwell",
      f.dwell({ dwell: { a: 1e20, b: -1e20, c: 0, d: 0, e: 0, f: 0, g: 0 } }),
    );
    await ctx.db.insert("paragraphDwell", f.dwell({ dwell: { a: 1000 } }));
  });
  const args = { timeZone: "UTC", period: "month" } as const;
  const expected = {
    topics: [
      { name: "Topic", secondsPerParagraph: 0, paragraphs: 8, articles: 1 },
    ],
    partial: false,
  };
  expect(await f.client.query(api.readingHabits.readingLinger, args)).toEqual(
    expected,
  );
  await f.ready();
  expect(await f.client.query(api.readingHabits.readingLinger, args)).toEqual(
    expected,
  );
});

it("keeps numeric-key Object.values IEEE order in the public Linger payload", async () => {
  const f = await fixture();
  await f.tag();
  await f.t.run(async (ctx) => {
    await ctx.db.insert("readingActivity", f.visit());
    await ctx.db.insert(
      "paragraphDwell",
      f.dwell({
        dwell: {
          "10": 1000,
          "2": 1e20,
          a: -1e20,
          b: 1000,
          c: 0,
          d: 0,
          e: 0,
          f: 0,
        },
      }),
    );
  });
  const args = { timeZone: "UTC", period: "month" } as const;
  const expected = {
    topics: [
      { name: "Topic", secondsPerParagraph: 0.1, paragraphs: 8, articles: 1 },
    ],
    partial: false,
  };
  expect(await f.client.query(api.readingHabits.readingLinger, args)).toEqual(
    expected,
  );
  await f.ready();
  expect(await f.client.query(api.readingHabits.readingLinger, args)).toEqual(
    expected,
  );
});

it("physically reads all 1501 sentinel visits with 128 IDs, large visitIds and long dwell keys, with identical public reports", async () => {
  const f = await fixture();
  await f.tag();
  // Actual production operator establishes empty readiness before generic writes.
  await f.ready();
  for (let start = 0; start < 1501; start += 100)
    await f.t.run(async (ctx) => {
      const { db } = metadataTriggers.wrapDB(ctx);
      for (let i = start; i < Math.min(start + 100, 1501); i++)
        await db.insert(
          "readingActivity",
          f.visit({
            visitId: `${i}-${"v".repeat(256)}`,
            annotationsOpened: Array.from(
              { length: 128 },
              (_, n) =>
                `annotation-${String(n).padStart(3, "0")}-${"x".repeat(21)}`,
            ),
          }),
        );
    });
  await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    for (let i = 0; i < 21; i++)
      await db.insert(
        "paragraphDwell",
        f.dwell({
          visitId: "v".repeat(16_000),
          dwell: Object.fromEntries(
            Array.from({ length: 300 }, (_, n) => [
              `p${String(n).padStart(4, "0")}${"k".repeat(240)}`,
              1000 + n,
            ]),
          ),
        }),
      );
  });
  // Native proof, not a fixture ready flag. 1501 rows remain in its supported
  // byte envelope; both projections and index order must actually match.
  expect(await f.activate("visits")).toBe(true);
  expect(await f.activate("dwell")).toBe(true);
  const args = { timeZone: "Europe/London", period: "month" } as const;
  for (const endpoint of [
    api.stats.readingRoom,
    api.stats.readingTopics,
    api.readingHabits.readingLinger,
  ]) {
    const compact = await f.client.run(async (ctx) => {
      const value = await ctx.runQuery(endpoint, args);
      return { value, metrics: await ctx.meta.getTransactionMetrics() };
    });
    await f.t.run(async (ctx) => {
      for (const state of await ctx.db.query("currentReportingState").collect())
        await ctx.db.patch(state._id, { ready: false });
    });
    const canonical = await f.client.run(async (ctx) => {
      const value = await ctx.runQuery(endpoint, args);
      return { value, metrics: await ctx.meta.getTransactionMetrics() };
    });
    expect(compact.value).toEqual(canonical.value);
    expect(compact.metrics.documentsWritten.used).toBe(0);
    expect(canonical.metrics.documentsWritten.used).toBe(0);
    expect(compact.metrics.bytesRead.used).toBeLessThan(
      canonical.metrics.bytesRead.used / 3,
    );
    evidence(
      "current-report-native-query",
      JSON.stringify({
        endpoint: getFunctionName(endpoint),
        compact: compact.metrics,
        canonical: canonical.metrics,
      }),
    );
    await f.ready();
  }
  const physical = await f.t.run(async (ctx) => {
    const source = await ctx.db.query("readingActivity").take(1501);
    const projected = await ctx.db.query("visitReportingMetadata").take(1501);
    return {
      source: source.reduce((sum, row) => sum + getDocumentSize(row), 0),
      projected: projected.reduce((sum, row) => sum + getDocumentSize(row), 0),
    };
  });
  expect(physical.source).toBeGreaterThan(7_000_000);
  expect(physical.projected).toBeLessThan(700_000);
  evidence(
    "current-report-physical-source-projection",
    JSON.stringify(physical),
  );
  const room = await f.client.query(api.stats.readingRoom, args);
  expect(room.partial).toBe(true);
  expect(room.activeTimeMs).toBe(1500 * 60_000);
  await f.t.run(async (ctx) => {
    const row = await ctx.db.query("readingActivity").first();
    if (!row) throw new Error("Missing sentinel");
    await metadataTriggers.wrapDB(ctx).db.delete(row._id);
  });
  expect(await f.client.query(api.stats.readingRoom, args)).toMatchObject({
    partial: false,
    activeTimeMs: 1500 * 60_000,
  });
});

it.each([
  "visits",
  "dwell",
] as const)("refuses %s production proof beyond the physical row envelope", async (kind) => {
  const f = await fixture();
  await f.ready();
  for (let start = 0; start < 4097; start += 100)
    await f.t.run(async (ctx) => {
      const { db } = metadataTriggers.wrapDB(ctx);
      for (let i = start; i < Math.min(start + 100, 4097); i++) {
        if (kind === "visits") await db.insert("readingActivity", f.visit());
        else await db.insert("paragraphDwell", f.dwell());
      }
    });
  const result = await f.t.run(async (ctx) => ({
    value: await ctx.runMutation(
      internal.currentReportingMetadata.verifyAndActivate,
      { userId: f.userId, kind },
    ),
    metrics: await ctx.meta.getTransactionMetrics(),
  }));
  expect(result.value).toBe(false);
  expect(await f.state(kind)).toMatchObject({ ready: false });
  expect(result.metrics.bytesRead.used).toBeLessThan(13 * 1024 * 1024);
  evidence(`current-report-row-proof-refusal:${kind}`, JSON.stringify(result));
  await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    const row =
      kind === "visits"
        ? await ctx.db.query("readingActivity").first()
        : await ctx.db.query("paragraphDwell").first();
    if (!row) throw new Error("Missing boundary source");
    await db.delete(row._id);
  });
  // The exact boundary is supported, not an off-by-one blanket refusal.
  expect(await f.activate(kind)).toBe(true);
});

it("supports maximum-source projections without source growth, 1024 ordered dwell values and bounded byte-proof refusal", async () => {
  const f = await fixture();
  await f.ready();
  await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    const visit = f.visit({ visitId: "v".repeat(1_047_000) });
    const dwell = f.dwell({
      dwell: Object.fromEntries(
        Array.from({ length: 1024 }, (_, n) => [
          `p${String(n).padStart(4, "0")}${"k".repeat(980)}`,
          n,
        ]),
      ),
    });
    const v = await db.insert("readingActivity", visit);
    const d = await db.insert("paragraphDwell", dwell);
    const sourceVisit = await ctx.db.get(v);
    const sourceDwell = await ctx.db.get(d);
    if (!sourceVisit || !sourceDwell)
      throw new Error("Missing maximum sources");
    expect(sourceVisit).toEqual({
      ...visit,
      _id: v,
      _creationTime: sourceVisit._creationTime,
    });
    expect(sourceDwell).toEqual({
      ...dwell,
      _id: d,
      _creationTime: sourceDwell._creationTime,
    });
    // convex-test enforces aggregate transaction bytes, NOT individual document
    // caps. Explicit fixture guard proves these are valid <=1MiB documents.
    expect(getDocumentSize(sourceVisit)).toBeLessThanOrEqual(1024 * 1024);
    expect(getDocumentSize(sourceVisit)).toBeGreaterThan(1_047_000);
    expect(getDocumentSize(sourceDwell)).toBeLessThanOrEqual(1024 * 1024);
    const projection = await ctx.db.query("dwellReportingMetadata").first();
    expect(projection?.values).toHaveLength(1024);
    expect(projection?.values).toEqual(Object.values(sourceDwell.dwell));
    evidence(
      "current-report-maximum-source-no-growth",
      JSON.stringify({
        visitBytes: getDocumentSize(sourceVisit),
        dwellBytes: getDocumentSize(sourceDwell),
        dwellProjectionBytes: getDocumentSize(projection ?? {}),
        growth: 0,
      }),
    );
  });
  expect(await f.activate("visits")).toBe(true);
  expect(await f.activate("dwell")).toBe(true);
  // Nine valid almost-1MiB sources exceed the supported same-snapshot proof
  // envelope. Migrate remains done/idempotent, but activation MUST refuse.
  for (let i = 0; i < 8; i++)
    await f.t.run((ctx) =>
      metadataTriggers
        .wrapDB(ctx)
        .db.insert(
          "readingActivity",
          f.visit({ visitId: "v".repeat(1_047_000) }),
        ),
    );
  expect(await f.activate("visits")).toBe(false);
  expect(await f.state("visits")).toMatchObject({ ready: false });
});

it("truthfully improves Room coverage past a source-byte cut", async () => {
  const f = await fixture();
  await f.ready();
  for (let i = 0; i < 10; i++)
    await f.t.run((ctx) =>
      metadataTriggers
        .wrapDB(ctx)
        .db.insert(
          "readingActivity",
          f.visit({ visitId: "v".repeat(950_000) }),
        ),
    );
  const args = { timeZone: "UTC", period: "month" } as const;
  const full = await f.client.query(api.stats.readingRoom, args);
  expect(full).toMatchObject({ activeTimeMs: 600_000, partial: false });
  await f.t.run(async (ctx) => {
    const row = await ctx.db
      .query("currentReportingState")
      .withIndex("by_userId_and_kind", (q) =>
        q.eq("userId", f.userId).eq("kind", "visits"),
      )
      .unique();
    if (!row) throw new Error("Missing state");
    await ctx.db.patch(row._id, { ready: false });
  });
  const cut = await f.client.query(api.stats.readingRoom, args);
  expect(cut.partial).toBe(true);
  expect(cut.activeTimeMs).toBe(9 * 60_000); // physical crossing row, not hidden truncation
  // A larger baseline cannot be reactivated by claiming cursor completion.
  expect(await f.activate("visits")).toBe(false);
});

it("preserves Linger per-article sentinels, global cutoff and duplicate links", async () => {
  const f = await fixture();
  const tagId = await f.tag("Shared");
  await f.tag("Equal");
  await f.ready();
  for (let start = 0; start < 100; start += 10)
    await f.t.run(async (ctx) => {
      const { db } = metadataTriggers.wrapDB(ctx);
      for (let i = start; i < start + 10; i++) {
        const articleId = await ctx.db.insert("articles", {
          userId: f.userId,
          guid: `article-${i}`,
          title: "Article",
          url: `https://example.com/${i}`,
          extractionStatus: "extracted",
          annotationStatus: "annotated",
          createdAt: 1,
        });
        await db.insert("readingActivity", f.visit({ articleId }));
        await ctx.db.insert("articleTags", {
          userId: f.userId,
          articleId,
          tagId,
          createdAt: 1,
        });
        if (i === 99)
          await ctx.db.insert("articleTags", {
            userId: f.userId,
            articleId,
            tagId,
            createdAt: 1,
          });
        for (let j = 0; j < 21; j++)
          await db.insert(
            "paragraphDwell",
            f.dwell({ articleId, updatedAt: j === 20 ? 0 : Date.now() - 100 }),
          );
      }
    });
  const args = { timeZone: "UTC", period: "month" } as const;
  const compact = await f.client.query(api.readingHabits.readingLinger, args);
  expect(compact.partial).toBe(true);
  // A batch of twenty settles before the next budget check. Two batches read
  // 840 physical rows, not a newly introduced hard 500 cutoff. The newest row
  // per article is out of window but STILL occupies the first-20 source cap.
  expect(compact.topics).toEqual([
    {
      name: "Shared",
      secondsPerParagraph: 4.5,
      paragraphs: 41 * 19 * 8,
      articles: 41,
    },
  ]);
  await f.t.run(async (ctx) => {
    const state = await ctx.db
      .query("currentReportingState")
      .withIndex("by_userId_and_kind", (q) =>
        q.eq("userId", f.userId).eq("kind", "dwell"),
      )
      .unique();
    if (!state) throw new Error("Missing state");
    await ctx.db.patch(state._id, { ready: false });
  });
  expect(await f.client.query(api.readingHabits.readingLinger, args)).toEqual(
    compact,
  );
  expect(await f.activate("dwell")).toBe(true);
});

it("keeps unknown-length authority, signed active time, 200 topic articles and 100 Linger articles", async () => {
  const f = await fixture();
  const tagId = await f.tag();
  await f.ready();
  for (let start = 0; start < 201; start += 40)
    await f.t.run(async (ctx) => {
      const { db } = metadataTriggers.wrapDB(ctx);
      for (let i = start; i < Math.min(start + 40, 201); i++) {
        const articleId = await ctx.db.insert("articles", {
          userId: f.userId,
          guid: `cap-${i}`,
          title: "Unknown length",
          url: `https://example.com/cap-${i}`,
          extractionStatus: "extracted",
          annotationStatus: "annotated",
          createdAt: 1,
        });
        await db.insert(
          "readingActivity",
          f.visit({ articleId, estimatedReadMinutes: undefined }),
        );
        await db.insert("paragraphDwell", f.dwell({ articleId }));
        await ctx.db.insert("articleTags", {
          userId: f.userId,
          articleId,
          tagId,
          createdAt: 1,
        });
      }
      if (start === 0) {
        await db.insert("readingActivity", f.visit({ activeTimeMs: -1000 }));
        await db.insert("readingActivity", f.visit({ activeTimeMs: 0 }));
      }
    });
  const args = { timeZone: "UTC", period: "month" } as const;
  const room = await f.client.query(api.stats.readingRoom, args);
  expect(room.activeTimeMs).toBe(201 * 60_000 - 1000);
  expect(room.readsPartial).toBe(true);
  const topics = await f.client.query(api.stats.readingTopics, args);
  expect(topics).toMatchObject([
    { name: "Topic", articles: 200, minutes: 200 },
  ]);
  const linger = await f.client.query(api.readingHabits.readingLinger, args);
  expect(linger).toEqual({
    topics: [
      {
        name: "Topic",
        paragraphs: 800,
        articles: 100,
        secondsPerParagraph: 4.5,
      },
    ],
    partial: false,
  });
  await f.t.run(async (ctx) => {
    for (const state of await ctx.db.query("currentReportingState").collect())
      await ctx.db.patch(state._id, { ready: false });
  });
  expect(await f.client.query(api.stats.readingRoom, args)).toEqual(room);
  expect(await f.client.query(api.stats.readingTopics, args)).toEqual(topics);
  expect(await f.client.query(api.readingHabits.readingLinger, args)).toEqual(
    linger,
  );
});

it("keeps Linger minimum-eight threshold, source value ordering and tag-ID ties", async () => {
  const f = await fixture();
  const a = await f.tag("A");
  const b = await f.tag("B");
  await f.t.run(async (ctx) => {
    await ctx.db.insert("readingActivity", f.visit());
    await ctx.db.insert(
      "paragraphDwell",
      f.dwell({
        dwell: {
          "10": 1000,
          "2": 1000,
          a: 1000,
          b: 1000,
          c: 1000,
          d: 1000,
          e: 1000,
        },
      }),
    );
  });
  await f.ready();
  const args = { timeZone: "UTC", period: "month" } as const;
  expect(await f.client.query(api.readingHabits.readingLinger, args)).toEqual({
    topics: [],
    partial: false,
  });
  await f.t.run((ctx) =>
    metadataTriggers
      .wrapDB(ctx)
      .db.insert("paragraphDwell", f.dwell({ dwell: { x: 1000 } })),
  );
  const expected = {
    topics: (a.localeCompare(b) < 0 ? ["A", "B"] : ["B", "A"]).map((name) => ({
      name,
      secondsPerParagraph: 1,
      paragraphs: 8,
      articles: 1,
    })),
    partial: false,
  };
  expect(await f.client.query(api.readingHabits.readingLinger, args)).toEqual(
    expected,
  );
});

it("moves metadata to a retained foreign owner atomically without leaking into the original reader", async () => {
  const f = await fixture();
  const other = await addReader(f.t, {
    email: "other-current-reports@example.com",
  });
  await f.ready();
  const ids = await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    return {
      v: await db.insert("readingActivity", f.visit()),
      d: await db.insert("paragraphDwell", f.dwell()),
    };
  });
  await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    await db.patch(ids.v, { userId: other.libraryId, articleId: f.articleId });
    await db.patch(ids.d, { userId: other.libraryId, articleId: f.articleId });
    expect(
      await ctx.db
        .query("visitReportingMetadata")
        .withIndex("by_userId", (q) => q.eq("userId", f.userId))
        .first(),
    ).toBeNull();
    expect(
      await ctx.db
        .query("dwellReportingMetadata")
        .withIndex("by_userId", (q) => q.eq("userId", f.userId))
        .first(),
    ).toBeNull();
    expect(
      await ctx.db
        .query("visitReportingMetadata")
        .withIndex("by_userId", (q) => q.eq("userId", other.libraryId))
        .first(),
    ).toMatchObject({ activityId: ids.v });
    expect(
      await ctx.db
        .query("dwellReportingMetadata")
        .withIndex("by_userId", (q) => q.eq("userId", other.libraryId))
        .first(),
    ).toMatchObject({ dwellId: ids.d });
  });
  expect(await f.activate("visits")).toBe(true);
  expect(await f.activate("dwell")).toBe(true);
  expect(
    await f.client.query(api.stats.readingRoom, {
      timeZone: "UTC",
      period: "month",
    }),
  ).toMatchObject({ activeTimeMs: 0, partial: false });
});

it("orders recreated dwell metadata by canonical source creation, not metadata creation or updatedAt", async () => {
  const f = await fixture();
  await f.tag();
  await f.ready();
  const oldest = await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    await db.insert("readingActivity", f.visit());
    const id = await db.insert(
      "paragraphDwell",
      f.dwell({ dwell: { a: 1e12 } }),
    );
    for (let i = 0; i < 21; i++) await db.insert("paragraphDwell", f.dwell());
    return id;
  });
  const args = { timeZone: "UTC", period: "month" } as const;
  const expected = {
    topics: [
      { name: "Topic", secondsPerParagraph: 4.5, paragraphs: 160, articles: 1 },
    ],
    partial: true,
  };
  expect(await f.client.query(api.readingHabits.readingLinger, args)).toEqual(
    expected,
  );
  await f.t.run(async (ctx) => {
    const row = await ctx.db
      .query("dwellReportingMetadata")
      .withIndex("by_dwellId", (q) => q.eq("dwellId", oldest))
      .unique();
    if (!row) throw new Error("Missing oldest metadata");
    await ctx.db.delete(row._id);
    await metadataTriggers
      .wrapDB(ctx)
      .db.patch(oldest, { updatedAt: Date.now() - 1 });
  });
  expect(await f.activate("dwell")).toBe(true);
  expect(await f.client.query(api.readingHabits.readingLinger, args)).toEqual(
    expected,
  );
});
