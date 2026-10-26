/// <reference types="vite/client" />

import { getFunctionName } from "convex/server";
import { getDocumentSize } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadataContext } from "../test/metadata";
import {
  saveTestCredential,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { explainEdge } from "./actions/explainIdeaEdge";
import {
  EDGE_JOIN_MS,
  EDGE_JOIN_READS,
  EDGE_LEASE_MS,
  type EdgeRequest,
  purgeEdgeExplanations,
} from "./lib/edgeExplanations";
import { pairKey } from "./lib/ideaGraph";
import { loadReaderAI } from "./lib/router";
import schema from "./schema";
import { purgeMetadata } from "./vaultFiles";

const model = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("./lib/aiModels", () => ({
  generateObjectWithFallback: model.generate,
}));
const modules = import.meta.glob("./**/*.ts");
const reason = "Both connect attention with the limits of memory.";
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  model.generate.mockReset().mockImplementation(async (options) => ({
    object: { reason },
    modelId: options.targets[0].id,
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture(key = true) {
  const f = await secondReaderTest(modules);
  if (key)
    await saveTestCredential(
      f.t,
      f.readerLibraryId,
      "openrouter",
      "fixture-key",
    );
  const rows = await f.t.run(async (ctx) => {
    const article = (title: string) =>
      ctx.db.insert("articles", {
        userId: f.readerLibraryId,
        title,
        guid: title,
        url: `https://example.com/${title}`,
        content: "Body",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      });
    const articleA = await article("One");
    const articleB = await article("Two");
    const note = (articleId: typeof articleA, text: string) =>
      ctx.db.insert("userNotes", {
        userId: f.readerLibraryId,
        articleId,
        selectedText: "",
        content: text,
        contentPlain: text,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    const a = await note(articleA, "Attention α 😀");
    const b = await note(articleB, "Memory β 😀");
    return { a, b, articleA, articleB };
  });
  const args = { a: `note:${rows.a}`, b: `note:${rows.b}` };
  const request = { ...args, userId: f.readerLibraryId };
  const state = () =>
    f.t.run((ctx) => ctx.db.query("edgeExplanationState").unique());
  const reasons = () => f.t.run((ctx) => ctx.db.query("edgeReasons").collect());
  const claim = async () => {
    const result = await f.t.mutation(internal.ideaEdgeReasons.claim, request);
    if (result.kind === "claimed")
      await bindDispatch(f.t, request, result.generation);
    return result;
  };
  const explain = () =>
    f.reader.action(api.actions.explainIdeaEdge.explain, args);
  const save = async (
    generation?: {
      id: NonNullable<Awaited<ReturnType<typeof state>>>["_id"];
      run: number;
    },
    overrides = {},
  ) => {
    const context = await f.t.query(
      internal.ideaEdgeReasons.edgeContext,
      request,
    );
    if (!context) throw new Error("Missing fixture context");
    return f.t.mutation(internal.ideaEdgeReasons.saveReason, {
      userId: f.readerLibraryId,
      pair: context.pair,
      fingerprint: context.fingerprint,
      model: context.routing.targets[0] ?? "fixture",
      reason,
      generation,
      ...overrides,
    });
  };
  return { ...f, ...rows, args, request, state, reasons, claim, explain, save };
}

function hold() {
  let release = () => {};
  let entered = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  model.generate.mockImplementationOnce((options) => {
    entered();
    return new Promise((resolve) => {
      release = () =>
        resolve({ object: { reason }, modelId: options.targets[0].id });
    });
  });
  return { started, release: () => release() };
}

async function bindDispatch(
  t: ReturnType<typeof convexTest>,
  request: EdgeRequest,
  generation: { id: Id<"edgeExplanationState">; run: number },
) {
  const context = await t.query(internal.ideaEdgeReasons.edgeContext, request);
  if (!context) throw new Error("Missing binding context");
  const runQuery: ActionCtx["runQuery"] = (ref, args) =>
    t.run((ctx) => ctx.runQuery(ref, args));
  const runMutation: ActionCtx["runMutation"] = (ref, args) =>
    t.run((ctx) => ctx.runMutation(ref, args));
  const ai = await loadReaderAI({ runQuery, runMutation }, request.userId);
  return t.mutation(internal.ideaEdgeReasons.dispatchContext, {
    ...request,
    generation,
    snapshot: context.routing.snapshot,
    targets: ai
      .chain("quick")
      .map(({ provider, id, model }) => ({ provider, id, model })),
  });
}

async function setReaderStatus(
  f: Awaited<ReturnType<typeof fixture>>,
  status: "active" | "disabled",
) {
  await f.t.run(async (ctx) => {
    const row = await ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", f.readerLibraryId))
      .unique();
    if (!row) throw new Error("Missing reader");
    await ctx.db.patch(row._id, { status });
  });
}

describe("generated edge single flight", () => {
  it("reader disabled after admission but before dispatch cannot buy model work", async () => {
    const f = await fixture();
    let release = () => {};
    let entered = () => {};
    const enteredRouting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runQuery: ActionCtx["runQuery"] = async (ref, args) => {
      const result = await f.t.run((ctx) => ctx.runQuery(ref, args));
      if (getFunctionName(ref) === "providerCredentials:routing") {
        entered();
        await gate;
      }
      return result;
    };
    const runMutation: ActionCtx["runMutation"] = (ref, args) =>
      f.t.run((ctx) => ctx.runMutation(ref, args));
    const request = explainEdge(
      { readerId: f.readerLibraryId, runQuery, runMutation },
      f.args,
    );
    const failure = expect(request).rejects.toThrow();
    await enteredRouting;
    expect(await f.state()).toMatchObject({ status: "running" });
    await setReaderStatus(f, "disabled");
    release();
    await failure;
    expect(model.generate).not.toHaveBeenCalled();
    expect(await f.reasons()).toEqual([]);
    expect(await f.state()).toMatchObject({ status: "failed", attempts: 1 });
    await expect(f.claim()).rejects.toThrow();
    expect(
      await f.t.query(internal.ideaEdgeReasons.settled, f.request),
    ).toEqual({ kind: "gone" });
  });

  it("disable during a held provider rejects output but retains private metadata; re-enable requires explicit recovery", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
      ctx.db.insert("edgeReasons", {
        userId: f.readerLibraryId,
        pair: pairKey(f.args.a, f.args.b),
        fingerprint: "old",
        reason: "Retained old reason",
        model: "old",
        createdAt: 0,
      }),
    );
    const h = hold();
    const request = f.explain();
    const failure = expect(request).rejects.toThrow();
    await h.started;
    await setReaderStatus(f, "disabled");
    h.release();
    await failure;
    expect(await f.state()).toMatchObject({ status: "failed", attempts: 1 });
    expect((await f.reasons()).map((row) => row.reason)).toEqual([
      "Retained old reason",
    ]);
    expect(model.generate).toHaveBeenCalledTimes(1);
    await expect(
      f.t.run((ctx) => purgeEdgeExplanations(ctx, f.readerLibraryId)),
    ).rejects.toThrow("retained");
    await setReaderStatus(f, "active");
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(await f.explain()).toEqual({
      source: "generated",
      reason,
      cached: false,
    });
    expect(await f.state()).toMatchObject({
      status: "complete",
      attempts: 0,
      run: 2,
    });
    expect(model.generate).toHaveBeenCalledTimes(2);
    await setReaderStatus(f, "disabled");
    expect(
      await f.t.query(internal.ideaEdgeReasons.settled, f.request),
    ).toEqual({ kind: "gone" });
    await expect(f.claim()).rejects.toThrow();
    expect((await f.reasons())[0].reason).toBe(reason);
    expect(await f.state()).toMatchObject({ status: "complete" });
  });

  it("real router skips one unopenable saved credential and the healthy provider still generates and publishes", async () => {
    const f = await fixture(false);
    await saveTestCredential(
      f.t,
      f.readerLibraryId,
      "openai",
      "sealed-working-key",
    );
    await f.t.run((ctx) =>
      ctx.db.insert("providerCredentials", {
        userId: f.readerLibraryId,
        provider: "openrouter",
        ciphertext: "not-sealed",
        iv: "not-an-iv",
        last4: "bad!",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        validatedAt: Date.now(),
      }),
    );
    const runQuery: ActionCtx["runQuery"] = (ref, args) =>
      f.t.run((ctx) => ctx.runQuery(ref, args));
    const runMutation: ActionCtx["runMutation"] = (ref, args) =>
      f.t.run((ctx) => ctx.runMutation(ref, args));
    const ai = await loadReaderAI({ runQuery, runMutation }, f.readerLibraryId);
    expect(ai.providers).toEqual(["openai"]);
    const expected = ai.chain("quick").map((target) => target.id);
    expect(expected.length).toBeGreaterThan(0);
    expect(await f.explain()).toEqual({
      source: "generated",
      reason,
      cached: false,
    });
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(
      model.generate.mock.calls[0][0].targets.map(
        (target: { id: string }) => target.id,
      ),
    ).toEqual(expected);
    expect((await f.reasons())[0]).toMatchObject({
      reason,
      model: expected[0],
    });
  });

  it("all saved credentials unopenable fail truthfully without dispatch or publication", async () => {
    const f = await fixture(false);
    await f.t.run((ctx) =>
      ctx.db.insert("providerCredentials", {
        userId: f.readerLibraryId,
        provider: "openai",
        ciphertext: "not-sealed",
        iv: "not-an-iv",
        last4: "bad!",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        validatedAt: Date.now(),
      }),
    );
    await expect(f.explain()).rejects.toThrow("provider key");
    expect(model.generate).not.toHaveBeenCalled();
    expect(await f.reasons()).toEqual([]);
    expect(await f.state()).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("publication needs a matching persisted actual-chain binding and cannot publish another catalog model", async () => {
    const f = await fixture();
    const claim = await f.t.mutation(internal.ideaEdgeReasons.claim, f.request);
    if (claim.kind !== "claimed") throw new Error("Missing claim");
    expect(await f.save(claim.generation)).toBe(false);
    const context = await f.t.query(
      internal.ideaEdgeReasons.edgeContext,
      f.request,
    );
    if (!context) throw new Error("Missing context");
    const first = context.routing.available[0];
    if (!first) throw new Error("Missing catalog fixture");
    const target = {
      provider: first.provider,
      id: first.id,
      model: first.model,
    };
    expect(
      await f.t.mutation(internal.ideaEdgeReasons.dispatchContext, {
        ...f.request,
        generation: claim.generation,
        snapshot: "stale-snapshot",
        targets: [target],
      }),
    ).toBeNull();
    expect(
      await f.t.mutation(internal.ideaEdgeReasons.dispatchContext, {
        ...f.request,
        generation: claim.generation,
        snapshot: context.routing.snapshot,
        targets: [{ ...target, model: "not-the-catalog-model" }],
      }),
    ).toBeNull();
    await bindDispatch(f.t, f.request, claim.generation);
    const state = await f.state();
    if (!state?.dispatchTargets)
      throw new Error("Missing actual chain binding");
    const outsideChain = context.routing.available.find(
      (candidate) =>
        !state.dispatchTargets?.some((bound) => bound.id === candidate.id),
    );
    if (!outsideChain) throw new Error("Missing outside-chain fixture");
    expect(
      await f.t.mutation(internal.ideaEdgeReasons.dispatchContext, {
        ...f.request,
        generation: claim.generation,
        snapshot: context.routing.snapshot,
        targets: [
          {
            provider: outsideChain.provider,
            id: outsideChain.id,
            model: outsideChain.model,
          },
        ],
      }),
    ).toBeNull();
    expect(await f.save(claim.generation, { model: outsideChain.id })).toBe(
      false,
    );
    expect(await f.save(claim.generation)).toBe(true);
    expect((await f.reasons())[0].reason).toBe(reason);
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("an old action binary cannot ignore a tokenless rejection and report a stale local answer as success", async () => {
    const f = await fixture();
    const h = hold();
    const current = f.explain();
    await h.started;
    // The deployed old binary awaited saveReason, ignored its return value,
    // then returned its local text. A false return is insufficient fencing.
    const oldBinaryCompletion = async () => {
      await f.save(undefined, { reason: "Unaccepted old local answer" });
      return {
        source: "generated",
        reason: "Unaccepted old local answer",
        cached: false,
      };
    };
    await expect(oldBinaryCompletion()).rejects.toThrow("older request");
    expect(await f.reasons()).toEqual([]);
    h.release();
    expect(await current).toEqual({
      source: "generated",
      reason,
      cached: false,
    });
    expect((await f.reasons())[0].reason).toBe(reason);
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it("exact vault key tuples cannot alias through the legacy pair delimiter", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      for (const filePath of ["a|vault:b", "c", "a", "b|vault:c"])
        await ctx.db.insert("noteChunks", {
          userId: f.readerLibraryId,
          filePath,
          fileName: filePath,
          chunkIndex: 0,
          content: "Same passage",
          embedding: [],
          fileHash: "hash",
          indexedAt: Date.now(),
        });
    });
    const one = await f.t.mutation(internal.ideaEdgeReasons.claim, {
      userId: f.readerLibraryId,
      a: "vault:a|vault:b",
      b: "vault:c",
    });
    const two = await f.t.mutation(internal.ideaEdgeReasons.claim, {
      userId: f.readerLibraryId,
      a: "vault:a",
      b: "vault:b|vault:c",
    });
    if (one.kind !== "claimed" || two.kind !== "claimed")
      throw new Error("Missing exact-pair claims");
    expect(one.pair).toBe(two.pair); // Historical policy remains unchanged.
    expect(one.generation.id).not.toBe(two.generation.id);
    expect(one.input).not.toBe(two.input);
  });

  it("new completed cache hits use exact title and full-text identity, unlike unchanged historical policy", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
      ctx.db.patch(f.a, { contentPlain: `${"😀".repeat(650)} A` }),
    );
    await f.explain();
    await f.explain();
    expect(model.generate).toHaveBeenCalledTimes(1);
    await f.t.run((ctx) =>
      ctx.db.patch(f.a, { contentPlain: `${"😀".repeat(650)} B` }),
    );
    await f.explain();
    expect(model.generate).toHaveBeenCalledTimes(2);
    await f.t.run((ctx) =>
      ctx.db.patch(f.articleA, { title: "New exact title" }),
    );
    await f.explain();
    expect(model.generate).toHaveBeenCalledTimes(3);
    expect(await f.reasons()).toHaveLength(1);
  });

  it("a structural connection added during dispatch wins, without leaving a finished provider's claim running", async () => {
    const f = await fixture();
    const h = hold();
    const result = f.explain();
    await h.started;
    const id = await f.t.run((ctx) =>
      ctx.db.insert("ideaLinks", {
        userId: f.readerLibraryId,
        from: f.args.a,
        to: f.args.b,
        createdAt: Date.now(),
      }),
    );
    h.release();
    expect(await result).toEqual({
      source: "structural",
      reasons: [{ type: "linked", text: "You linked these" }],
    });
    expect(await f.state()).toMatchObject({ status: "failed" });
    expect(await f.reasons()).toEqual([]);
    await f.t.run((ctx) => ctx.db.delete(id));
    expect(await f.explain()).toMatchObject({ source: "generated", reason });
    expect(model.generate).toHaveBeenCalledTimes(2);
  });

  it("a lost publication acknowledgement returns the committed actual reason without another paid generation", async () => {
    const f = await fixture();
    const runMutation: ActionCtx["runMutation"] = async (ref, args) => {
      const value = await f.t.run((ctx) => ctx.runMutation(ref, args));
      if (getFunctionName(ref) === "ideaEdgeReasons:saveReason")
        throw new Error("Lost acknowledgement");
      return value;
    };
    const runQuery: ActionCtx["runQuery"] = (ref, args) =>
      f.t.run((ctx) => ctx.runQuery(ref, args));
    const result = await explainEdge(
      { readerId: f.readerLibraryId, runQuery, runMutation },
      f.args,
    );
    expect(result).toEqual({ source: "generated", reason, cached: true });
    expect((await f.reasons())[0].reason).toBe(reason);
    expect(await f.state()).toMatchObject({ status: "complete" });
    await f.explain();
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it("checks the router's actual snapshot and prevents dispatch across a quick-routing ABA", async () => {
    const f = await fixture();
    const runQuery: ActionCtx["runQuery"] = async (ref, args) => {
      if (getFunctionName(ref) !== "providerCredentials:routing")
        return f.t.run((ctx) => ctx.runQuery(ref, args));
      const id = await f.t.run((ctx) =>
        ctx.db.insert("userSettings", {
          userId: f.readerLibraryId,
          quickModel: "openrouter:openai/gpt-4.1-mini",
          updatedAt: Date.now(),
        }),
      );
      const value = await f.t.run((ctx) => ctx.runQuery(ref, args));
      await f.t.run((ctx) => ctx.db.delete(id));
      return value;
    };
    const runMutation: ActionCtx["runMutation"] = (ref, args) =>
      f.t.run((ctx) => ctx.runMutation(ref, args));
    await expect(
      explainEdge(
        { readerId: f.readerLibraryId, runQuery, runMutation },
        f.args,
      ),
    ).rejects.toThrow("setup changed");
    expect(model.generate).not.toHaveBeenCalled();
    expect(await f.state()).toMatchObject({ status: "failed" });
  });

  it("rejects empty or over-budget output without publishing or retrying automatically", async () => {
    const f = await fixture();
    for (const invalid of ["", "word ".repeat(35)]) {
      model.generate.mockImplementationOnce(async (options) => ({
        object: { reason: invalid },
        modelId: options.targets[0].id,
      }));
      await expect(f.explain()).rejects.toThrow("no reason");
    }
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(await f.reasons()).toEqual([]);
  });

  it("persists before dispatch; reversed two-client and duplicate requests share one actual result", async () => {
    const f = await fixture();
    const h = hold();
    const first = f.explain();
    await h.started;
    expect(await f.state()).toMatchObject({
      status: "running",
      run: 1,
      attempts: 1,
    });
    const identity = await f.reader.run((ctx) => ctx.auth.getUserIdentity());
    if (!identity) throw new Error("Missing identity");
    const client = f.t.withIdentity(identity);
    const second = client.action(api.actions.explainIdeaEdge.explain, {
      a: f.args.b,
      b: f.args.a,
    });
    const duplicate = f.explain();
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(2));
    expect(model.generate).toHaveBeenCalledTimes(1);
    h.release();
    expect(await first).toEqual({ source: "generated", reason, cached: false });
    await vi.advanceTimersByTimeAsync(EDGE_JOIN_MS);
    expect(await second).toEqual({ source: "generated", reason, cached: true });
    expect(await duplicate).toEqual({
      source: "generated",
      reason,
      cached: true,
    });
    expect(await f.reasons()).toHaveLength(1);
    expect((await f.reasons())[0].reason).toBe(reason);
    expect(model.generate.mock.calls[0][0]).toMatchObject({
      maxOutputTokens: 160,
    });
    await f.explain();
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it("free structural and legacy cached requests never claim or dispatch, including old title policy", async () => {
    const f = await fixture(false);
    const context = await f.t.query(
      internal.ideaEdgeReasons.edgeContext,
      f.request,
    );
    if (!context) throw new Error("Missing context");
    await f.t.run((ctx) =>
      ctx.db.insert("edgeReasons", {
        userId: f.readerLibraryId,
        pair: context.pair,
        fingerprint: context.fingerprint,
        reason: "Historical reason",
        model: "old-model",
        createdAt: 0,
      }),
    );
    await f.t.run((ctx) =>
      ctx.db.patch(f.articleA, { title: "A different historical title" }),
    );
    expect(await f.explain()).toEqual({
      source: "generated",
      reason: "Historical reason",
      cached: true,
    });
    await f.t.run((ctx) =>
      ctx.db.insert("ideaLinks", {
        userId: f.readerLibraryId,
        from: f.args.a,
        to: f.args.b,
        createdAt: Date.now(),
      }),
    );
    expect((await f.explain()).source).toBe("structural");
    expect(await f.state()).toBeNull();
    expect(model.generate).not.toHaveBeenCalled();
  });

  it.each([
    "text",
    "tail",
    "title",
    "routing",
    "owner",
    "parent-delete",
    "node-delete",
    "library-delete",
  ])("held action rejects stale %s publication and returns no fabricated reason", async (change) => {
    const f = await fixture();
    if (change === "tail")
      await f.t.run((ctx) =>
        ctx.db.patch(f.a, { contentPlain: `${"😀".repeat(650)} A` }),
      );
    const h = hold();
    const first = f.explain();
    const failure = expect(first).rejects.toThrow();
    await h.started;
    await f.t.run(async (ctx) => {
      const db = metadataContext(ctx).db;
      if (change === "text") await db.patch(f.a, { contentPlain: "Changed" });
      if (change === "tail")
        await db.patch(f.a, { contentPlain: `${"😀".repeat(650)} B` });
      if (change === "title") await db.patch(f.articleA, { title: "Changed" });
      if (change === "routing")
        await db.insert("userSettings", {
          userId: f.readerLibraryId,
          quickModel: "openrouter:openai/gpt-4.1-mini",
          updatedAt: Date.now(),
        });
      if (change === "owner")
        await db.patch(f.articleA, { userId: "another-reader" });
      if (change === "parent-delete") await db.delete(f.articleA);
      if (change === "node-delete") await db.delete(f.a);
      if (change === "library-delete") {
        const reader = await db
          .query("readers")
          .withIndex("by_libraryId", (q) =>
            q.eq("libraryId", f.readerLibraryId),
          )
          .unique();
        if (!reader) throw new Error("Missing reader");
        await db.patch(reader._id, { deletingAt: Date.now() });
      }
    });
    h.release();
    await failure;
    expect(await f.reasons()).toEqual([]);
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it("selected vault passages canonicalize with their keys and incompatible passages fence held output", async () => {
    const f = await fixture();
    const chunks = await f.t.run(async (ctx) => {
      const chunk = (content: string, chunkIndex: number) =>
        ctx.db.insert("noteChunks", {
          userId: f.readerLibraryId,
          filePath: "note.md",
          fileName: "note.md",
          chunkIndex,
          content,
          embedding: [],
          fileHash: "hash",
          indexedAt: Date.now(),
        });
      return [
        await chunk("First selected", 0),
        await chunk("Second selected", 1),
      ];
    });
    const request = {
      userId: f.readerLibraryId,
      a: f.args.a,
      b: "vault:note.md",
      bVia: chunks[0],
    };
    const one = await f.t.mutation(internal.ideaEdgeReasons.claim, request);
    expect(one.kind).toBe("claimed");
    expect(
      (
        await f.t.mutation(internal.ideaEdgeReasons.claim, {
          userId: f.readerLibraryId,
          a: request.b,
          aVia: request.bVia,
          b: request.a,
        })
      ).kind,
    ).toBe("join");
    const two = await f.t.mutation(internal.ideaEdgeReasons.claim, {
      ...request,
      bVia: chunks[1],
    });
    if (one.kind !== "claimed" || two.kind !== "claimed")
      throw new Error("Missing claim");
    expect(one.prompt).toContain("First selected");
    expect(two.prompt).toContain("Second selected");
    expect(
      await f.t.mutation(internal.ideaEdgeReasons.saveReason, {
        userId: f.readerLibraryId,
        pair: one.pair,
        fingerprint: one.fingerprint,
        reason,
        model: one.targets[0],
        generation: one.generation,
      }),
    ).toBe(false);
    await bindDispatch(f.t, { ...request, bVia: chunks[1] }, two.generation);
    expect(
      await f.t.mutation(internal.ideaEdgeReasons.saveReason, {
        userId: f.readerLibraryId,
        pair: two.pair,
        fingerprint: two.fingerprint,
        reason,
        model: two.targets[0],
        generation: two.generation,
      }),
    ).toBe(true);
  });

  it("actual selected-passage actions never settle a waiter with another passage's result", async () => {
    const f = await fixture();
    const chunks = await f.t.run(async (ctx) => {
      const add = (content: string, chunkIndex: number) =>
        ctx.db.insert("noteChunks", {
          userId: f.readerLibraryId,
          filePath: "selected.md",
          fileName: "selected.md",
          chunkIndex,
          content,
          embedding: [],
          fileHash: "hash",
          indexedAt: Date.now(),
        });
      return [await add("First passage", 0), await add("Other passage", 1)];
    });
    const args = { a: f.args.a, b: "vault:selected.md", bVia: chunks[0] };
    const h = hold();
    const first = f.reader.action(api.actions.explainIdeaEdge.explain, args);
    const oldFailure = expect(first).rejects.toThrow();
    await h.started;
    const waiter = f.reader.action(api.actions.explainIdeaEdge.explain, {
      a: args.b,
      aVia: args.bVia,
      b: args.a,
    });
    const waiterFailure = expect(waiter).rejects.toThrow();
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(
      await f.reader.action(api.actions.explainIdeaEdge.explain, {
        ...args,
        bVia: chunks[1],
      }),
    ).toMatchObject({ source: "generated", reason });
    h.release();
    await oldFailure;
    await vi.advanceTimersByTimeAsync(EDGE_JOIN_MS);
    await waiterFailure;
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(await f.reasons()).toHaveLength(1);
    expect(model.generate.mock.calls[0][0].prompt).toContain("First passage");
    expect(model.generate.mock.calls[1][0].prompt).toContain("Other passage");
    await f.t.run((ctx) => metadataContext(ctx).db.delete(chunks[1]));
    expect(await f.state()).toBeNull();
    // Deleting a selected chunk does not cold-purge historical/generated rows.
    expect(await f.reasons()).toHaveLength(1);
  });

  it("timeouts never release a held owner or dispatch; explicit lease recovery is finite and old tokens cannot publish", async () => {
    const f = await fixture();
    const h = hold();
    const first = f.explain();
    await h.started;
    const original = await f.state();
    if (!original) throw new Error("Missing state");
    const second = f.explain();
    const timedOut = expect(second).rejects.toThrow("still being generated");
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    for (let i = 1; i < EDGE_JOIN_READS; i++) {
      await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
      await vi.advanceTimersByTimeAsync(EDGE_JOIN_MS);
    }
    await timedOut;
    expect(await f.state()).toEqual(original);
    expect(model.generate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(EDGE_LEASE_MS);
    const recovered = await f.explain();
    expect(recovered).toMatchObject({ source: "generated", reason });
    h.release();
    expect(await first).toMatchObject({
      source: "generated",
      reason,
      cached: true,
    });
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(
      await f.save(
        { id: original._id, run: original.run },
        { reason: "Stale callback" },
      ),
    ).toBe(false);
    expect((await f.reasons())[0].reason).toBe(reason);
  });

  it("missing provider and failures require explicit recovery, cap attempts, and retain useful old rows", async () => {
    const missing = await fixture(false);
    await expect(missing.explain()).rejects.toThrow();
    expect(await missing.state()).toMatchObject({
      status: "failed",
      attempts: 1,
    });
    expect(model.generate).not.toHaveBeenCalled();
    const f = await fixture();
    await f.t.run((ctx) =>
      ctx.db.insert("edgeReasons", {
        userId: f.readerLibraryId,
        pair: pairKey(f.args.a, f.args.b),
        fingerprint: "outdated",
        reason: "Old useful reason",
        model: "old",
        createdAt: 0,
      }),
    );
    model.generate.mockRejectedValue(new Error("fixture failure"));
    for (let n = 0; n < 3; n++)
      await expect(f.explain()).rejects.toThrow("fixture failure");
    await expect(f.explain()).rejects.toThrow("attempt limit");
    expect(model.generate).toHaveBeenCalledTimes(3);
    expect((await f.reasons())[0].reason).toBe("Old useful reason");
  });

  it("rejects mixed-version tokenless callbacks, wrong owner/pair and deleted claim resurrection", async () => {
    const f = await fixture();
    const claim = await f.claim();
    if (claim.kind !== "claimed") throw new Error("Missing claim");
    await expect(f.save()).rejects.toThrow("older request");
    expect(await f.save(claim.generation, { userId: "other" })).toBe(false);
    expect(await f.save(claim.generation, { pair: "other" })).toBe(false);
    await f.t.run((ctx) => ctx.db.delete(claim.generation.id));
    const next = await f.claim();
    if (next.kind !== "claimed") throw new Error("Missing claim");
    expect(next.generation.id).not.toBe(claim.generation.id);
    expect(
      await f.t.mutation(internal.ideaEdgeReasons.saveReason, {
        userId: f.readerLibraryId,
        pair: claim.pair,
        fingerprint: claim.fingerprint,
        model: claim.targets[0],
        reason,
        generation: claim.generation,
      }),
    ).toBe(false);
    expect(await f.save(next.generation)).toBe(true);
    await expect(f.save()).rejects.toThrow("older request");
    expect(await f.reasons()).toHaveLength(1);
  });

  it("source ABA exact equality is allowed unless an intervening admission superseded the run", async () => {
    const f = await fixture();
    const a = await f.claim();
    if (a.kind !== "claimed") throw new Error("Missing claim");
    await f.t.run((ctx) => ctx.db.patch(f.a, { contentPlain: "B" }));
    const b = await f.claim();
    if (b.kind !== "claimed") throw new Error("Missing claim");
    await f.t.run((ctx) =>
      ctx.db.patch(f.a, { contentPlain: "Attention α 😀" }),
    );
    expect(await f.save(a.generation)).toBe(false);
    const again = await f.claim();
    if (again.kind !== "claimed") throw new Error("Missing claim");
    expect(again.input).toBe(a.input);
    expect(again.generation.run).toBeGreaterThan(b.generation.run);
    // No admission during this round-trip: current exact semantic equality wins.
    await f.t.run((ctx) => ctx.db.patch(f.a, { contentPlain: "B again" }));
    await f.t.run((ctx) =>
      ctx.db.patch(f.a, { contentPlain: "Attention α 😀" }),
    );
    expect(await f.save(again.generation)).toBe(true);
  });

  it("retained disabled libraries reject held publication without purging claims; absent libraries permit bounded cleanup", async () => {
    const f = await fixture();
    const claim = await f.claim();
    if (claim.kind !== "claimed") throw new Error("Missing claim");
    await f.t.run(async (ctx) => {
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.readerLibraryId))
        .unique();
      if (!reader) throw new Error("Missing reader");
      await ctx.db.patch(reader._id, { status: "disabled" });
    });
    expect(
      await f.t.mutation(internal.ideaEdgeReasons.saveReason, {
        userId: f.readerLibraryId,
        pair: claim.pair,
        fingerprint: claim.fingerprint,
        model: claim.targets[0],
        reason,
        generation: claim.generation,
      }),
    ).toBe(false);
    expect(await f.reasons()).toEqual([]);
    expect(await f.state()).toMatchObject({ status: "running" });
    await expect(
      f.t.run((ctx) => purgeEdgeExplanations(ctx, f.readerLibraryId)),
    ).rejects.toThrow("retained");
    await f.t.run(async (ctx) => {
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.readerLibraryId))
        .unique();
      if (!reader) throw new Error("Missing reader");
      await ctx.db.delete(reader._id);
    });
    expect(
      await f.t.mutation(internal.ideaEdgeReasons.saveReason, {
        userId: f.readerLibraryId,
        pair: claim.pair,
        fingerprint: claim.fingerprint,
        model: claim.targets[0],
        reason,
        generation: claim.generation,
      }),
    ).toBe(false);
    expect(
      await f.t.run((ctx) => purgeEdgeExplanations(ctx, f.readerLibraryId)),
    ).toBe(1);
    expect(
      await f.t.run((ctx) => purgeEdgeExplanations(ctx, f.readerLibraryId)),
    ).toBe(0);
  });

  it("near-limit sources with installed triggers yield compact claims under native limits", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    await saveTestCredential(
      t,
      "default_user",
      "openrouter",
      "fixture-physical-key",
    );
    const args = await t.run(async (ctx) => {
      const db = metadataContext(ctx).db;
      const add = (title: string) =>
        db.insert("articles", {
          userId: "default_user",
          title,
          guid: title,
          url: `https://example.com/${title}`,
          content: "😀".repeat(220_000),
          excerpt: "😀".repeat(10_000),
          extractionStatus: "extracted",
          annotationStatus: "annotated",
          createdAt: Date.now(),
        });
      return {
        userId: "default_user",
        a: `article:${await add("One")}`,
        b: `article:${await add("Two")}`,
      };
    });
    const claim = await t.mutation(internal.ideaEdgeReasons.claim, args);
    expect(claim.kind).toBe("claimed");
    const state = await t.run((ctx) =>
      ctx.db.query("edgeExplanationState").unique(),
    );
    if (!state) throw new Error("Missing state");
    expect(getDocumentSize(state)).toBeLessThan(2048);
    console.info("B06 physical claim bytes", getDocumentSize(state));
    if (claim.kind !== "claimed") throw new Error("Missing physical claim");
    await bindDispatch(t, args, claim.generation);
    const bound = await t.run((ctx) => ctx.db.get(claim.generation.id));
    if (!bound?.dispatchTargets?.length)
      throw new Error("Missing physical binding");
    expect(getDocumentSize(bound)).toBeLessThan(2048);
    console.info("B06 physical bound claim bytes", getDocumentSize(bound));
    expect(
      await t.mutation(internal.ideaEdgeReasons.saveReason, {
        userId: args.userId,
        pair: claim.pair,
        fingerprint: claim.fingerprint,
        generation: claim.generation,
        model: bound.dispatchTargets[0].id,
        reason,
      }),
    ).toBe(true);
  });

  it("installed node cleanup drains more than one batch without purging unrelated claims or legacy cache rows", async () => {
    const f = await fixture();
    const claim = await f.claim();
    if (claim.kind !== "claimed") throw new Error("Missing claim");
    await f.t.run(async (ctx) => {
      const row = await ctx.db.get(claim.generation.id);
      if (!row) throw new Error("Missing state");
      const { _id, _creationTime, ...fields } = row;
      for (let n = 0; n < 34; n++)
        await ctx.db.insert("edgeExplanationState", {
          ...fields,
          pair: `${fields.pair}-${n}`,
        });
      await ctx.db.insert("edgeExplanationState", {
        ...fields,
        pair: "unrelated",
        a: "note:unrelated-a",
        b: "note:unrelated-b",
        aArticleId: undefined,
        bArticleId: undefined,
      });
      await ctx.db.insert("edgeReasons", {
        userId: f.readerLibraryId,
        pair: claim.pair,
        fingerprint: "historical",
        reason: "Historical",
        model: "old",
        createdAt: 0,
      });
    });
    await f.t.run((ctx) => metadataContext(ctx).db.delete(f.a));
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      await f.t.run((ctx) => ctx.db.query("edgeExplanationState").collect()),
    ).toMatchObject([{ pair: "unrelated" }]);
    expect((await f.reasons())[0].reason).toBe("Historical");
  });

  it("compact account purge leaves the native single pagination slot available even when empty", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const result = await t.run(async (ctx) => {
      await ctx.db.insert("vaultFiles", {
        userId: "gone-library",
        filePath: "kept.md",
        fileHash: "hash",
      });
      expect(await purgeEdgeExplanations(ctx, "gone-library")).toBe(0);
      return purgeMetadata(ctx, "gone-library");
    });
    expect(result).toBe(1);
  });
});
