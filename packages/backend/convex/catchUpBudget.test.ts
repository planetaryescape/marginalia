/// <reference types="vite/client" />
import { Triggers } from "convex-helpers/server/triggers";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveTestCredential } from "../test/owner";
import type { DataModel, Id } from "./_generated/dataModel";
import { setAnnotationStatus } from "./articles";
import {
  advanceCatchUp,
  BATCH_DELAY_MS,
  JOB_STAGGER_MS,
  PAGE,
} from "./catchUp";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const USER = "default_user";
const vector = Array.from({ length: 1536 }, () => 0.25);
const triggers = new Triggers<DataModel>();
// The supported registration itself adds old/new full-document reads, even
// when the registered handler writes no metadata. No unreleased API is needed.
triggers.register("articles", async () => {});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture(phase: number) {
  const t = convexTest({ schema, modules, transactionLimits: true });
  await saveTestCredential(t, USER, "openrouter", "fixture-budget-key");
  await t.run(async (ctx) => {
    await ctx.db.insert("catchUpState", {
      userId: USER,
      running: true,
      runId: 1,
      embed: true,
      phase,
      articlesQueued: 0,
      itemsQueued: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("readingQueueStats", {
      userId: USER,
      annotated: 0,
      waiting: 0,
      pending: 0,
      fits5: 0,
      fits10: 0,
      fits20: 0,
      ready: true,
    });
  });
  return t;
}

type Test = Awaited<ReturnType<typeof fixture>>;

async function article(t: Test, guid: string, content: string) {
  return t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: USER,
      guid,
      url: `https://example.com/${guid}`,
      title: guid,
      content,
      extractionStatus: "extracted",
      annotationStatus: "skipped",
      skipReason: "no_provider",
      queueCounted: true,
      wordCount: 100,
      estimatedReadMinutes: 1,
      createdAt: Date.now(),
    }),
  );
}

const state = (t: Test) =>
  t.run((ctx) => ctx.db.query("catchUpState").unique());
const jobs = (t: Test) =>
  t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(200));
const step = (t: Test) =>
  t.mutation((ctx) =>
    advanceCatchUp(triggers.wrapDB(ctx), { userId: USER, runId: 1 }),
  );

describe("catch-up transaction-wide body budgets", () => {
  it("resumes 990 kB multilingual articles under real wrapped-writer transaction limits", async () => {
    const t = await fixture(5);
    const ids: Id<"articles">[] = [];
    // Characters are not bytes: each of these valid documents has 990 kB of text.
    for (let i = 0; i < 3; i++)
      ids.push(await article(t, `large-${i}`, "界".repeat(330_000)));
    // Characterize the failure a fixed PAGE/count guard would allow. A status
    // change patches twice; native and trigger full-body reads exceed 16 MiB.
    await expect(
      t.mutation(async (ctx) => {
        const wrapped = triggers.wrapDB(ctx);
        for (const id of ids) await setAnnotationStatus(wrapped, id, "pending");
      }),
    ).rejects.toThrow(/Read too much data/);
    for (const id of ids)
      expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
        annotationStatus: "skipped",
      });

    for (let i = 0; i < ids.length; i++) {
      await step(t);
      expect(await state(t)).toMatchObject({
        articlesQueued: i + 1,
        itemsQueued: 0,
      });
      expect(await t.run((ctx) => ctx.db.get(ids[i]))).toMatchObject({
        annotationStatus: "pending",
      });
      if (i + 1 < ids.length)
        expect(await t.run((ctx) => ctx.db.get(ids[i + 1]))).toMatchObject({
          annotationStatus: "skipped",
        });
      const continuation = (await jobs(t))
        .filter((job) => job.name === "catchUp:step")
        .at(-1);
      expect(continuation?.scheduledTime).toBe(Date.now() + BATCH_DELAY_MS);
    }
    await step(t);
    expect(await state(t)).toMatchObject({ running: false, articlesQueued: 3 });
    const annotations = (await jobs(t)).filter((job) =>
      job.name.includes("generateForArticle"),
    );
    expect(annotations).toHaveLength(3);
    expect(new Set(annotations.map((job) => job.args[0].articleId)).size).toBe(
      3,
    );
  });

  it("keeps PAGE, staggering, batch delay and one spend for ordinary small articles", async () => {
    const t = await fixture(5);
    for (let i = 0; i < PAGE + 1; i++)
      await article(t, `small-${i}`, "Small readable content");
    await step(t);
    expect(await state(t)).toMatchObject({ articlesQueued: PAGE });
    const scheduled = await jobs(t);
    const annotations = scheduled.filter((job) =>
      job.name.includes("generateForArticle"),
    );
    expect(annotations).toHaveLength(PAGE);
    expect(annotations.map((job) => job.scheduledTime - Date.now())).toEqual(
      Array.from({ length: PAGE }, (_, i) => i * JOB_STAGGER_MS),
    );
    expect(
      scheduled.find((job) => job.name === "catchUp:step")?.scheduledTime,
    ).toBe(Date.now() + BATCH_DELAY_MS);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("readerLimits")
          .withIndex("by_userId_and_bucket", (q) =>
            q.eq("userId", USER).eq("bucket", "catchUp"),
          )
          .unique(),
      ),
    ).toMatchObject({ count: 1 });
  });

  it("carries prior phase reads into the annotation write budget and retries the unaccepted candidate", async () => {
    const t = await fixture(1);
    const id = await article(t, "after-notes", "界".repeat(330_000));
    for (let i = 0; i < 8; i++)
      await t.run((ctx) =>
        ctx.db.insert("userNotes", {
          userId: USER,
          articleId: id,
          selectedText: "Words",
          content: "",
          contentPlain: "界".repeat(320_000),
          embedding: vector,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );
    await step(t);
    expect(await state(t)).toMatchObject({
      phase: 5,
      articlesQueued: 0,
      itemsQueued: 0,
    });
    expect((await state(t))?.cursor).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      annotationStatus: "skipped",
    });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("readerLimits")
          .withIndex("by_userId_and_bucket", (q) =>
            q.eq("userId", USER).eq("bucket", "catchUp"),
          )
          .unique(),
      ),
    ).toBeNull();
    expect(
      (await jobs(t)).filter((job) => job.name === "catchUp:step").at(-1)
        ?.scheduledTime,
    ).toBe(Date.now());
    await step(t);
    expect(await state(t)).toMatchObject({ articlesQueued: 1 });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      annotationStatus: "pending",
    });
  });

  it("bounds cumulative read-only scans across pages and phases, then resumes without spending", async () => {
    const t = await fixture(1);
    const text = "界".repeat(320_000);
    const sourceId = await article(t, "source", "Readable");
    await t.run((ctx) =>
      ctx.db.patch(sourceId, {
        annotationStatus: "annotated",
        skipReason: undefined,
      }),
    );
    for (let i = 0; i < 20; i++)
      await t.run((ctx) =>
        ctx.db.insert("userNotes", {
          userId: USER,
          articleId: sourceId,
          selectedText: "Words",
          content: "",
          contentPlain: text,
          embedding: vector,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );
    for (let i = 0; i < 20; i++)
      await t.run((ctx) =>
        ctx.db.insert("highlights", {
          userId: USER,
          articleId: sourceId,
          kind: "highlight",
          text,
          embedding: vector,
          createdAt: Date.now(),
        }),
      );
    await step(t);
    expect(await state(t)).toMatchObject({
      running: true,
      phase: 1,
      articlesQueued: 0,
      itemsQueued: 0,
    });
    expect((await state(t))?.cursor).toBeDefined();
    expect(
      (await jobs(t)).filter((job) => job.name === "catchUp:step").at(-1)
        ?.scheduledTime,
    ).toBe(Date.now());
    for (let i = 0; i < 5 && (await state(t))?.running; i++) await step(t);
    expect(await state(t)).toMatchObject({
      running: false,
      itemsQueued: 0,
      articlesQueued: 0,
    });
    // The 40 large, already-indexed activity rows consumed resumable read
    // budget, not embedding jobs or spend.
    expect(
      (await jobs(t)).filter((job) => job.name.includes("embed")),
    ).toHaveLength(0);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("readerLimits")
          .withIndex("by_userId_and_bucket", (q) =>
            q.eq("userId", USER).eq("bucket", "catchUp"),
          )
          .unique(),
      ),
    ).toBeNull();
  });
});
