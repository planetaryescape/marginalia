import { describe, expect, it } from "vitest";
import {
  chunkPassages,
  inBatches,
  MAX_PASSAGES_PER_UNIT,
  outlineText,
  PASSAGE_TOKENS,
  passageEmbedText,
  passageTokens,
} from "./bookIndex";

const para = (n: number, chars: number) => `P${n} ${"x".repeat(chars)}`;

describe("chunkPassages", () => {
  it("packs paragraphs into passages of about 300 tokens under the heading", () => {
    const content = Array.from({ length: 12 }, (_, n) => para(n, 500)).join(
      "\n\n",
    );
    const passages = chunkPassages("Book › Part", content);
    expect(passages.length).toBeGreaterThan(3);
    for (const passage of passages) {
      expect(passage.heading).toBe("Book › Part");
      expect(passage.text.length).toBeLessThanOrEqual(PASSAGE_TOKENS * 4);
    }
    // Nothing is lost or reordered
    expect(passages.map((p) => p.text).join("\n\n")).toBe(content);
  });

  it("splits a paragraph that is longer than a passage, at sentences", () => {
    const sentence = "A sentence of moderate length goes here. ";
    const passages = chunkPassages("H", sentence.repeat(100));
    expect(passages.length).toBeGreaterThan(2);
    for (const passage of passages) {
      expect(passage.text.length).toBeLessThanOrEqual(PASSAGE_TOKENS * 4);
      expect(passage.text.endsWith(".")).toBe(true);
    }
  });

  it("skips empty paragraphs and caps what one unit can make", () => {
    expect(chunkPassages("H", "\n\n  \n\n")).toEqual([]);
    const huge = Array.from({ length: 900 }, (_, n) => para(n, 1_100)).join(
      "\n\n",
    );
    expect(chunkPassages("H", huge)).toHaveLength(MAX_PASSAGES_PER_UNIT);
  });

  it("embeds a passage with its heading, so a match knows its part", () => {
    expect(passageEmbedText({ heading: "H", text: "T" })).toBe("H\n\nT");
    expect(passageTokens([{ heading: "H", text: "T" }])).toBe(1);
  });
});

describe("inBatches", () => {
  it("cuts a list into batches no bigger than the size", () => {
    expect(inBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(inBatches([], 3)).toEqual([]);
  });
});

describe("outlineText", () => {
  const lines = Array.from({ length: 300 }, (_, i) => ({
    title: `Part title ${i + 1}`,
    summary: i % 5 === 0 ? null : `Summary ${i + 1} ${"y".repeat(250)}`,
  }));

  it("lists every part with its summary where there is one", () => {
    const text = outlineText(lines.slice(0, 3), { budget: 10_000 });
    expect(text).toContain("Part 1: Part title 1\n");
    expect(text).toContain("Part 2: Part title 2. Summary 2");
  });

  it("stays within the budget, keeping every title and the summaries nearest the part on screen", () => {
    const text = outlineText(lines, { around: 150, budget: 14_000 });
    expect(text.length).toBeLessThanOrEqual(14_000);
    expect(text).toContain("Part 1: Part title 1");
    expect(text).toContain("Part 152: Part title 152. Summary 152");
    expect(text).not.toContain("Summary 2 ");
  });
});
