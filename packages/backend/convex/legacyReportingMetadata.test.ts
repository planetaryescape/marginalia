/// <reference types="vite/client" />
import { appendFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { addReader } from "../test/owner";
import { api, internal } from "./_generated/api";
import authSchema from "./betterAuth/schema";
import {
  noteReportingProjection,
  reflectionReportingProjection,
} from "./lib/legacyReporting";
import { metadataTriggers } from "./lib/metadataTriggers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
type Kind = "notes" | "reflections";
afterEach(() => vi.useRealTimers());
async function fixture() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
  const t = convexTest({ schema, modules, transactionLimits: true });
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("./betterAuth/**/*.ts"),
  );
  const { client, libraryId: userId } = await addReader(t, {
    email: "operator@example.com",
  });
  const articleId = await t.run((ctx) =>
    metadataTriggers.wrapDB(ctx).db.insert("articles", {
      userId,
      guid: "operator",
      title: "Operator",
      url: "https://example.com",
      extractionStatus: "pending",
      annotationStatus: "pending",
      createdAt: 1,
    }),
  );
  const add = (
    kind: Kind,
    at = Date.now() - 100,
    text = "thought",
    generic = false,
  ) =>
    t.run(async (ctx) => {
      const db = generic ? metadataTriggers.wrapDB(ctx).db : ctx.db;
      return kind === "notes"
        ? await db.insert("userNotes", {
            userId,
            articleId,
            selectedText: "passage",
            content: "",
            contentPlain: text,
            createdAt: at,
            updatedAt: at,
          })
        : await db.insert("reflections", {
            userId,
            articleId,
            strongestPoint: "",
            weakestAssumption: "",
            credibleCounterview: "",
            questionForYou: "",
            createdAt: 1,
            respondedAt: at,
            userResponse: text,
          });
    });
  const state = (kind: Kind) =>
    t.run((ctx) =>
      ctx.db
        .query("legacyReportingState")
        .withIndex("by_userId_and_kind", (q) =>
          q.eq("userId", userId).eq("kind", kind),
        )
        .unique(),
    );
  const migrate = (kind: Kind) =>
    t.mutation(internal.legacyReportingMetadata.migrate, { userId, kind });
  const activate = (kind: Kind) =>
    t.mutation(internal.legacyReportingMetadata.verifyAndActivate, {
      userId,
      kind,
    });
  async function finish(kind: Kind) {
    for (let i = 0; i < 520; i++) if ((await migrate(kind)).done) return;
    throw new Error("Migration did not finish within fixture envelope");
  }
  return {
    t,
    client,
    userId,
    articleId,
    add,
    state,
    migrate,
    activate,
    finish,
  };
}

it.each([
  "notes",
  "reflections",
] as const)("requires real completed backfill and an independent exact %s proof", async (kind) => {
  const f = await fixture();
  await f.add(kind, Date.now() - 100, "first");
  await f.add(kind, Date.now() - 100, " "); // ties/blank rows still occupy source positions
  expect(await f.activate(kind)).toBe(false);
  expect(await f.state(kind)).toBeNull();
  expect(await f.migrate(kind)).toMatchObject({ done: false, migrated: 1 });
  expect(await f.activate(kind)).toBe(false);
  // A source inserted behind the persisted source cursor is maintained by the
  // actual generic hook, not guessed from the backfill cursor.
  await f.add(kind, Date.now() - 1000, "behind cursor", true);
  await f.t.run(async (ctx) => {
    const { db } = metadataTriggers.wrapDB(ctx);
    if (kind === "notes") {
      const source = await ctx.db.query("userNotes").first();
      if (!source) throw new Error("Missing note");
      await db.patch(source._id, {
        contentPlain: "updated",
        createdAt: Date.now() - 50,
      });
    } else {
      const source = await ctx.db.query("reflections").first();
      if (!source) throw new Error("Missing reflection");
      await db.patch(source._id, {
        userResponse: "",
        respondedAt: Date.now() - 50,
      });
    }
  });
  await f.finish(kind);
  expect(await f.state(kind)).toMatchObject({
    backfilled: true,
    ready: false,
    cursor: null,
  });
  const before = await f.client.query(api.stats.getDashboard, {});
  const measured = await f.t.run(async (ctx) => ({
    value: await ctx.runMutation(
      internal.legacyReportingMetadata.verifyAndActivate,
      { userId: f.userId, kind },
    ),
    metrics: await ctx.meta.getTransactionMetrics(),
  }));
  expect(measured.value).toBe(true);
  expect(measured.metrics.bytesRead.used).toBeLessThan(30_000);
  if (process.env.LEGACY_OPERATOR_EVIDENCE)
    appendFileSync(
      process.env.LEGACY_OPERATOR_EVIDENCE,
      `${JSON.stringify({ kind, proof: measured })}\n`,
    );
  expect(await f.client.query(api.stats.getDashboard, {})).toEqual(before);
  const repeat = await f.t.run(async (ctx) => ({
    value: await ctx.runMutation(internal.legacyReportingMetadata.migrate, {
      userId: f.userId,
      kind,
    }),
    proof: await ctx.runMutation(
      internal.legacyReportingMetadata.verifyAndActivate,
      { userId: f.userId, kind },
    ),
    metrics: await ctx.meta.getTransactionMetrics(),
  }));
  expect(repeat.value).toEqual({ done: true, migrated: 0, retained: true });
  expect(repeat.proof).toBe(true);
  expect(repeat.metrics.documentsWritten.used).toBe(0);
  await f.t.run(async (ctx) => {
    if (kind === "notes") {
      const canonical = await ctx.db
        .query("userNotes")
        .withIndex("by_user_created", (q) => q.eq("userId", f.userId))
        .collect();
      const compact = await ctx.db
        .query("noteReportingMetadata")
        .withIndex(
          "by_userId_and_createdAt_and_sourceCreationTime_and_noteId",
          (q) => q.eq("userId", f.userId),
        )
        .collect();
      expect(compact.map((n) => n.noteId)).toEqual(canonical.map((n) => n._id));
    } else {
      const source = await ctx.db.query("reflections").first();
      if (!source) throw new Error("Missing reflection");
      await metadataTriggers
        .wrapDB(ctx)
        .db.patch(source._id, { respondedAt: undefined });
      expect(
        await ctx.db
          .query("reflectionReportingMetadata")
          .withIndex("by_reflectionId", (q) => q.eq("reflectionId", source._id))
          .unique(),
      ).toBeNull();
    }
  });
  expect(await f.activate(kind)).toBe(true);
});

it.each([
  "notes",
  "reflections",
] as const)("proves an empty %s baseline instead of inferring it", async (kind) => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.insert("legacyReportingState", {
      userId: f.userId,
      kind,
      ready: false,
      overflow: 0,
      cursor: null,
    }),
  );
  expect(await f.activate(kind)).toBe(false); // null cursor alone is not completion
  expect(await f.migrate(kind)).toEqual({
    done: true,
    migrated: 0,
    retained: true,
  });
  expect((await f.state(kind))?.ready).toBe(false);
  await f.t.run(async (ctx) => {
    const reader = await ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", f.userId))
      .unique();
    if (!reader) throw new Error("Missing retained reader");
    await ctx.db.patch(reader._id, { status: "disabled" });
  });
  expect(await f.activate(kind)).toBe(true);
});

it("excludes 4,000 undated generic reflections without adding metadata or rewriting sources", async () => {
  const f = await fixture();
  for (let batch = 0; batch < 8; batch++)
    await f.t.run(async (ctx) => {
      const { db } = metadataTriggers.wrapDB(ctx);
      for (let i = 0; i < 500; i++)
        await db.insert("reflections", {
          userId: f.userId,
          articleId: f.articleId,
          strongestPoint: "",
          weakestAssumption: "",
          credibleCounterview: "",
          questionForYou: "",
          createdAt: 1,
          userResponse: "",
        });
    });
  const result = await f.t.run(async (ctx) => ({
    value: await ctx.runMutation(internal.legacyReportingMetadata.migrate, {
      userId: f.userId,
      kind: "reflections",
    }),
    metrics: await ctx.meta.getTransactionMetrics(),
  }));
  expect(result.value).toEqual({ done: true, migrated: 0, retained: true });
  expect(result.metrics.documentsRead.used).toBeLessThan(10);
  expect(await f.activate("reflections")).toBe(true);
  expect(
    await f.t.run((ctx) => ctx.db.query("reflectionReportingMetadata").first()),
  ).toBeNull();
  if (process.env.LEGACY_OPERATOR_EVIDENCE)
    appendFileSync(
      process.env.LEGACY_OPERATOR_EVIDENCE,
      `${JSON.stringify({ undated4000: result })}\n`,
    );
});

it.each([
  "notes",
  "reflections",
] as const)("rejects missing, extra, duplicate, stale and foreign %s metadata", async (kind) => {
  for (const corruption of [
    "missing",
    "extra",
    "duplicate",
    "stale",
    "foreign",
    "nonblank",
    "date",
  ] as const) {
    const f = await fixture();
    await f.add(kind);
    await f.finish(kind);
    expect(await f.activate(kind)).toBe(true);
    await f.t.run(async (ctx) => {
      if (kind === "notes") {
        const source = await ctx.db.query("userNotes").first();
        const row = await ctx.db.query("noteReportingMetadata").first();
        if (!source || !row) throw new Error("Missing note fixture");
        if (corruption === "missing") await ctx.db.delete(row._id);
        else if (corruption === "foreign")
          await ctx.db.patch(row._id, { userId: "foreign" });
        else if (corruption === "stale")
          await ctx.db.patch(row._id, {
            sourceCreationTime: row.sourceCreationTime + 1,
          });
        else if (corruption === "nonblank")
          await ctx.db.patch(row._id, { nonblank: !row.nonblank });
        else if (corruption === "date")
          await ctx.db.patch(row._id, { createdAt: Number.NaN });
        else {
          const noteId =
            corruption === "extra"
              ? await ctx.db.insert("userNotes", {
                  userId: "foreign",
                  articleId: f.articleId,
                  content: "",
                  contentPlain: "extra",
                  selectedText: "",
                  createdAt: 1,
                  updatedAt: 1,
                })
              : source._id;
          await ctx.db.insert("noteReportingMetadata", {
            ...noteReportingProjection(source),
            noteId,
          });
        }
      } else {
        const source = await ctx.db.query("reflections").first();
        const row = await ctx.db.query("reflectionReportingMetadata").first();
        if (!source || !row) throw new Error("Missing reflection fixture");
        if (corruption === "missing") await ctx.db.delete(row._id);
        else if (corruption === "foreign")
          await ctx.db.patch(row._id, { userId: "foreign" });
        else if (corruption === "stale")
          await ctx.db.patch(row._id, {
            respondedAt: (row.respondedAt ?? 0) + 1,
          });
        else if (corruption === "nonblank")
          await ctx.db.patch(row._id, { nonblank: !row.nonblank });
        else if (corruption === "date")
          await ctx.db.patch(row._id, { respondedAt: undefined });
        else {
          const reflectionId =
            corruption === "extra"
              ? await ctx.db.insert("reflections", {
                  userId: "foreign",
                  articleId: f.articleId,
                  strongestPoint: "",
                  weakestAssumption: "",
                  credibleCounterview: "",
                  questionForYou: "",
                  createdAt: 1,
                })
              : source._id;
          await ctx.db.insert("reflectionReportingMetadata", {
            ...reflectionReportingProjection(source),
            reflectionId,
          });
        }
      }
    });
    expect(await f.activate(kind)).toBe(false);
    expect((await f.state(kind))?.ready).toBe(false);
  }
});

it.each([
  "notes",
  "reflections",
] as const)("refuses %s canonical proof beyond row/byte envelopes before native limits", async (kind) => {
  const f = await fixture();
  for (let batch = 0; batch < 2; batch++)
    await f.t.run(async (ctx) => {
      for (let i = batch * 300; i < Math.min(513, (batch + 1) * 300); i++) {
        if (kind === "notes")
          await ctx.db.insert("userNotes", {
            userId: f.userId,
            articleId: f.articleId,
            content: "",
            contentPlain: "",
            selectedText: "",
            createdAt: 1,
            updatedAt: 1,
          });
        else
          await ctx.db.insert("reflections", {
            userId: f.userId,
            articleId: f.articleId,
            strongestPoint: "",
            weakestAssumption: "",
            credibleCounterview: "",
            questionForYou: "",
            respondedAt: 1,
            createdAt: 1,
          });
      }
    });
  // Test-only completed state to exercise the production proof refusal, NOT a
  // production stress-ready flag or a claim that this baseline can activate.
  await f.t.run((ctx) =>
    ctx.db.insert("legacyReportingState", {
      userId: f.userId,
      kind,
      ready: false,
      overflow: 0,
      cursor: null,
      backfilled: true,
    }),
  );
  expect(await f.activate(kind)).toBe(false);
  const large = await fixture();
  for (let i = 0; i < 18; i++)
    await large.add(kind, Date.now() - 1, "界".repeat(330_000));
  const migration = await large.t.run(async (ctx) => ({
    value: await ctx.runMutation(internal.legacyReportingMetadata.migrate, {
      userId: large.userId,
      kind,
    }),
    metrics: await ctx.meta.getTransactionMetrics(),
  }));
  expect(migration.value).toMatchObject({ done: false, migrated: 1 });
  expect(migration.metrics.bytesRead.used).toBeLessThan(4 * 1024 * 1024);
  expect(migration.metrics.bytesWritten.used).toBeLessThan(2000);
  expect(migration.metrics.documentsWritten.used).toBe(2); // projection + state, not canonical prose
  if (process.env.LEGACY_OPERATOR_EVIDENCE)
    appendFileSync(
      process.env.LEGACY_OPERATOR_EVIDENCE,
      `${JSON.stringify({ kind, oneRowMigration: migration })}\n`,
    );
  await large.finish(kind);
  const result = await large.t.run(async (ctx) => ({
    value: await ctx.runMutation(
      internal.legacyReportingMetadata.verifyAndActivate,
      { userId: large.userId, kind },
    ),
    metrics: await ctx.meta.getTransactionMetrics(),
  }));
  expect(result.value).toBe(false);
  expect(result.metrics.bytesRead.used).toBeLessThan(12 * 1024 * 1024);
  expect((await large.state(kind))?.ready).toBe(false);
  if (process.env.LEGACY_OPERATOR_EVIDENCE)
    appendFileSync(
      process.env.LEGACY_OPERATOR_EVIDENCE,
      `${JSON.stringify({ kind, canonicalByteCut: result })}\n`,
    );
});

it.each([
  "notes",
  "reflections",
] as const)("keeps exact nonfinite %s dates across generic updates and proof", async (kind) => {
  const f = await fixture();
  await f.add(kind);
  await f.finish(kind);
  for (const date of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    await f.t.run(async (ctx) => {
      const { db } = metadataTriggers.wrapDB(ctx);
      if (kind === "notes") {
        const source = await ctx.db.query("userNotes").first();
        if (!source) throw new Error("Missing note");
        await db.patch(source._id, { createdAt: date });
      } else {
        const source = await ctx.db.query("reflections").first();
        if (!source) throw new Error("Missing reflection");
        await db.patch(source._id, { respondedAt: date });
      }
    });
    expect(await f.activate(kind)).toBe(true);
  }
});

it("bounds oversized metadata too, and never recreates state for absent/deleting libraries", async () => {
  const f = await fixture();
  const longUser = "u".repeat(800_000);
  await f.t.run(async (ctx) => {
    await ctx.db.insert("readers", {
      authId: "long-fixture",
      libraryId: longUser,
      status: "disabled",
      createdAt: 1,
    });
    await ctx.db.insert("legacyReportingState", {
      userId: longUser,
      kind: "notes",
      ready: false,
      overflow: 0,
      cursor: null,
      backfilled: true,
    });
  });
  const noteId = await f.t.run((ctx) =>
    ctx.db.insert("userNotes", {
      userId: "foreign",
      articleId: f.articleId,
      content: "",
      contentPlain: "",
      selectedText: "",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  for (let batch = 0; batch < 4; batch++)
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 5; i++)
        await ctx.db.insert("noteReportingMetadata", {
          userId: longUser,
          noteId,
          articleId: f.articleId,
          sourceCreationTime: 1,
          createdAt: 1,
          nonblank: false,
        });
    });
  const result = await f.t.run(async (ctx) => ({
    value: await ctx.runMutation(
      internal.legacyReportingMetadata.verifyAndActivate,
      { userId: longUser, kind: "notes" },
    ),
    metrics: await ctx.meta.getTransactionMetrics(),
  }));
  expect(result.value).toBe(false);
  expect(result.metrics.bytesRead.used).toBeLessThan(13 * 1024 * 1024);
  if (process.env.LEGACY_OPERATOR_EVIDENCE)
    appendFileSync(
      process.env.LEGACY_OPERATOR_EVIDENCE,
      `${JSON.stringify({ oversizedMetadata: result })}\n`,
    );
  await f.t.run(async (ctx) => {
    const reader = await ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", f.userId))
      .unique();
    if (!reader) throw new Error("Missing reader");
    await ctx.db.patch(reader._id, { deletingAt: 1 });
  });
  for (const userId of [f.userId, "absent"])
    for (const kind of ["notes", "reflections"] as const) {
      expect(
        await f.t.mutation(internal.legacyReportingMetadata.migrate, {
          userId,
          kind,
        }),
      ).toEqual({ done: false, migrated: 0, retained: false });
      expect(
        await f.t.mutation(internal.legacyReportingMetadata.verifyAndActivate, {
          userId,
          kind,
        }),
      ).toBe(false);
    }
  expect(await f.state("notes")).toBeNull();
});
