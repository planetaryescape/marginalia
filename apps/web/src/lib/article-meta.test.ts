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

  it.each([
    ["book.epub", "EPUB"],
    ["Book.EPUB", "EPUB"],
    ["book.pdf", "PDF"],
    ["book.bin", "Upload"],
  ])("labels the saved upload %s as %s", (uploadedFileName, label) => {
    expect(
      readerMeta({
        url: "upload:import-id",
        uploaded: true,
        uploadedFileName,
        minutes: 2,
        part: { index: 0, of: 81 },
      }),
    ).toBe(
      `${label === "EPUB" ? "Chapter" : "Part 1 of 81"} · ${label} · 2 min read`,
    );
  });

  it("uses the EPUB chapter title rather than numbering reading chunks as chapters", () => {
    expect(
      readerMeta({
        url: "upload:import-id",
        uploaded: true,
        uploadedFileName: "book.epub",
        minutes: 2,
        part: { index: 5, of: 81, title: "Learning to Notice" },
      }),
    ).toBe("Learning to Notice · EPUB · 2 min read");
  });

  it("uses the stored format when a long filename has lost its extension", () => {
    expect(
      readerMeta({
        url: "upload:import-id",
        uploaded: true,
        uploadedFileName: "x".repeat(200),
        format: "epub",
        minutes: 2,
        part: { index: 36, of: 81, title: "Learning to Notice" },
      }),
    ).toBe("Learning to Notice · EPUB · 2 min read");
  });

  it("keeps non-book PDF uploads labeled when their filename is truncated", () => {
    expect(
      readerMeta({
        url: "upload:file-id",
        uploaded: true,
        uploadedFileName: "x".repeat(200),
        minutes: 2,
      }),
    ).toBe("PDF · 2 min read");
  });
});
