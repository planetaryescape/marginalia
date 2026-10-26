import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBibleReference } from "./bible";
import {
  bibleTranslations,
  fetchBiblePassage,
  requireTranslation,
} from "./bibleProvider";

afterEach(() => vi.unstubAllGlobals());
function reference(text: string) {
  const ref = parseBibleReference(text);
  if (!ref) throw new Error("Invalid test reference");
  return ref;
}
function response(
  verses: { chapter: number; verse: number; text: string; book_id?: string }[],
) {
  return new Response(
    JSON.stringify({
      translation: { identifier: "web" },
      verses: verses.map((v) => ({ book_id: "JHN", ...v })),
    }),
  );
}

describe("Bible text provenance", () => {
  it("does not enable licensed translations just because an API key exists", () => {
    expect(
      bibleTranslations()
        .filter((t) => t.available)
        .map((t) => t.code),
    ).toEqual(["web"]);
    for (const code of ["esv", "nasb", "niv", "nlt", "msg"])
      expect(() => requireTranslation(code)).toThrow("permission");
  });
  it("preserves fetched text, escapes markup, and selects only the requested verses", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response([
        { chapter: 3, verse: 15, text: "Not requested" },
        {
          chapter: 3,
          verse: 16,
          text: 'Actual source <script>alert("x")</script> & words',
        },
        { chapter: 3, verse: 17, text: "More source text" },
        { chapter: 3, verse: 18, text: "Not requested either" },
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    const passage = await fetchBiblePassage(reference("John 3:16-17"), "web");
    expect(passage.content).toBe(
      '3:16 Actual source <script>alert("x")</script> & words\n\n3:17 More source text',
    );
    expect(passage.contentHtml).not.toContain("<script>");
    expect(passage.contentHtml).toContain('id="JHN.3.16"');
    expect(passage.copyright).toContain("Public domain");
  });
  it("fetches every requested chapter and never interprets Jude 1 as one verse", async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => {
      const chapter = Number(url.split("/").at(-1));
      return response([{ chapter, verse: 1, text: `Chapter ${chapter}` }]);
    });
    vi.stubGlobal("fetch", fetch);
    expect(
      (await fetchBiblePassage(reference("John 1-3"), "web")).content,
    ).toBe("1:1 Chapter 1\n\n2:1 Chapter 2\n\n3:1 Chapter 3");
    fetch.mockResolvedValueOnce(
      response([
        { book_id: "JUD", chapter: 1, verse: 1, text: "First verse" },
        { book_id: "JUD", chapter: 1, verse: 25, text: "Last verse" },
      ]),
    );
    expect(
      (await fetchBiblePassage(reference("Jude 1"), "web")).content,
    ).toContain("1:25 Last verse");
  });
  it("rejects missing verse endpoints instead of silently shortening a passage", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response([{ chapter: 3, verse: 16, text: "Only the first verse" }]),
        ),
    );
    await expect(
      fetchBiblePassage(reference("John 3:16-17"), "web"),
    ).rejects.toThrow("range");
  });
  it("rejects the wrong book, translation, malformed data, and provider failures", async () => {
    for (const body of [
      response([{ book_id: "ROM", chapter: 3, verse: 16, text: "Wrong book" }]),
      new Response(
        JSON.stringify({ translation: { identifier: "niv" }, verses: [] }),
      ),
      new Response("oops"),
      new Response("Unavailable", { status: 503 }),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(body));
      await expect(
        fetchBiblePassage(reference("John 3:16"), "web"),
      ).rejects.toThrow();
    }
  });
});
