/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadataContext } from "../test/metadata";
import {
  saveTestCredential,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { api, internal } from "./_generated/api";
import { purgeFullSummaries, SUMMARY_LEASE_MS } from "./lib/fullSummaries";
import { sourceHash } from "./lib/preparedRepresentation";
import schema from "./schema";

const model = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("./lib/aiModels", () => ({
  generateObjectWithFallback: model.generate,
}));
const modules = import.meta.glob("./**/*.ts");
const output = {
  modelId: "fixture",
  object: {
    gist: "Current gist",
    thesis: "Current thesis",
    flow: "Current flow",
    ideas: [
      {
        id: "a",
        label: "A",
        detail: "Detail",
        role: "claim",
        paragraphs: [-10, 2, 999],
      },
    ],
    links: [],
  },
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  model.generate.mockReset().mockResolvedValue(output);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture(key = true, content = "Source α 😀") {
  const f = await secondReaderTest(modules);
  if (key)
    await saveTestCredential(
      f.t,
      f.readerLibraryId,
      "openrouter",
      "fixture-key",
    );
  const articleId = await f.t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: f.readerLibraryId,
      guid: "summary",
      url: "https://example.com/summary",
      title: "Original",
      content,
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: Date.now(),
    }),
  );
  const args = {
    articleId,
    title: "Original",
    paragraphs: ["Displayed α", "Displayed 😀"],
    sourceHash: await sourceHash(content),
  };
  const identity = { userId: f.readerLibraryId, articleId };
  const state = () =>
    f.t.run((ctx) => ctx.db.query("fullSummaryState").unique());
  const rows = () => f.t.run((ctx) => ctx.db.query("summaries").collect());
  const save = (run?: number, gist = "Saved") =>
    f.t.mutation(internal.summaries.save, {
      ...identity,
      gist,
      thesis: "Thesis",
      flow: "Flow",
      ideas: [],
      links: [],
      model: "fixture",
      generation: run === undefined ? undefined : { run },
    });
  const claim = (changes: Partial<typeof args> = {}) =>
    f.t.mutation(internal.summaries.claimFull, {
      ...identity,
      ...args,
      ...changes,
    });
  const request = () => f.reader.action(api.actions.summarize.generate, args);
  return { ...f, articleId, args, identity, state, rows, save, claim, request };
}

function hold() {
  let release = () => {};
  let entered = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  model.generate.mockImplementationOnce(() => {
    entered();
    return new Promise((resolve) => {
      release = () => resolve(output);
    });
  });
  return { started, release: () => release() };
}

describe("full summary single flight", () => {
  it("native transaction byte limits admit near-limit bodies with installed triggers and bounded private claims", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const content = "😀".repeat(220_000);
    const articleId = await t.run((ctx) =>
      metadataContext(ctx).db.insert("articles", {
        userId: "default_user",
        guid: "large",
        url: "https://example.com/large",
        title: "Large",
        content,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      }),
    );
    const claim = await t.mutation(internal.summaries.claimFull, {
      userId: "default_user",
      articleId,
      title: "Large",
      paragraphs: [content],
      sourceHash: await sourceHash(content),
    });
    expect(claim.kind).toBe("claimed");
    await t.run((ctx) =>
      metadataContext(ctx).db.patch(articleId, {
        content: `${content} changed`,
      }),
    );
    expect(
      await t.mutation(internal.summaries.save, {
        userId: "default_user",
        articleId,
        generation: { run: claim.run },
        gist: "Stale",
        thesis: "Stale",
        flow: "",
        ideas: [],
        links: [],
        model: "fixture",
      }),
    ).toBeNull();
    await t.run((ctx) => metadataContext(ctx).db.delete(articleId));
    expect(
      await t.run((ctx) => ctx.db.query("fullSummaryState").unique()),
    ).toBeNull();
  });
  it("two clients share one held provider dispatch and coherently finish with the current map", async () => {
    const f = await fixture();
    const h = hold();
    const first = f.request();
    await h.started;
    const identity = await f.reader.run((ctx) => ctx.auth.getUserIdentity());
    if (!identity) throw new Error("Missing fixture identity");
    const secondClient = f.t.withIdentity(identity);
    const second = secondClient.action(api.actions.summarize.generate, f.args);
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
    expect(model.generate).toHaveBeenCalledTimes(1);
    h.release();
    await first;
    await vi.advanceTimersByTimeAsync(2000);
    await second;
    expect(await f.rows()).toHaveLength(1);
    expect((await f.rows())[0]).toMatchObject({
      gist: "Current gist",
      ideas: [{ paragraphs: [1, 2] }],
    });
    await f.request();
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(await f.state()).toMatchObject({ status: "complete", attempts: 1 });
  });

  it("retains old output on failure, then allows only three explicit attempts", async () => {
    const f = await fixture();
    await f.save(undefined, "Old usable output");
    model.generate.mockRejectedValue(new Error("fixture provider failed"));
    for (let n = 0; n < 3; n++)
      await expect(f.request()).rejects.toThrow("fixture provider failed");
    await expect(f.request()).rejects.toThrow("attempt limit");
    expect(model.generate).toHaveBeenCalledTimes(3);
    expect((await f.rows())[0].gist).toBe("Old usable output");
  });

  it("missing provider never spends and leaves truthful failed state", async () => {
    const f = await fixture(false);
    await expect(f.request()).rejects.toThrow();
    expect(model.generate).not.toHaveBeenCalled();
    expect(await f.state()).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("tokenless legacy requests are callable but cannot prove their source or spend", async () => {
    const f = await fixture();
    const { sourceHash: _hash, ...legacy } = f.args;
    await expect(
      f.reader.action(api.actions.summarize.generate, legacy),
    ).rejects.toThrow("Reload");
    expect(model.generate).not.toHaveBeenCalled();
    expect(await f.state()).toBeNull();
  });

  it("expired leases recover only explicitly, with old and tokenless callbacks fenced", async () => {
    const f = await fixture();
    await f.save(undefined, "Old");
    const first = await f.claim();
    expect(await f.claim()).toMatchObject({ kind: "join", run: first.run });
    await vi.advanceTimersByTimeAsync(SUMMARY_LEASE_MS + 1);
    expect(model.generate).not.toHaveBeenCalled();
    expect(await f.save(first.run)).toBeNull();
    const next = await f.claim();
    expect(next.run).toBe(first.run + 1);
    expect(await f.save()).toBeNull();
    expect(await f.save(first.run)).toBeNull();
    const id = await f.save(next.run, "New");
    expect(await f.save(next.run, "Duplicate must not replace")).toBe(id);
    await f.t.mutation(internal.summaries.failFull, {
      ...f.identity,
      run: next.run,
    });
    expect(await f.claim()).toMatchObject({ kind: "complete" });
    expect((await f.rows())[0].gist).toBe("New");
    expect(await f.state()).toMatchObject({ status: "complete" });
  });

  it.each([
    "content",
    "contentHtml",
    "title",
    "author",
    "url",
  ] as const)("fences changed %s and same-time A→B→A with installed revision triggers", async (field) => {
    const f = await fixture();
    await f.save(undefined, "Old");
    const c = await f.claim();
    const old = await f.t.run((ctx) => ctx.db.get(f.articleId));
    await f.t.run((ctx) =>
      metadataContext(ctx).db.patch(f.articleId, { [field]: "Changed" }),
    );
    await f.t.run((ctx) =>
      metadataContext(ctx).db.patch(f.articleId, { [field]: old?.[field] }),
    );
    expect(await f.save(c.run)).toBeNull();
    expect((await f.rows())[0].gist).toBe("Old");
  });

  it("changed full representation tail, paragraph boundaries and title cannot join an active claim", async () => {
    const f = await fixture();
    await f.claim();
    for (const paragraphs of [
      ["Displayed α", "Displayed 😀", "tail"],
      ["Displayed αDisplayed 😀"],
      ["Displayed", " αDisplayed 😀"],
    ])
      await expect(f.claim({ paragraphs })).rejects.toThrow("Another summary");
    await expect(f.claim({ title: "Stale title" })).rejects.toThrow("Reload");
    await expect(
      f.claim({ sourceHash: await sourceHash("old") }),
    ).rejects.toThrow("Reload");
  });

  it("model A→B→A invalidates the old generation, without using annotation signal identity", async () => {
    const f = await fixture();
    const settings = await f.t.run((ctx) =>
      metadataContext(ctx).db.insert("userSettings", {
        userId: f.readerLibraryId,
        annotationModel: "openrouter:a",
        updatedAt: Date.now(),
      }),
    );
    const c = await f.claim();
    await f.t.run((ctx) =>
      metadataContext(ctx).db.patch(settings, {
        annotationModel: "openrouter:b",
      }),
    );
    await f.t.run((ctx) =>
      metadataContext(ctx).db.patch(settings, {
        annotationModel: "openrouter:a",
      }),
    );
    expect(await f.save(c.run)).toBeNull();
  });

  it("representation A→B→A never lets the oldest token publish", async () => {
    const f = await fixture();
    const a = await f.claim();
    await f.t.mutation(internal.summaries.failFull, {
      ...f.identity,
      run: a.run,
    });
    const b = await f.claim({
      paragraphs: ["A different displayed representation"],
    });
    await f.t.mutation(internal.summaries.failFull, {
      ...f.identity,
      run: b.run,
    });
    const nextA = await f.claim();
    expect(await f.save(a.run)).toBeNull();
    expect(await f.save(b.run)).toBeNull();
    expect(await f.save(nextA.run, "Current A")).not.toBeNull();
    expect((await f.rows())[0].gist).toBe("Current A");
  });

  it.each([
    "keep",
    "pause",
  ] as const)("retained article still generates after feed %s", async (operation) => {
    const f = await fixture();
    const feedId = await f.reader.mutation(api.feeds.add, {
      url: "https://example.com/feed",
      title: "Feed",
    });
    await f.t.run((ctx) =>
      metadataContext(ctx).db.patch(f.articleId, { feedId }),
    );
    if (operation === "keep")
      await f.reader.mutation(api.feeds.remove, { feedId, articles: "keep" });
    else await f.reader.mutation(api.feeds.toggleActive, { feedId });
    await f.request();
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect((await f.rows())[0].gist).toBe("Current gist");
  });

  it("a waiter interrupted by deletion fails coherently without provider dispatch or late writes", async () => {
    const f = await fixture();
    await f.claim();
    const waiting = f.request().then(
      () => null,
      (error) => error,
    );
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
    await f.t.run((ctx) => metadataContext(ctx).db.delete(f.articleId));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await waiting).toBeInstanceOf(Error);
    expect(model.generate).not.toHaveBeenCalled();
    expect(await f.state()).toBeNull();
    expect(await f.rows()).toEqual([]);
  });

  it.each([
    "delete",
    "transfer",
    "library",
  ] as const)("held provider cannot publish after %s", async (operation) => {
    const f = await fixture();
    const h = hold();
    const running = f.request().then(
      () => null,
      (error) => error,
    );
    await h.started;
    await f.t.run(async (ctx) => {
      if (operation === "delete")
        await metadataContext(ctx).db.delete(f.articleId);
      if (operation === "transfer")
        await metadataContext(ctx).db.patch(f.articleId, { userId: "other" });
      if (operation === "library") {
        const reader = await ctx.db
          .query("readers")
          .withIndex("by_libraryId", (q) =>
            q.eq("libraryId", f.readerLibraryId),
          )
          .unique();
        if (reader) await ctx.db.patch(reader._id, { status: "disabled" });
      }
    });
    h.release();
    expect(await running).toBeInstanceOf(Error);
    expect(await f.rows()).toEqual([]);
    expect(model.generate).toHaveBeenCalledTimes(1);
    if (operation === "delete") expect(await f.state()).toBeNull();
  });

  it("wait timeout does not release or redispatch, and explicit requests still join", async () => {
    const f = await fixture();
    await f.claim();
    const waiting = f.request().then(
      () => null,
      (error) => error,
    );
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await waiting).toBeInstanceOf(Error);
    expect(await f.claim()).toMatchObject({ kind: "join", run: 1 });
    expect(model.generate).not.toHaveBeenCalled();
    expect(await f.state()).toMatchObject({ status: "running", attempts: 1 });
  });

  it("near-limit UTF-8 source/representation stays bounded, complete paragraphs and citation total unchanged", async () => {
    const content = "😀".repeat(220_000);
    const f = await fixture(true, content);
    f.args.paragraphs = ["α".repeat(199_999), "😀", "tail beyond model window"];
    await f.request();
    expect(model.generate.mock.calls[0][0].prompt).toBe(
      `# Original\n\n¶1\n${f.args.paragraphs[0]}`,
    );
    expect((await f.rows())[0].ideas?.[0].paragraphs).toEqual([1, 2, 3]);
    const state = await f.state();
    expect(
      new TextEncoder().encode(JSON.stringify(state)).byteLength,
    ).toBeLessThan(1024);
    expect(
      new TextEncoder().encode(JSON.stringify({ content })).byteLength,
    ).toBeLessThan(950_000);
    expect(
      await f.t.run((ctx) => purgeFullSummaries(ctx, f.readerLibraryId)),
    ).toBe(1);
    expect(await f.state()).toBeNull();
  });
});
