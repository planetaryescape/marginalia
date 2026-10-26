/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { metadataTriggers } from "./lib/metadataTriggers";
import {
  migrateTagVectors,
  syncTagVectors,
  vectorState,
} from "./lib/tagVectors";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const userId = "default_user";
async function fixture(count = 70, owner = userId) {
  const t = convexTest({ schema, modules, transactionLimits: true });
  if (owner !== userId)
    await t.run((ctx) =>
      ctx.db.insert("readers", {
        libraryId: owner,
        authId: owner,
        email: `${owner}@example.com`,
        status: "disabled",
        createdAt: 0,
      }),
    );
  const ids = await t.run(async (ctx) => {
    const ids = [];
    for (let i = 0; i < count; i++)
      ids.push(
        await ctx.db.insert("tags", {
          userId: owner,
          key: `tag${String(i).padStart(3, "0")}`,
          name: `Tag ${i}`,
          aliases: [],
          embedding: [1, 0],
          count: 0,
          status: "active",
          createdAt: i,
        }),
      );
    return ids;
  });
  for (let i = 0; i <= count; i++)
    await t.run((ctx) => migrateTagVectors(ctx, owner));
  const begin = async (expectedRun = 0) => {
    const state = await t.run((ctx) => vectorState(ctx, owner));
    if (!state) return null;
    return t.mutation(internal.tags.beginVectorProof, {
      userId: owner,
      expectedStateId: state._id,
      expectedRun,
    });
  };
  const step = (proof: { token: string; step: number }) =>
    t.mutation(internal.tags.stepVectorProof, {
      userId: owner,
      token: proof.token,
      expectedStep: proof.step,
    });
  const complete = async (run = 0) => {
    let proof = await begin(run);
    for (
      let i = 0;
      i < 100 &&
      proof &&
      proof.phase !== "complete" &&
      proof.phase !== "failed";
      i++
    )
      proof = await step(proof);
    return proof;
  };
  return { t, ids, begin, step, complete };
}

describe("production paged vector proof", () => {
  it.each([
    "retained-one",
    "retained-two",
  ])("activates 81 canonical rows for disabled retained %s without rewriting them", async (owner) => {
    const f = await fixture(81, owner);
    const before = await f.t.run((ctx) => ctx.db.query("tags").collect());
    expect((await f.complete())?.phase).toBe("complete");
    expect(await f.t.run((ctx) => ctx.db.query("tags").collect())).toEqual(
      before,
    );
    expect(
      await f.t.mutation(internal.tags.verifyAndActivateVectors, {
        userId: owner,
      }),
    ).toBe(true);
  });

  it("observes missing epoch as initial, including populated state; token and step retries never reset/recreate", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const s = await vectorState(ctx, userId);
      if (s) await ctx.db.patch(s._id, { epoch: undefined });
    });
    const first = await f.begin();
    expect(first).not.toBeNull();
    if (!first) throw new Error("No proof");
    expect(await f.begin()).toBeNull();
    expect(
      await f.t.mutation(internal.tags.verifyAndActivateVectors, { userId }),
    ).toBe(false);
    const next = await f.step(first);
    expect(next?.step).toBe(1);
    expect(await f.step(first)).toBeNull();
    expect(
      await f.t.query(internal.tags.vectorProofStatus, { userId }),
    ).toEqual({
      stateId: first.stateId,
      run: 1,
      proof: next,
      ready: false,
      changed: false,
    });
    const restarted = await f.begin(1);
    expect(restarted?.token).not.toBe(first.token);
    if (!next) throw new Error("No next proof");
    expect(await f.step(next)).toBeNull();
    expect((await f.complete(2))?.phase).toBe("complete");
    const state = await f.t.run((ctx) => vectorState(ctx, userId));
    if (!state?.proof) throw new Error("No completed state");
    expect(
      await f.step({
        token: `${state._id}:${state.proof.run}`,
        step: state.proof.step,
      }),
    ).toBeNull();
    expect(await f.begin(2)).toBeNull();
    await f.t.run((ctx) => ctx.db.delete(state._id));
    expect(await f.step(first)).toBeNull();
    expect(await f.begin()).toBeNull();
  });

  it.each([
    "insert",
    "delete",
    "owner",
    "key",
    "vector",
    "vector ABA",
    "eligibility ABA",
    "behind cursor",
  ])("invalidates on %s between transactions, requiring explicit restart", async (kind) => {
    const f = await fixture();
    const first = await f.begin();
    if (!first) throw new Error("No proof");
    const next = await f.step(first);
    if (!next) throw new Error("No next proof");
    await f.t.run(async (ctx) => {
      const db = metadataTriggers.wrapDB(ctx).db;
      const id = f.ids[kind === "behind cursor" ? 69 : 0];
      switch (kind) {
        case "insert":
          await db.insert("tags", {
            userId,
            key: "aaa",
            name: "Inserted",
            aliases: [],
            count: 0,
            status: "active",
            createdAt: 0,
          });
          break;
        case "delete":
          await db.delete(id);
          break;
        case "owner":
          await db.patch(id, { userId: "missing-owner" });
          break;
        case "key":
          await db.patch(id, { key: "renamed" });
          break;
        case "behind cursor":
          await db.patch(id, { key: "aaa" });
          break;
        case "vector":
          await db.patch(id, { embedding: [0, 1] });
          break;
        case "vector ABA":
          await db.patch(id, { embedding: [0, 1] });
          await db.patch(id, { embedding: [1, 0] });
          break;
        case "eligibility ABA":
          await db.patch(id, { aliases: ["x".repeat(70_000)] });
          await db.patch(id, { aliases: [] });
          break;
      }
    });
    expect((await f.step(next))?.phase).toBe("failed");
    expect(
      await f.t.query(internal.tags.vectorProofStatus, { userId }),
    ).toMatchObject({ ready: false, changed: true });
    expect(await f.step(next)).toBeNull();
    expect(
      await f.t.mutation(internal.tags.verifyAndActivateVectors, { userId }),
    ).toBe(false);
    expect((await f.complete(1))?.phase).toBe("complete");
  });

  it("allows safe count/status/nearest writes with zero vector/source/state IO and safe alias changes", async () => {
    const f = await fixture();
    const first = await f.begin();
    if (!first) throw new Error("No proof");
    const next = await f.step(first);
    if (!next) throw new Error("No next proof");
    const state = await f.t.run((ctx) => vectorState(ctx, userId));
    await f.t.run(async (ctx) => {
      const tag = await ctx.db.get(f.ids[0]);
      if (!tag) throw new Error("Missing tag");
      const noIO = new Proxy(ctx.db, {
        get() {
          throw new Error("Count/status/nearest must not access vector IO");
        },
      });
      await syncTagVectors({ ...ctx, db: noIO }, tag, {
        ...tag,
        count: 9,
        status: "candidate",
        nearestTagId: f.ids[1],
      });
      await metadataTriggers.wrapDB(ctx).db.patch(f.ids[0], {
        count: 9,
        status: "candidate",
        nearestTagId: f.ids[1],
      });
    });
    expect(await f.t.run((ctx) => vectorState(ctx, userId))).toEqual(state);
    await f.t.run((ctx) =>
      metadataTriggers.wrapDB(ctx).db.patch(f.ids[0], { aliases: ["safe"] }),
    );
    let proof = await f.step(next);
    for (
      let i = 0;
      i < 100 &&
      proof &&
      proof.phase !== "complete" &&
      proof.phase !== "failed";
      i++
    )
      proof = await f.step(proof);
    expect(proof?.phase).toBe("complete");
  });

  it.each([
    "vectors",
    "sources",
  ])("keeps the epoch gate through the %s final phase", async (phase) => {
    const f = await fixture();
    let proof = await f.begin();
    for (let i = 0; i < 100 && proof && proof.phase !== phase; i++)
      proof = await f.step(proof);
    expect(proof?.phase).toBe(phase);
    if (!proof) throw new Error("Missing final proof");
    await f.t.run(async (ctx) => {
      const db = metadataTriggers.wrapDB(ctx).db;
      await db.patch(f.ids[0], { embedding: [0, 1] });
      await db.patch(f.ids[0], { embedding: [1, 0] });
    });
    expect((await f.step(proof))?.phase).toBe("failed");
  });

  it("binds tokens to state identity and library even after purge/recreation", async () => {
    const f = await fixture(1);
    const first = await f.begin();
    if (!first) throw new Error("Missing proof");
    expect(
      await f.t.mutation(internal.tags.stepVectorProof, {
        userId: "another",
        token: first.token,
        expectedStep: 0,
      }),
    ).toBeNull();
    await f.t.run(async (ctx) => {
      const state = await vectorState(ctx, userId);
      if (!state) throw new Error("Missing state");
      const { _id, _creationTime, proof, ...fields } = state;
      await ctx.db.delete(_id);
      await ctx.db.insert("tagVectorState", fields);
    });
    const recreated = await f.begin();
    expect(recreated?.token).not.toBe(first.token);
    expect(await f.step(first)).toBeNull();
    expect(
      await f.t.mutation(internal.tags.beginVectorProof, {
        userId,
        expectedStateId: first.stateId,
        expectedRun: 0,
      }),
    ).toBeNull();
  });

  it("refuses epoch/run exhaustion without wraparound or partial canonical writes", async () => {
    const f = await fixture(1);
    await f.t.run(async (ctx) => {
      const state = await vectorState(ctx, userId);
      if (state)
        await ctx.db.patch(state._id, { epoch: Number.MAX_SAFE_INTEGER });
    });
    await expect(
      f.t.run((ctx) =>
        metadataTriggers.wrapDB(ctx).db.patch(f.ids[0], { embedding: [0, 1] }),
      ),
    ).rejects.toThrow("epoch exhausted");
    expect((await f.t.run((ctx) => ctx.db.get(f.ids[0])))?.embedding).toEqual([
      1, 0,
    ]);
    const first = await f.begin();
    if (!first) throw new Error("Missing proof");
    await f.t.run(async (ctx) => {
      const state = await vectorState(ctx, userId);
      if (state?.proof)
        await ctx.db.patch(state._id, {
          proof: { ...state.proof, run: Number.MAX_SAFE_INTEGER },
        });
    });
    expect(await f.begin(Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it.each([
    "missing vector",
    "missing source",
    "extra vector",
    "extra source",
    "duplicate vector",
    "duplicate source",
    "foreign vector",
    "foreign source",
    "stale vector",
    "corrupt vector",
    "corrupt source",
  ])("refuses actual %s rather than trusting count", async (kind) => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const row = await ctx.db.query("tagVectors").first();
      const source = await ctx.db.query("tagVectorSources").first();
      if (!row || !source) throw new Error("Missing fixture");
      const { _id, _creationTime, ...vector } = row;
      const { _id: sid, _creationTime: stime, ...fields } = source;
      if (kind === "missing vector") await ctx.db.delete(row._id);
      if (kind === "missing source") await ctx.db.delete(source._id);
      if (kind === "duplicate vector")
        await ctx.db.insert("tagVectors", vector);
      if (kind === "duplicate source")
        await ctx.db.insert("tagVectorSources", fields);
      if (kind === "extra vector")
        await ctx.db.insert("tagVectors", {
          ...vector,
          tagId: await ctx.db.insert("tags", {
            userId: "foreign",
            key: "foreign",
            name: "Foreign",
            aliases: [],
            count: 0,
            status: "active",
            createdAt: 0,
          }),
        });
      if (kind === "extra source")
        await ctx.db.insert("tagVectorSources", {
          ...fields,
          tagId: await ctx.db.insert("tags", {
            userId: "foreign",
            key: "foreign",
            name: "Foreign",
            aliases: [],
            count: 0,
            status: "active",
            createdAt: 0,
          }),
        });
      if (kind === "foreign vector")
        await ctx.db.patch(row._id, { userId: "foreign" });
      if (kind === "foreign source")
        await ctx.db.patch(source._id, { userId: "foreign" });
      if (kind === "stale vector")
        await ctx.db.patch(row._id, { sourceCreationTime: -1 });
      if (kind === "corrupt vector")
        await ctx.db.patch(row._id, { embedding: [0, 1] });
      if (kind === "corrupt source")
        await ctx.db.patch(source._id, { vectorBytes: -1 });
    });
    expect((await f.complete())?.phase).toBe("failed");
    expect((await f.t.run((ctx) => vectorState(ctx, userId)))?.ready).toBe(
      false,
    );
  });

  it.each([
    "count",
    "bytes",
    "overflow",
    "epoch",
  ])("refuses unsupported %s before any proof", async (kind) => {
    const f = await fixture(1);
    await f.t.run(async (ctx) => {
      const state = await vectorState(ctx, userId);
      if (!state) throw new Error("Missing fixture");
      await ctx.db.patch(
        state._id,
        kind === "count"
          ? { count: 769 }
          : kind === "bytes"
            ? { vectorBytes: 8_000_001 }
            : kind === "overflow"
              ? { overflow: 1 }
              : { epoch: Number.NaN },
      );
    });
    expect(await f.begin()).toBeNull();
  });

  it.each([
    "vector",
    "source",
    "canonical",
  ])("refuses physically large malformed %s within the proof reserve", async (kind) => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      if (kind === "canonical")
        await ctx.db.patch(f.ids[0], { description: "x".repeat(900_000) });
      else if (kind === "vector") {
        const row = await ctx.db.query("tagVectors").first();
        if (row) await ctx.db.patch(row._id, { key: "x".repeat(900_000) });
      } else {
        const source = await ctx.db.query("tagVectorSources").first();
        if (source)
          await ctx.db.patch(source._id, { userId: "x".repeat(900_000) });
      }
    });
    const proof = await f.begin();
    if (!proof) throw new Error("Missing proof");
    const measured = await f.t.run(async (ctx) => ({
      result: await ctx.runMutation(internal.tags.stepVectorProof, {
        userId,
        token: proof.token,
        expectedStep: proof.step,
      }),
      metrics: await ctx.meta.getTransactionMetrics(),
    }));
    expect(measured.result?.phase).toBe("failed");
    expect(measured.metrics.bytesRead.used).toBeLessThan(8_000_000);
  });

  it("denies absent/deleting owners and in-flight deletion; empty proof takes three distinct one-paginate steps", async () => {
    const f = await fixture(0, "retained");
    let proof = await f.begin();
    expect(proof?.phase).toBe("canonical");
    for (const phase of ["vectors", "sources", "complete"]) {
      if (!proof) throw new Error("No proof");
      proof = await f.step(proof);
      expect(proof?.phase).toBe(phase);
    }
    const restarted = await f.begin(1);
    if (!restarted) throw new Error("No restart");
    await f.t.run(async (ctx) => {
      const reader = await ctx.db.query("readers").first();
      if (reader) await ctx.db.patch(reader._id, { deletingAt: 1 });
    });
    expect(await f.step(restarted)).toBeNull();
    expect(await f.begin(2)).toBeNull();
    expect(
      await f.t.mutation(internal.tags.beginVectorProof, {
        userId: "absent",
        expectedStateId: restarted.stateId,
        expectedRun: 0,
      }),
    ).toBeNull();
  });
});
