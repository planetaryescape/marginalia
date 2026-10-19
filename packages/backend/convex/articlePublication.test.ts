/// <reference types="vite/client" />
import { getFunctionName, httpRouter } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { ownerWithKey } from "../test/owner";
import { internal } from "./_generated/api";
import { type ActionCtx, httpAction } from "./_generated/server";
import http from "./http";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const embedding = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
async function fixture(
  mode: "article" | "ask" = "article",
  blockOn = "articlePassages:append",
  failSummary = false,
) {
  const entered = gate();
  const append = gate();
  const embedInputs: string[][] = [];
  let appends = 0;
  let models = 0;
  let modelMode: "ok" | "reject" | "partial" = "ok";
  const providerEntered = gate();
  const providerRelease = gate();
  let blockProvider = false;
  let failAppend = false;
  let blocked = false;
  const before = async (name: string) => {
    if (name === blockOn && !blocked) {
      blocked = true;
      entered.release();
      await append.promise;
    }
  };
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.input) {
      embedInputs.push(body.input);
      return Response.json({
        data: body.input.map((_: string, index: number) => ({
          index,
          embedding,
        })),
      });
    }
    models++;
    providerEntered.release();
    if (blockProvider) await providerRelease.promise; // Adapter deliberately ignores abort.
    if (modelMode === "reject") throw new Error("Provider rejected");
    const end =
      modelMode === "partial"
        ? 'data: {"error":{"message":"interrupted"}}\n\n'
        : "data: [DONE]\n\n";
    return new Response(
      `data: {"choices":[{"delta":{"content":"First ¶80."}}]}\n\n${end}`,
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  const route = http.lookup("/api/companion", "POST");
  if (!route) throw new Error("Missing companion route");
  // SAFETY: Convex 1.46 registration_impl assigns _handler on every HTTP action;
  // its published declaration strips this internal member. Keep this test-only
  // seam typed to the real app context rather than widening RPC arguments.
  const action = route[0] as (typeof route)[0] & {
    _handler(ctx: ActionCtx, request: Request): Promise<Response>;
  };
  const testHttp = httpRouter();
  testHttp.route({
    path: "/api/companion",
    method: "POST",
    handler: httpAction((ctx, request) =>
      action._handler(
        {
          ...ctx,
          runQuery: async (ref, ...args) => {
            const name = getFunctionName(ref);
            if (failSummary && name === "summaries:forCompanion") {
              await entered.promise;
              throw new Error("Summary unavailable");
            }
            await before(name);
            return ctx.runQuery(ref, ...args);
          },
          runMutation: async (ref, ...args) => {
            if (getFunctionName(ref) === "articlePassages:append") {
              appends++;
              if (failAppend) throw new Error("Append unavailable");
            }
            await before(getFunctionName(ref));
            return ctx.runMutation(ref, ...args);
          },
        },
        request,
      ),
    ),
  });
  const t = await ownerWithKey({
    ...modules,
    "./http.ts": async () => ({ default: testHttp }),
  });
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "publication",
      url: "https://example.com",
      title: "Fixture",
      extractionStatus: "extracted",
      annotationStatus: "skipped",
      createdAt: 0,
    }),
  );
  const paragraphs = Array.from({ length: 100 }, (_, i) =>
    `${i} 🦓 `.padEnd(1000, "x"),
  );
  const request = (signal?: AbortSignal): RequestInit => ({
    method: "POST",
    signal,
    body: JSON.stringify({
      mode,
      articleId,
      title: "Fixture",
      paragraphs,
      paragraphIndex: mode === "ask" ? 50 : null,
      selection: mode === "ask" ? "50" : "",
      question: "What about ¶80?",
    }),
  });
  const ask = (signal?: AbortSignal) =>
    t.fetch("/api/companion", request(signal));
  const state = () =>
    t.run((ctx) => ctx.db.query("articlePassageState").first());
  return {
    t,
    articleId,
    ask,
    state,
    entered,
    append,
    embedInputs,
    appends: () => appends,
    models: () => models,
    fail: (mode: typeof modelMode) => {
      modelMode = mode;
    },
    failAppend: () => {
      failAppend = true;
    },
    blockProvider: () => {
      blockProvider = true;
    },
    providerEntered,
    providerRelease,
  };
}

it.each([
  "article",
  "ask",
] as const)("%s delivers its first chunk before append, but completion joins a ready cache", async (mode) => {
  const f = await fixture(mode);
  const pending = f.ask();
  await f.entered.promise;
  const response = await pending;
  expect(response.status).toBe(200);
  expect(f.models()).toBe(1);
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(
    "First ¶80.",
  );
  expect((await f.state())?.count).toBe(0);
  let completed = false;
  const end = reader.read().then((result) => {
    completed = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(completed).toBe(false);
  f.append.release();
  expect((await end).done).toBe(true);
  expect(await f.state()).toMatchObject({ count: 100, total: 100 });
  const before = f.embedInputs.length;
  expect(await (await f.ask()).text()).toBe("First ¶80.");
  expect(f.embedInputs.slice(before)).toHaveLength(1);
  expect(f.embedInputs.at(-1)).toHaveLength(1);
});

it.each([
  "request",
  "downstream",
  "midstream",
  "prime",
] as const)("joins the last in-flight append on %s failure and launches no later append/replay", async (failure) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const f = await fixture();
  const caller = new AbortController();
  if (failure === "midstream") f.fail("partial");
  if (failure === "prime") {
    f.fail("reject");
    f.blockProvider();
  }
  let completed = false;
  const pending = f.ask(caller.signal).then((response) => {
    completed = true;
    return response;
  });
  await f.entered.promise;
  if (failure === "prime") {
    await f.providerEntered.promise;
    caller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completed).toBe(false);
    f.append.release();
    expect((await pending).status).toBe(499);
    f.providerRelease.release();
  } else {
    const response = await pending;
    const reader = response.body!.getReader();
    await reader.read();
    let settled = false;
    const exit = (
      failure === "downstream"
        ? reader.cancel()
        : reader.read().catch(() => null)
    ).then(() => {
      settled = true;
    });
    if (failure === "request") caller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    f.append.release();
    await exit;
  }
  expect(f.appends()).toBe(1);
  expect(f.models()).toBe(1);
  expect((await f.state())?.count).toBe(32);
});

it("all pre-token provider failures settle publication without replaying partial output", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const f = await fixture();
  f.fail("reject");
  let finished = false;
  const pending = f.ask().then((response) => {
    finished = true;
    return response;
  });
  await f.entered.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(finished).toBe(false);
  f.append.release();
  expect((await pending).status).toBe(502);
  expect(f.appends()).toBe(1);
});

it("a concurrent newer generation fences the delayed writer without losing its usable answer", async () => {
  const f = await fixture();
  const pending = f.ask();
  await f.entered.promise;
  const response = await pending;
  const newer = await f.t.mutation(internal.articlePassages.prepare, {
    userId: "default_user",
    articleId: f.articleId,
    contentHash: "new-content",
    model: "new-model",
    total: 1,
  });
  f.append.release();
  expect(await response.text()).toBe("First ¶80.");
  expect(f.appends()).toBe(1);
  expect(await f.state()).toMatchObject({
    generation: newer?.generation,
    count: 0,
    total: 1,
  });
});

it.each([
  "limits:spend",
  "articlePassages:authorized",
  "articlePassages:prepare",
])("Stop joins %s before provider dispatch or HTTP return", async (stage) => {
  const f = await fixture("article", stage);
  const caller = new AbortController();
  let settled = false;
  const pending = f.ask(caller.signal).then((response) => {
    settled = true;
    return response;
  });
  await f.entered.promise;
  caller.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  f.append.release();
  expect((await pending).status).toBe(499);
  expect(f.models()).toBe(0);
  expect(f.embedInputs).toHaveLength(0);
  expect(f.appends()).toBe(0);
});

it("a parallel summary failure joins the already-started private preparation before exiting", async () => {
  const f = await fixture("article", "articlePassages:prepare", true);
  let settled = false;
  const pending = f.ask().then((response) => {
    settled = true;
    return response;
  });
  await f.entered.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  f.append.release();
  expect((await pending).status).toBe(502);
  expect(f.models()).toBe(0);
  expect(f.embedInputs).toHaveLength(0);
});

it("simultaneous turns share the generation and idempotent append, leaving a question-only followup", async () => {
  const f = await fixture();
  const first = f.ask();
  await f.entered.promise;
  const second = await f.ask();
  expect(await second.text()).toBe("First ¶80.");
  f.append.release();
  expect(await (await first).text()).toBe("First ¶80.");
  expect(await f.state()).toMatchObject({
    generation: 1,
    count: 100,
    total: 100,
  });
  expect(
    await f.t.run((ctx) => ctx.db.query("articlePassages").collect()),
  ).toHaveLength(100);
  const before = f.embedInputs.length;
  await (await f.ask()).text();
  expect(f.embedInputs.slice(before)).toHaveLength(1);
});

it("append failure is best effort and cannot replay a successfully started answer", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const f = await fixture();
  f.failAppend();
  expect(await (await f.ask()).text()).toBe("First ¶80.");
  expect(f.models()).toBe(1);
  expect((await f.state())?.count).toBe(0);
});

it("Stop before any body demand still owns publication cleanup", async () => {
  const f = await fixture();
  const caller = new AbortController();
  const pending = f.ask(caller.signal);
  await f.entered.promise;
  const response = await pending;
  caller.abort();
  f.append.release();
  await expect(response.text()).rejects.toMatchObject({ name: "AbortError" });
  expect(f.appends()).toBe(1);
  expect((await f.state())?.count).toBe(32);
});
