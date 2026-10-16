import { describe, expect, it } from "vitest";
import { titleOf } from "./title";

const h1 = {
  kind: "h1" as const,
  text: "A Field Guide to Slow Software",
  page: 1,
};

describe("titleOf", () => {
  it("prefers the title the PDF declares", () => {
    expect(
      titleOf({
        declared: " Thinking  in Systems ",
        blocks: [h1],
        fileName: "x.pdf",
      }),
    ).toBe("Thinking in Systems");
  });
  it("ignores a placeholder title from a word processor", () => {
    expect(
      titleOf({
        declared: "Microsoft Word - draft3.docx",
        blocks: [h1],
        fileName: "x.pdf",
      }),
    ).toBe(h1.text);
    expect(
      titleOf({ declared: "report.docx", blocks: [h1], fileName: "x.pdf" }),
    ).toBe(h1.text);
  });
  it("falls back to the file name without its extension", () => {
    expect(
      titleOf({
        blocks: [{ kind: "p", text: "Body", page: 1 }],
        fileName: "slow_software-notes.pdf",
      }),
    ).toBe("slow software notes");
  });
});
