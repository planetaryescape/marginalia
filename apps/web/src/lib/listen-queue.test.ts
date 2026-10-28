import { describe, expect, it } from "vitest";
import {
  buildQueue,
  type ClipStatus,
  firstItemFrom,
  gapAfter,
  LOOKAHEAD,
  MAX_IN_FLIGHT,
  nextBlockItem,
  planFetches,
  previousItem,
  type QueueItem,
  TITLE_BLOCK,
} from "./listen-queue";
import type { SpokenBlock } from "./spoken-text";

const prose = (n: number): SpokenBlock => ({
  text: `Block ${n} is short.`,
  heading: false,
});
const long = (sentences: number): SpokenBlock => ({
  text: Array.from(
    { length: sentences },
    (_v, i) => `Sentence ${i} is plain.`,
  ).join(" "),
  heading: false,
});
const heading = (n: number): SpokenBlock => ({
  text: `Heading ${n}.`,
  heading: true,
});
const shape = (queue: QueueItem[]) => queue.map((i) => `${i.block}.${i.part}`);

describe("buildQueue", () => {
  it("gives skipped blocks no items and long blocks several parts, in order", () => {
    const queue = buildQueue([prose(0), null, long(300), prose(3)], 0, "en");
    const parts = queue.filter((i) => i.block === 2);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.map((i) => i.part)).toEqual(parts.map((_p, n) => n));
    expect(queue.filter((i) => i.block === 1)).toHaveLength(0);
    expect(shape(queue)[0]).toBe("0.0");
    expect(shape(queue).at(-1)).toBe("3.0");
    expect(queue.map((i) => i.block)).toEqual(
      [...queue.map((i) => i.block)].sort((a, b) => a - b),
    );
  });

  it("starts the block it is asked to start at with a lead item of at most 300 characters", () => {
    const blocks = [prose(0), long(60), long(60)];
    const queue = buildQueue(blocks, 1, "en");
    const starting = queue.filter((i) => i.block === 1);
    expect(starting[0].text.length).toBeLessThanOrEqual(300);
    expect(starting.length).toBeGreaterThan(1);
    // Other blocks keep the normal packing: one part when under 2,000 characters
    expect(queue.filter((i) => i.block === 2)).toHaveLength(1);
    expect(starting.map((i) => i.text).join(" ")).toBe(blocks[1]?.text);
  });

  it("opens a listen from the top with the title, and not one from further down", () => {
    const blocks = [prose(0), prose(1)];
    const top = buildQueue(blocks, 0, "en", "A Title. By Ann.");
    expect(shape(top)).toEqual(["-1.0", "0.0", "1.0"]);
    expect(firstItemFrom(top, TITLE_BLOCK)).toBe(0);
    expect(buildQueue(blocks, 1, "en", "A Title. By Ann.")).toHaveLength(2);
    expect(buildQueue(blocks, 0, "en")).toHaveLength(2);
  });

  it("leads with the first block that will be read when the start block is skipped", () => {
    const blocks = [prose(0), null, long(60), long(60)];
    const queue = buildQueue(blocks, 1, "en");
    const first = queue.find((i) => i.block === 2);
    expect(first?.text.length).toBeLessThanOrEqual(300);
    // Only that block leads: the block after it packs normally
    expect(queue.filter((i) => i.block === 3)).toHaveLength(1);
    // Nothing is dropped
    expect(
      queue
        .filter((i) => i.block === 2)
        .map((i) => i.text)
        .join(" "),
    ).toBe(blocks[2]?.text);
  });

  it("caps a first sentence longer than 300 units and keeps all of its text", () => {
    const words = Array.from({ length: 300 }, (_v, n) => `word${n}`).join(" ");
    const sentence = `${words}.`;
    const queue = buildQueue(
      [{ text: `${sentence} Then a short one.`, heading: false }],
      0,
      "en",
    );
    expect(queue[0].text.length).toBeLessThanOrEqual(300);
    expect(queue.map((i) => i.text).join(" ")).toBe(
      `${sentence} Then a short one.`,
    );
  });

  it("caps a long title too", () => {
    const title = `${"A very long title ".repeat(40)}ends here.`;
    const queue = buildQueue([prose(0)], 0, "en", title);
    expect(queue[0].block).toBe(TITLE_BLOCK);
    expect(queue[0].text.length).toBeLessThanOrEqual(300);
  });

  it("carries the heading flag onto every part", () => {
    const queue = buildQueue([heading(0), prose(1)], 0, "en");
    expect(queue.map((i) => i.heading)).toEqual([true, false]);
  });
});

describe("moving through the queue", () => {
  const queue = buildQueue([prose(0), null, long(300), heading(3)], 0, "en");
  const secondBlockFirst = queue.findIndex((i) => i.block === 2);

  it("finds the first item at or after a block, skipping blocks with none", () => {
    expect(firstItemFrom(queue, 1)).toBe(secondBlockFirst);
    expect(firstItemFrom(queue, 9)).toBeNull();
  });

  it("goes next to the next block's first item, across parts", () => {
    expect(nextBlockItem(queue, 0)).toBe(secondBlockFirst);
    expect(nextBlockItem(queue, secondBlockFirst + 1)).toBe(queue.length - 1);
    expect(nextBlockItem(queue, queue.length - 1)).toBeNull();
  });

  it("goes previous to the block start after 3 s, else to the previous block's first item", () => {
    const part2 = secondBlockFirst + 2;
    expect(previousItem(queue, part2, 3.5)).toBe(secondBlockFirst);
    expect(previousItem(queue, part2, 1)).toBe(0);
    expect(previousItem(queue, 0, 1)).toBe(0);
    expect(previousItem(queue, queue.length - 1, 0)).toBe(secondBlockFirst);
  });

  it("adds the gap between blocks, a longer one after a heading, none between parts or when hidden", () => {
    const q = buildQueue([heading(0), prose(1), long(300)], 0, "en");
    expect(gapAfter(q, 0, false)).toBe(700);
    expect(gapAfter(q, 1, false)).toBe(350);
    expect(gapAfter(q, 1, true)).toBe(0);
    const inner = q.findIndex((i) => i.block === 2);
    expect(gapAfter(q, inner, false)).toBe(0);
    expect(gapAfter(q, q.length - 1, false)).toBe(0);
  });
});

const entries = (pairs: [number, ClipStatus][]) => new Map(pairs);

describe("planFetches", () => {
  it("asks for the playing item and then the ones ahead, two at a time", () => {
    expect(planFetches(20, 5, entries([]), 0)).toEqual([5, 6]);
    expect(planFetches(20, 5, entries([[5, "pending"]]), 1)).toEqual([6]);
    expect(
      planFetches(
        20,
        5,
        entries([
          [5, "pending"],
          [6, "pending"],
        ]),
        2,
      ),
    ).toEqual([]);
  });

  it("looks three items past the playing one and no further", () => {
    const ready = entries([
      [5, "ready"],
      [6, "ready"],
      [7, "ready"],
    ]);
    expect(planFetches(20, 5, ready, 0)).toEqual([8]);
    const all = entries([
      [5, "ready"],
      [6, "ready"],
      [7, "ready"],
      [8, "ready"],
    ]);
    expect(planFetches(20, 5, all, 0)).toEqual([]);
    expect(LOOKAHEAD).toBe(3);
    expect(MAX_IN_FLIGHT).toBe(2);
  });

  it("never plans an item that already has an entry, whatever its status", () => {
    const planned = planFetches(
      20,
      0,
      entries([
        [0, "ready"],
        [1, "ready"],
      ]),
      0,
    );
    expect(planned).toEqual([2, 3]);
  });

  it("stops at a failure and stays inside the queue", () => {
    expect(planFetches(20, 0, entries([[1, "failed"]]), 0)).toEqual([0]);
    expect(planFetches(2, 1, entries([]), 0)).toEqual([1]);
  });

  it("counts requests a Stop or restart left unsettled against the limit", () => {
    expect(planFetches(20, 9, entries([]), 2)).toEqual([]);
    expect(planFetches(20, 9, entries([]), 1)).toEqual([9]);
  });
});
