import { describe, expect, it } from "vitest";
import { readerMeta } from "./article-meta";

describe("readerMeta", () => {
  it("reads source then minutes", () => {
    expect(
      readerMeta({
        url: "https://www.example.com/post",
        uploaded: false,
        author: "Someone",
        minutes: 27,
      }),
    ).toBe("example.com · 27 min read");
  });

  it("leaves the author out", () => {
    expect(
      readerMeta({ url: "https://a.org/x", uploaded: false, author: "Ann" }),
    ).toBe("a.org");
  });

  it("names an upload, which has no site", () => {
    expect(
      readerMeta({ url: "upload:file.pdf", uploaded: true, minutes: 12 }),
    ).toBe("PDF · 12 min read");
  });

  it("puts a book's part first", () => {
    expect(
      readerMeta({
        url: "https://a.org/x",
        uploaded: false,
        minutes: 6,
        part: { index: 1, of: 9 },
      }),
    ).toBe("Part 2 of 9 · a.org · 6 min read");
  });
});
