import { describe, expect, it } from "vitest";
import {
  chunkPassages,
  fairBatch,
  groupSpans,
  inBatches,
  MAX_PASSAGES_PER_UNIT,
  outlineText,
  PASSAGE_TOKENS,
  passageEmbedText,
  passageTokens,
  reduceSpans,
  spansOf,
  spansText,
} from "./bookIndex";

const para = (n: number, chars: number) => `P${n} ${"x".repeat(chars)}`;

describe("fairBatch", () => {
  it("carries the odd slot to the other lane without reordering either lane", () => {
    const lanes = { summary: [0, 1, 2, 3, 4], passages: [10, 11, 12, 13, 14] };
    const first = fairBatch(lanes, "summary");
    expect(first.jobs.map((job) => job.value)).toEqual([0, 10, 1, 11, 2]);
    const second = fairBatch(
      { summary: [3, 4, 5], passages: [12, 13, 14] },
      first.nextLane,
    );
    expect(second.jobs.map((job) => job.value)).toEqual([12, 3, 13, 4, 14]);
  });

  it("lends idle slots but never opens a second five-job pool", () => {
    expect(
      fairBatch(
        { summary: [], passages: [0, 1, 2, 3, 4, 5] },
        "summary",
      ).jobs.map((job) => job.value),
    ).toEqual([0, 1, 2, 3, 4]);
    expect(fairBatch({ summary: [1], passages: [] }, "passages").jobs).toEqual([
      { stage: "summary", value: 1 },
    ]);
    expect(fairBatch({ summary: [], passages: [] }, "passages").jobs).toEqual(
      [],
    );
  });
});

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

describe("reduceSpans", () => {
  const lines = Array.from({ length: 1_500 }, (_, i) => ({
    title: `Chapter ${i + 1}`,
    summary: `Summary of part ${i + 1} ${"z".repeat(280)}`,
  }));

  it("covers a 1,500-part outline to its last part within two levels", async () => {
    const calls: number[] = [];
    const sizes: number[] = [];
    const spans = await reduceSpans(spansOf(lines), async (group) => {
      calls.push(group.length);
      sizes.push(spansText(group).length);
      return `covers ${group[0].first} to ${group[group.length - 1].last}`;
    });
    // Every part is covered once, in order, from the first to the last
    expect(spans[0].first).toBe(1);
    expect(spans[spans.length - 1].last).toBe(1_500);
    for (const [i, span] of spans.entries())
      if (i > 0) expect(span.first).toBe(spans[i - 1].last + 1);
    // It fits one call, and no call was sent more than a group's budget
    expect(spansText(spans).length).toBeLessThanOrEqual(14_000);
    expect(spansText(spans)).toContain("–1500");
    expect(Math.max(...sizes)).toBeLessThanOrEqual(12_400);
    // 1,500 parts need two levels, so not one call per part
    expect(calls.length).toBeLessThan(80);
  });

  it("leaves an outline that fits as it is, with no calls", async () => {
    const spans = await reduceSpans(spansOf(lines.slice(0, 5)), async () => {
      throw new Error("not needed");
    });
    expect(spans).toHaveLength(5);
  });

  it("groups consecutive spans, at least two to a group", () => {
    const groups = groupSpans(spansOf(lines.slice(0, 40)), 1_000);
    expect(groups.flat().map((s) => s.first)).toEqual(
      Array.from({ length: 40 }, (_, i) => i + 1),
    );
    expect(groups.every((g) => g.length >= 2 || g === groups.at(-1))).toBe(
      true,
    );
  });
});
