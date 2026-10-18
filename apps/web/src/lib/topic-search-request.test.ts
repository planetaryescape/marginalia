import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth-client", () => ({ authClient: {} }));

import {
  postTopicSearch,
  resetDirectBackoff,
  type TopicSearchTransport,
} from "./topic-search-request";

const SITE = "https://x.convex.site";
const ok = () => Response.json({ matches: [] });

function transport(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  token: string | null = "jwt",
) {
  const t = {
    fetch: vi.fn(fetchImpl),
    site: SITE,
    getToken: vi.fn(async () => token),
    forgetToken: vi.fn(),
    now: () => 1000,
  };
  return t as typeof t & TopicSearchTransport;
}
const signal = () => new AbortController().signal;

beforeEach(() => resetDirectBackoff());

describe("postTopicSearch", () => {
  it("calls Convex directly with the Bearer token and no cookies", async () => {
    const t = transport(async () => ok());
    await expect(postTopicSearch("find", "rust", signal(), t)).resolves.toEqual(
      { matches: [] },
    );
    expect(t.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = t.fetch.mock.calls[0];
    expect(url).toBe(`${SITE}/api/library/find`);
    expect(init.headers).toMatchObject({ Authorization: "Bearer jwt" });
    expect(init.credentials).toBeUndefined();
  });

  it("does not replay an ambiguous network/CORS failure, but backs off future requests", async () => {
    const t = transport(async (url) => {
      if (url.startsWith(SITE)) throw new TypeError("Failed to fetch");
      return ok();
    });
    await expect(
      postTopicSearch("search", "rust", signal(), t),
    ).rejects.toThrow("Failed to fetch");
    expect(t.fetch.mock.calls.map(([url]) => url)).toEqual([
      `${SITE}/api/library/search`,
    ]);
    await postTopicSearch("search", "rust", signal(), t);
    expect(t.fetch.mock.calls.at(-1)?.[0]).toBe("/api/reader/library/search");
    expect(t.fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to the proxy on 401 and drops the cached token", async () => {
    const t = transport(async (url) =>
      url.startsWith(SITE)
        ? new Response("no", {
            status: 401,
            headers: { "X-Reader-Prework-Rejection": "auth" },
          })
        : ok(),
    );
    await postTopicSearch("find", "rust", signal(), t);
    expect(t.forgetToken).toHaveBeenCalled();
    expect(t.fetch.mock.calls.at(-1)?.[0]).toBe("/api/reader/library/find");
  });

  it("uses the proxy when there is no token or no site URL", async () => {
    const noToken = transport(async () => ok(), null);
    await postTopicSearch("find", "rust", signal(), noToken);
    expect(noToken.fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/reader/library/find",
    ]);
    const noSite = { ...transport(async () => ok()), site: undefined };
    await postTopicSearch("find", "rust", signal(), noSite);
    expect(noSite.fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/reader/library/find",
    ]);
  });

  it("throws other error responses as they are, without a fallback", async () => {
    const t = transport(async () => new Response("{}", { status: 502 }));
    await expect(
      postTopicSearch("find", "rust", signal(), t),
    ).rejects.toMatchObject({ status: 502 });
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });

  it("rethrows an abort without falling back", async () => {
    const controller = new AbortController();
    const t = transport(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(
      postTopicSearch("find", "rust", controller.signal, t),
    ).rejects.toThrow("aborted");
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });
});
