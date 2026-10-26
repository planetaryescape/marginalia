import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseBibleReference } from "./bible";
import { fetchBiblePassage } from "./bibleProvider";
import {
  fetchYouVersionCatalogue,
  fetchYouVersionComparison,
} from "./youversion";

const ref = parseBibleReference("John 3:16-17")!;
const html =
  '<p><span class="verse" data-usfm="JHN.3.16">Provider text</span><span class="note">Original footnote</span></p>';
function provider() {
  return vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/stylesheet"))
      return new Response("@font-face { font-family: Scripture; }");
    if (url.pathname === "/v1/bibles")
      return Response.json({
        data: [
          { id: 111, title: "New International Version", language_tag: "en" },
          {
            id: 2692,
            title: "New American Standard Bible 2020",
            language_tag: "en",
          },
        ],
      });
    const id = Number(url.pathname.split("/")[3]);
    if (url.pathname.includes("/passages/"))
      return Response.json({
        id: "JHN.3.16-17",
        reference: "John 3:16-17",
        content: html,
      });
    return Response.json({
      id,
      title: `Edition ${id}`,
      abbreviation: `E${id}`,
      language_tag: "en",
      copyright: "Current publisher copyright",
      publisher_url: null,
    });
  });
}
beforeEach(() => {
  vi.stubEnv("YOUVERSION_APP_KEY", "test-only-app-credential");
  vi.stubEnv("YOUVERSION_READING_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("authorized Bible catalogue and display-only comparison", () => {
  it("requests the entire entitlement-filtered catalogue, not the public all-available list", async () => {
    const fetch = provider();
    vi.stubGlobal("fetch", fetch);
    expect(await fetchYouVersionCatalogue()).toHaveLength(2);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get("all_available")).toBeNull();
    expect(url.searchParams.get("language_ranges[]")).toBe("*");
    expect(url.searchParams.get("page_size")).toBe("*");
    expect(url.searchParams.getAll("fields[]")).toEqual([
      "id",
      "title",
      "language_tag",
    ]);
  });
  it("fails closed when configuration or production enablement is missing", async () => {
    const fetch = provider();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("YOUVERSION_READING_ENABLED", "false");
    await expect(fetchYouVersionCatalogue()).rejects.toThrow("not enabled");
    await expect(fetchYouVersionComparison(ref, [111, 2692])).rejects.toThrow(
      "not enabled",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves both actual editions and footnotes, requires current attribution, and never puts a key in URLs", async () => {
    const fetch = provider();
    vi.stubGlobal("fetch", fetch);
    const result = await fetchYouVersionComparison(ref, [111, 2692]);
    expect(result.panes.map((p) => p.id)).toEqual([111, 2692]);
    expect(result.panes.every((p) => p.html === html)).toBe(true);
    expect(result.panes[0].publisherUrl).toBe("https://www.biblica.com/");
    expect(result.panes[1].copyright).toContain("Used by permission");
    for (const [input] of fetch.mock.calls) {
      expect(input).not.toContain("test-only-app-credential");
      if (input.includes("/passages/")) {
        expect(new URL(input).searchParams.get("include_notes")).toBe("true");
        expect(new URL(input).pathname).toContain("/passages/JHN.3.16-17");
      }
    }
    expect(JSON.stringify(result)).not.toContain("test-only-app-credential");
    await expect(fetchBiblePassage(ref, "niv")).rejects.toThrow("reading-only");
  });
  it("bounds display to two distinct versions within one chapter before fetching", async () => {
    const fetch = provider();
    vi.stubGlobal("fetch", fetch);
    for (const ids of [[], [111, 111], [111, 100, 2692], [-1], [1.5]])
      await expect(fetchYouVersionComparison(ref, ids)).rejects.toThrow(
        "different",
      );
    await expect(
      fetchYouVersionComparison(parseBibleReference("John 1-3")!, [111, 2692]),
    ).rejects.toThrow("one chapter");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects wrong references, wrong editions, missing notices, upstream denials and incomplete catalogues", async () => {
    for (const variant of ["reference", "version", "copyright", "denied"]) {
      const real = provider();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (variant === "denied")
            return new Response("Not licensed", { status: 403 });
          const response = await real(url);
          if (url.endsWith("/stylesheet")) return response;
          const body = await response.json();
          if (variant === "reference" && url.includes("/passages/"))
            body.id = "ROM.8.1";
          if (variant === "version" && !url.includes("/passages/"))
            body.id = 100;
          if (variant === "copyright" && !url.includes("/passages/"))
            body.copyright = "";
          return Response.json(body);
        }),
      );
      await expect(
        fetchYouVersionComparison(ref, [111, 2692]),
      ).rejects.toThrow();
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [], next_page_token: "more" })),
    );
    await expect(fetchYouVersionCatalogue()).rejects.toThrow("complete");
  });
});
