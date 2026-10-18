import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./auth-client", () => ({ authClient: {} }));

import {
  postReaderRequest,
  type ReaderTransport,
  resetDirectBackoff,
} from "./reader-transport";

const site = "https://fixture.convex.site";
function fixture() {
  return {
    site,
    fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("answer")),
    getToken: vi.fn(async () => "jwt"),
    forgetToken: vi.fn(),
    now: () => 0,
  } satisfies ReaderTransport;
}
beforeEach(resetDirectBackoff);
afterEach(() => vi.useRealTimers());

it("uses direct authenticated streaming without changing the text/header contract", async () => {
  const t = fixture();
  t.fetch.mockResolvedValue(
    new Response("answer", { headers: { "X-Companion-Model": "m" } }),
  );
  const result = await postReaderRequest(
    "companion",
    { mode: "define" },
    new AbortController().signal,
    t,
  );
  expect(await result.text()).toBe("answer");
  expect(result.headers.get("X-Companion-Model")).toBe("m");
  expect(t.fetch.mock.calls[0]).toMatchObject([
    `${site}/api/companion`,
    { headers: { Authorization: "Bearer jwt" } },
  ]);
});

it.each([
  401, 404, 405,
])("uses the old proxy only on explicit pre-work rejection %s", async (status) => {
  const t = fixture();
  t.fetch.mockResolvedValueOnce(
    new Response(null, {
      status,
      headers: { "X-Reader-Prework-Rejection": "auth" },
    }),
  );
  const response = await postReaderRequest(
    "library",
    {},
    new AbortController().signal,
    t,
  );
  expect(await response.text()).toBe("answer");
  expect(t.fetch.mock.calls.map(([url]) => url)).toEqual([
    `${site}/api/library`,
    "/api/reader/library",
  ]);
});

it("does not replay a terminal ChatGPT reconnect 401 through a paid-key path", async () => {
  const t = fixture();
  t.fetch.mockResolvedValue(
    Response.json(
      { code: "chatgpt_reconnect", error: "Reconnect" },
      { status: 401 },
    ),
  );
  const result = await postReaderRequest(
    "companion",
    {},
    new AbortController().signal,
    t,
  );
  expect(result.status).toBe(401);
  expect(t.fetch).toHaveBeenCalledTimes(1);
  expect(t.forgetToken).not.toHaveBeenCalled();
});

it("never replays a post-response stream failure, even before its first visible token", async () => {
  const t = fixture();
  t.fetch.mockResolvedValue(
    new Response(
      new ReadableStream({
        start(c) {
          c.error(new Error("broken body"));
        },
      }),
    ),
  );
  const result = await postReaderRequest(
    "companion",
    {},
    new AbortController().signal,
    t,
  );
  await expect(result.text()).rejects.toThrow("broken body");
  expect(t.fetch).toHaveBeenCalledTimes(1);
});

it("does not replay after partial output", async () => {
  const t = fixture();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  t.fetch.mockResolvedValue(
    new Response(
      new ReadableStream({
        start(c) {
          controller = c;
        },
      }),
    ),
  );
  const response = await postReaderRequest(
    "companion",
    {},
    new AbortController().signal,
    t,
  );
  const reader = response.body!.getReader();
  controller.enqueue(new TextEncoder().encode("first"));
  expect((await reader.read()).value).toEqual(
    new TextEncoder().encode("first"),
  );
  controller.error(new Error("interrupted"));
  await expect(reader.read()).rejects.toThrow("interrupted");
  expect(t.fetch).toHaveBeenCalledTimes(1);
});

it("Stop interrupts token acquisition without dispatching a request", async () => {
  const t = fixture();
  t.getToken.mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const request = postReaderRequest("companion", {}, controller.signal, t);
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
  expect(t.fetch).not.toHaveBeenCalled();
});

it("bounds a stuck shared token wait and falls back before dispatch", async () => {
  vi.useFakeTimers();
  const t = fixture();
  t.getToken.mockImplementation(() => new Promise(() => {}));
  const request = postReaderRequest(
    "companion",
    {},
    new AbortController().signal,
    t,
  );
  await vi.advanceTimersByTimeAsync(8_001);
  expect(await (await request).text()).toBe("answer");
  expect(t.fetch.mock.calls[0][0]).toBe("/api/reader/companion");
});
