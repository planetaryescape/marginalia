import { describe, expect, it } from "vitest";
import { answerPreview } from "./answer-preview";

describe("answerPreview", () => {
  it("strips bold, italics, code and links to their text", () => {
    expect(
      answerPreview(
        "A **small** lake, *transducere* in `code`, see [the wiki](https://example.com/w).",
      ),
    ).toBe("A small lake, transducere in code, see the wiki.");
  });

  it("drops list markers at line starts and joins the items", () => {
    expect(answerPreview("Three points:\n- first\n* second\n\nDone.")).toBe(
      "Three points: first second Done.",
    );
  });

  it("keeps a hyphen or asterisk that sits inside a sentence", () => {
    expect(answerPreview("Well - known, and 5 * 3 * 2 = 30.")).toBe(
      "Well - known, and 5 * 3 * 2 = 30.",
    );
  });
});
