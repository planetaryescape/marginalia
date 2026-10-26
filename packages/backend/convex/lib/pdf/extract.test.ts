// @vitest-environment node
import { describe, expect, it } from "vitest";
import { makePdf } from "../../../test/pdf";
import { extractPdf, PdfImportError } from "./extract";

const WORDS = ["amber", "birch", "cobalt", "delta", "ember", "fjord"];
// Different words per sentence, so no line repeats like a running header
const sentence = (n: number) =>
  `Sentence ${n} of the sample page carries ${WORDS[n - 1]} words for reading.`;

describe("extractPdf", () => {
  it("reads the text of every page", async () => {
    const result = await extractPdf(
      makePdf([
        [sentence(1), sentence(2), sentence(3)],
        [sentence(4), sentence(5), sentence(6)],
      ]),
    );
    expect(result.pageCount).toBe(2);
    const text = result.blocks.map((b) => b.text).join(" ");
    expect(text).toContain("Sentence 1 of the sample page");
    expect(text).toContain("Sentence 6 of the sample page");
    expect(result.blocks.some((b) => b.page === 2)).toBe(true);
  });

  it("resolves outline entries to their pages", async () => {
    const result = await extractPdf(
      makePdf(
        [
          [sentence(1), sentence(2)],
          [sentence(3), sentence(4)],
          [sentence(5), sentence(6)],
        ],
        [
          { title: "First chapter", page: 1 },
          { title: "Second chapter", page: 3 },
        ],
      ),
    );
    expect(result.outline).toEqual([
      { title: "First chapter", depth: 0, page: 1 },
      { title: "Second chapter", depth: 0, page: 3 },
    ]);
  });

  it("refuses a PDF whose pages hold no text", async () => {
    await expect(extractPdf(makePdf([[], [], []]))).rejects.toMatchObject({
      reason: "scanned",
    });
  });

  it("refuses bytes that are not a PDF", async () => {
    const error = await extractPdf(new TextEncoder().encode("not a pdf")).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(PdfImportError);
    expect(error.reason).toBe("unreadable");
  });
});
