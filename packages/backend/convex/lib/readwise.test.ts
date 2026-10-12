import { afterEach, describe, expect, it, vi } from "vitest";
import { listDocumentPage, ReadwiseRateLimitError } from "./readwise";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Reader page requests", () => {
  it("defers long rate-limit waits rather than retrying before Retry-After", async () => {
    vi.stubEnv("READWISE_TOKEN", "test-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "300" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(listDocumentPage({ location: "new" })).rejects.toEqual(
      new ReadwiseRateLimitError(300_250),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("sends a bounded limit and preserved cursor and incremental filter", async () => {
    vi.stubEnv("READWISE_TOKEN", "test-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ results: [], nextPageCursor: "following" }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await listDocumentPage({
        location: "later",
        pageCursor: "saved cursor",
        updatedAfter: "2026-01-01T00:00:00Z",
        withHtmlContent: true,
      }),
    ).toEqual({ results: [], nextPageCursor: "following" });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      location: "later",
      pageCursor: "saved cursor",
      updatedAfter: "2026-01-01T00:00:00Z",
      withHtmlContent: "true",
      limit: "5",
    });
  });

  it("doesn't hide API errors as an empty or complete page", async () => {
    vi.stubEnv("READWISE_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("outage", { status: 503 })),
    );
    await expect(listDocumentPage({ location: "new" })).rejects.toThrow("503");
  });
});
