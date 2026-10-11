import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import manifest from "../app/manifest";

const publicFile = (name: string) =>
  new URL(`../../public/${name}`, import.meta.url);
const source = readFileSync(publicFile("sw.js"), "utf8");

interface WorkerEvent {
  request: Pick<Request, "url" | "mode" | "method">;
  waitUntil: (work: Promise<void>) => void;
  respondWith: (response: Promise<Response>) => void;
}

function worker() {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const add = vi.fn().mockResolvedValue(undefined);
  const fallback = new Response("offline fallback");
  const caches = {
    open: vi.fn().mockResolvedValue({ add }),
    keys: vi
      .fn()
      .mockResolvedValue([
        "another-app-cache",
        "marginalia-offline-v0",
        "marginalia-offline-v1",
      ]),
    delete: vi.fn().mockResolvedValue(true),
    match: vi.fn().mockResolvedValue(fallback),
  };
  const fetch = vi.fn().mockResolvedValue(new Response("fresh page"));
  const self = {
    location: { origin: "https://reader.example" },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    addEventListener: (name: string, handler: (event: WorkerEvent) => void) =>
      listeners.set(name, handler),
  };
  class WorkerRequest extends Request {
    constructor(input: string, init?: RequestInit) {
      super(new URL(input, self.location.origin), init);
    }
  }
  runInNewContext(source, {
    self,
    caches,
    fetch,
    Request: WorkerRequest,
    Response,
    URL,
  });
  const dispatch = async (
    name: string,
    url = "https://reader.example/",
    mode: RequestMode = "navigate",
    method = "GET",
  ) => {
    let result: Promise<Response> | undefined;
    let work: Promise<void> | undefined;
    // Native Node Request cannot represent browser navigation requests.
    const request = { url, mode, method };
    listeners.get(name)?.({
      request,
      waitUntil: (promise) => {
        work = promise;
      },
      respondWith: (promise) => {
        result = promise;
      },
    });
    await work;
    return result;
  };
  return { dispatch, caches, add, fetch, self, fallback };
}

describe("PWA resources", () => {
  it("offers a same-origin standalone launch and real PNG icons with declared dimensions", () => {
    const app = manifest();
    expect(app.display).toBe("standalone");
    expect(
      new URL(app.start_url ?? "", "https://reader.example").pathname,
    ).toBe("/");
    for (const icon of app.icons ?? []) {
      const png = readFileSync(publicFile(icon.src.replace(/^\//, "")));
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(icon.sizes).toBe(
        `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,
      );
    }
    expect(app.icons?.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("installs only a self-contained offline screen, not personal content", async () => {
    const w = worker();
    await w.dispatch("install");
    expect(w.add).toHaveBeenCalledTimes(1);
    expect(w.add.mock.calls[0][0].url).toMatch(/\/offline.html$/);
    const html = readFileSync(publicFile("offline.html"), "utf8");
    expect(html).not.toMatch(/<(script|link|img)\b/);
    expect(html).toContain("doesn’t download your reading library");
  });

  it("returns fresh navigation responses without caching them", async () => {
    const w = worker();
    const response = await w.dispatch(
      "fetch",
      "https://reader.example/read/private-article",
    );
    expect(await response?.text()).toBe("fresh page");
    expect(w.caches.open).not.toHaveBeenCalled();
    expect(w.caches.match).not.toHaveBeenCalled();
  });

  it("uses the cached fallback when a navigation loses its connection", async () => {
    const w = worker();
    w.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const response = await w.dispatch("fetch", "https://reader.example/notes");
    expect(response).toBe(w.fallback);
    expect(w.caches.match).toHaveBeenCalledWith("/offline.html", {
      cacheName: "marginalia-offline-v1",
    });
  });

  it.each([
    ["https://reader.example/api/engagement", "cors", "POST"],
    ["https://reader.example/_next/static/chunk.js", "cors", "GET"],
    ["https://reader.example/read/private-article?_rsc=123", "cors", "GET"],
    ["https://backend.example/api/library", "cors", "POST"],
    ["https://other.example/", "navigate", "GET"],
  ] as const)("leaves non-navigation and external traffic alone: %s", async (url, mode, method) => {
    const w = worker();
    expect(await w.dispatch("fetch", url, mode, method)).toBeUndefined();
    expect(w.fetch).not.toHaveBeenCalled();
    expect(w.caches.match).not.toHaveBeenCalled();
  });

  it("does not mask server errors as an offline page", async () => {
    const w = worker();
    w.fetch.mockResolvedValue(new Response("Server error", { status: 500 }));
    expect((await w.dispatch("fetch"))?.status).toBe(500);
    expect(w.caches.match).not.toHaveBeenCalled();
  });

  it("cleans up only obsolete Marginalia offline caches", async () => {
    const w = worker();
    await w.dispatch("activate");
    expect(w.caches.delete.mock.calls).toEqual([["marginalia-offline-v0"]]);
    expect(w.self.clients.claim).toHaveBeenCalledOnce();
  });
});
