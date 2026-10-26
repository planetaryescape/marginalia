/// <reference types="vite/client" />
import { afterEach, expect, it, vi } from "vitest";
import { readerTest } from "../test/owner";
import { internal } from "./_generated/api";
import { retrieveArticleContext } from "./lib/articleAsk";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllGlobals());
const vector = (axis = 0) =>
  Array.from({ length: 1536 }, (_, i) => (i === axis ? 1 : 0));
async function fixture() {
  const t = readerTest(modules);
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "fixture",
      url: "https://example.com/fixture",
      title: "Fixture",
      extractionStatus: "extracted",
      annotationStatus: "skipped",
      createdAt: 0,
    }),
  );
  const retrieve = (input: Parameters<typeof retrieveArticleContext>[1]) =>
    t.action((ctx) => retrieveArticleContext(ctx, input));
  const input = {
    userId: "default_user",
    articleId,
    paragraphs: Array.from({ length: 150 }, (_, i) =>
      `${i} `.padEnd(1000, "x"),
    ),
    question: "question",
    history: [],
    paragraphIndex: null,
    embedder: { provider: "openai" as const, apiKey: "fixture" },
  };
  return { t, articleId, retrieve, input };
}

it("overlaps question and two bounded passage batches; warm requests transfer no vectors", async () => {
  const { t, articleId, retrieve, input } = await fixture();
  const calls: string[][] = [];
  const release: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const texts: string[] = JSON.parse(String(init.body)).input;
    calls.push(texts);
    active++;
    peak = Math.max(peak, active);
    if (calls.length <= 3)
      await new Promise<void>((resolve) => release.push(resolve));
    active--;
    return Response.json({
      data: texts.map((_, index) => ({ index, embedding: vector() })),
    });
  });
  const pending = retrieve(input);
  await vi.waitFor(() => expect(calls).toHaveLength(3));
  expect(calls[0]).toEqual(["question"]);
  expect(calls.slice(1).every((batch) => batch.length === 64)).toBe(true);
  release.forEach((done) => {
    done();
  });
  expect((await pending).mode).toBe("retrieved");
  expect(peak).toBe(3);
  const coldCalls = calls.length;
  expect((await retrieve(input)).mode).toBe("retrieved");
  expect(calls.length - coldCalls).toBe(1);
  const state = await t.run((ctx) =>
    ctx.db.query("articlePassageState").first(),
  );
  if (!state) throw new Error("Cache was not published");
  const page = await t.query(internal.articlePassages.rankPage, {
    userId: "default_user",
    articleId,
    generation: state.generation,
    query: vector(),
    cursor: null,
  });
  expect(page?.ranked).toHaveLength(32);
  expect(page?.cursor).not.toBeNull();
  expect(JSON.stringify(page)).not.toContain("embedding");
});

it("rejects stale and legacy publication after a newer content/model generation", async () => {
  const { t, articleId } = await fixture();
  const prepare = (contentHash: string, model = "model") =>
    t.mutation(internal.articlePassages.prepare, {
      userId: "default_user",
      articleId,
      contentHash,
      model,
      total: 1,
    });
  const old = await prepare("old");
  const newer = await prepare("new", "other-model");
  const passage = {
    startParagraph: 0,
    endParagraph: 0,
    fromOffset: 0,
    toOffset: 10,
    embedding: vector(),
  };
  const append = (generation: number) =>
    t.mutation(internal.articlePassages.append, {
      userId: "default_user",
      articleId,
      generation,
      offset: 0,
      passages: [passage],
    });
  if (!newer || !old) throw new Error("Fixture ownership missing");
  expect(await append(newer.generation)).toBe(true);
  expect(await append(old.generation)).toBe(false);
  await t.mutation(internal.articlePassages.replace, {
    userId: "default_user",
    articleId,
    contentHash: "old",
    model: "model",
    passages: [passage],
  });
  expect((await prepare("new", "other-model"))?.ready).toBe(true);
  expect(
    await t.run((ctx) => ctx.db.query("articlePassages").take(10)),
  ).toMatchObject([{ contentHash: "new", model: "other-model" }]);
});

it("aborts all concurrent preparation and never publishes partial vectors", async () => {
  const { t, retrieve, input } = await fixture();
  const caller = new AbortController();
  const signals: AbortSignal[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const signal = init.signal!;
    signals.push(signal);
    return new Promise<Response>((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      }),
    );
  });
  const pending = retrieve({
    ...input,
    embedder: { ...input.embedder, signal: caller.signal },
  });
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => expect(signals).toHaveLength(3));
  caller.abort();
  await rejected;
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(await t.run((ctx) => ctx.db.query("articlePassages").take(1))).toEqual(
    [],
  );
});

it("does no provider work for an unknown owner, including the question", async () => {
  const { retrieve, input } = await fixture();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await retrieve({ ...input, userId: "other" })).mode).toBe("fallback");
  expect(fetch).not.toHaveBeenCalled();
});
