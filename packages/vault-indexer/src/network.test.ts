import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { embedChunks } from "./embedder";
import { requestJson } from "./network";
import { deleteFile, getRemoteHashes, replaceFile } from "./uploader";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const vectors = (count: number) => ({
  data: Array.from({ length: count }, (_, index) => ({
    index,
    embedding: Array(1536).fill(0.1),
  })).reverse(),
});

describe("bounded network requests", () => {
  it.each([
    400, 401, 403, 422,
  ])("never retries permanent HTTP %i or logs its body", async (status) => {
    const fetcher = vi.fn(
      async () => new Response("SECRET_KEY private body", { status }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      requestJson("https://fixture.invalid", {}, { retryDelayMs: 0 }),
    ).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([429, 500, 503])("retries transient HTTP %i", async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("secret", { status }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      await requestJson("https://fixture.invalid", {}, { retryDelayMs: 0 }),
    ).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("bounds retry-after and supports cancellation while waiting", async () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    const controller = new AbortController();
    const fetcher = vi.fn(
      async () =>
        new Response("secret", {
          status: 429,
          headers: { "retry-after": "9999999" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const pending = requestJson(
      "https://fixture.invalid",
      {},
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(new Error("stop")), 10);
    await expect(pending).rejects.toThrow("stop");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(timers.mock.calls.some((call) => call[1] === 10_000)).toBe(true);
  });
  it("times out hung requests with bounded attempts and aborts all transports", async () => {
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          ),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      requestJson(
        "https://fixture.invalid",
        {},
        { timeoutMs: 5, retryDelayMs: 0, attempts: 2 },
      ),
    ).rejects.toThrow("timed out");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("deadlines stalled response bodies for hash, delete, and replacement requests", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"incomplete":');
    });
    try {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Fixture did not bind");
      const url = `http://127.0.0.1:${address.port}`;
      const options = { timeoutMs: 10, attempts: 1 };
      const chunk = {
        userId: "fixture",
        filePath: "A.md",
        fileName: "A",
        chunkIndex: 0,
        content: "Synthetic",
        embedding: Array(1536).fill(0.1),
        fileHash: "hash",
        indexedAt: 1,
      };
      await expect(getRemoteHashes(url, "fixture", options)).rejects.toThrow(
        "timed out",
      );
      await expect(deleteFile(url, "fixture", "A.md", options)).rejects.toThrow(
        "timed out",
      );
      await expect(
        replaceFile(url, "fixture", "A.md", [chunk], options),
      ).rejects.toThrow("timed out");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("rejects oversized successful responses without retrying or retaining unbounded bodies", async () => {
    const fetcher = vi.fn(async () => new Response("x".repeat(8_000_001)));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestJson("https://fixture.invalid", {})).rejects.toThrow(
      "8 MB byte budget",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not retry malformed JSON or malformed embedding responses", async () => {
    const fetcher = vi.fn(async () => new Response("PRIVATE not JSON"));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestJson("https://fixture.invalid", {})).rejects.toThrow(
      "invalid JSON",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(async () =>
      Response.json({ data: [{ index: 0, embedding: [1] }] }),
    );
    expect(await embedChunks(["valid"], "fixture")).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("stops a whole-file embedding group after one permanently failed batch", async () => {
    const fetcher = vi.fn(async () => new Response("SECRET", { status: 400 }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      await embedChunks(Array(21).fill("valid"), "fixture", {
        retryDelayMs: 0,
      }),
    ).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("validates individual input and response indices/dimensions, preserving neighbor mapping", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json(vectors(2)),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await embedChunks(
      ["valid", "x".repeat(3201), "", "also valid"],
      "fixture",
    );
    expect(result.map(({ index }) => index)).toEqual([0, 3]);
    expect(JSON.parse(String(fetcher.mock.calls[0][1].body)).input).toEqual([
      "valid",
      "also valid",
    ]);
  });
  it("supports old and paginated servers, including prototype-looking file names", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(JSON.parse('{"__proto__":"hash","Old.md":"old"}')),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(await getRemoteHashes("https://fixture.invalid", "fixture")).toEqual(
      JSON.parse('{"__proto__":"hash","Old.md":"old"}'),
    );
    fetcher
      .mockResolvedValueOnce(
        Response.json({ version: 2, hashes: { "A.md": "a" }, cursor: "next" }),
      )
      .mockResolvedValueOnce(
        Response.json({ version: 2, hashes: { "B.md": "b" }, cursor: null }),
      );
    expect(await getRemoteHashes("https://fixture.invalid", "fixture")).toEqual(
      { "A.md": "a", "B.md": "b" },
    );
    expect(fetcher.mock.calls[2][0]).toContain("cursor=next");
  });
  it("rejects incomplete/looping hash contracts rather than re-embedding/deleting", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ version: 2, hashes: {}, cursor: "same" }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      getRemoteHashes("https://fixture.invalid", "fixture"),
    ).rejects.toThrow("Repeated");
    fetcher.mockImplementation(async () => Response.json({ "A.md": 42 }));
    await expect(
      getRemoteHashes("https://fixture.invalid", "fixture"),
    ).rejects.toThrow("Invalid remote");
  });
  it("applies deadlines to hash/delete/upload and never leaks error response bodies", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response("SECRET", { status: 401 });
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(
      getRemoteHashes("https://fixture.invalid", "fixture"),
    ).rejects.toThrow("HTTP 401");
    await expect(
      deleteFile("https://fixture.invalid", "fixture", "A.md"),
    ).rejects.toThrow("HTTP 401");
    await expect(
      replaceFile("https://fixture.invalid", "fixture", "A.md", []),
    ).rejects.toThrow("complete");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
