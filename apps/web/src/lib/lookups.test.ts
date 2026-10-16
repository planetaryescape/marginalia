import { describe, expect, it } from "vitest";
import { senseOf, sentenceAround } from "./lookups";

describe("sentenceAround", () => {
  const paragraph =
    "The path climbed all morning. It reached a still tarn by noon. Nobody spoke.";
  it("returns the sentence holding the word", () => {
    expect(sentenceAround(paragraph, "tarn")).toBe(
      "It reached a still tarn by noon.",
    );
    expect(sentenceAround(paragraph, "Nobody")).toBe("Nobody spoke.");
  });
  it("matches across case and spacing", () => {
    expect(sentenceAround(paragraph, "  STILL   tarn ")).toBe(
      "It reached a still tarn by noon.",
    );
  });
  it("falls back to the paragraph when the word cannot be found", () => {
    expect(sentenceAround(paragraph, "glacier")).toBe(paragraph);
    expect(sentenceAround("", "tarn")).toBe("");
  });
});

describe("senseOf", () => {
  it("takes the first sentence of the first paragraph without markup", () => {
    expect(
      senseOf(
        "**tarn** (noun): a small mountain lake, see ¶2. It is common.\n\nMore.",
      ),
    ).toBe("tarn (noun): a small mountain lake, see .");
  });
  it("strips links and code", () => {
    expect(senseOf("A [lake](https://example.com) called `tarn`. Ok.")).toBe(
      "A lake called tarn.",
    );
  });
  it("returns the whole line when there is no full stop", () => {
    expect(senseOf("a small lake")).toBe("a small lake");
  });
});
