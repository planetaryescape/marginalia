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
  planRevokes,
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
    expect(planFetches(20, 5, entries([]))).toEqual([5, 6]);
    expect(planFetches(20, 5, entries([[5, "pending"]]))).toEqual([6]);
    expect(
      planFetches(
        20,
        5,
        entries([
          [5, "pending"],
          [6, "pending"],
        ]),
      ),
    ).toEqual([]);
  });

  it("looks three items past the playing one and no further", () => {
    const ready = entries([
      [5, "ready"],
      [6, "ready"],
      [7, "ready"],
    ]);
    expect(planFetches(20, 5, ready)).toEqual([8]);
    const all = entries([
      [5, "ready"],
      [6, "ready"],
      [7, "ready"],
      [8, "ready"],
    ]);
    expect(planFetches(20, 5, all)).toEqual([]);
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
    );
    expect(planned).toEqual([2, 3]);
  });

  it("stops at a failure and stays inside the queue", () => {
    expect(planFetches(20, 0, entries([[1, "failed"]]))).toEqual([0]);
    expect(planFetches(2, 1, entries([]))).toEqual([1]);
  });

  it("counts pending requests that are behind the voice against the limit", () => {
    expect(planFetches(20, 9, entries([[2, "pending"]]))).toEqual([9]);
  });
});

describe("planRevokes", () => {
  it("gives back ready clips two behind the voice and keeps the one just behind", () => {
    const e = entries([
      [3, "ready"],
      [4, "ready"],
      [5, "ready"],
      [6, "ready"],
      [2, "pending"],
    ]);
    expect(planRevokes(6, e).sort()).toEqual([3, 4]);
    expect(planRevokes(4, e)).toEqual([]);
  });
});
