import { describe, expect, it } from "vitest";
import {
  advanceProgress,
  type BookProgress,
  bookCandidate,
  nextUnitIndex,
  type OutlineUnit,
} from "./bookPicks";

const outline: OutlineUnit[] = [3, 5, 7, 9, 12].map((minutes, i) => ({
  title: `Part ${i + 1}`,
  minutes,
}));
const fresh: BookProgress = { finishedThrough: -1, furthestUnit: -1 };

describe("nextUnitIndex", () => {
  it("starts a book at its first unit", () => {
    expect(nextUnitIndex(fresh)).toBe(0);
  });
  it("is the unit after the last one finished", () => {
    expect(nextUnitIndex({ finishedThrough: 1, furthestUnit: 1 })).toBe(2);
  });
  it("keeps a unit the reader is in the middle of as the next one", () => {
    expect(nextUnitIndex({ finishedThrough: 1, furthestUnit: 2 })).toBe(2);
  });
  it("counts a unit as read once the reader has moved past it", () => {
    expect(nextUnitIndex({ finishedThrough: -1, furthestUnit: 3 })).toBe(3);
  });
});

describe("bookCandidate", () => {
  it("offers the next unit when it fits", () => {
    expect(
      bookCandidate({ finishedThrough: 1, furthestUnit: 1 }, outline, 10),
    ).toEqual({ unitIndex: 2, title: "Part 3", minutes: 7, of: 5 });
  });

  it("offers nothing from the book when the next unit does not fit", () => {
    // Part 3 is 7 minutes; part 1 would fit 5 minutes but is already read
    expect(
      bookCandidate({ finishedThrough: 1, furthestUnit: 1 }, outline, 5),
    ).toBeNull();
  });

  it("never offers a later unit that fits in the next one's place", () => {
    const longThenShort: OutlineUnit[] = [
      { title: "a", minutes: 10 },
      { title: "b", minutes: 2 },
    ];
    expect(bookCandidate(fresh, longThenShort, 5)).toBeNull();
  });

  it("offers nothing once the book is read to the end", () => {
    expect(
      bookCandidate({ finishedThrough: 4, furthestUnit: 4 }, outline, 180),
    ).toBeNull();
  });

  it("accepts a unit exactly as long as the window", () => {
    expect(bookCandidate(fresh, outline, 3)?.unitIndex).toBe(0);
  });
});

describe("advanceProgress", () => {
  const start = { ...fresh, furthestScroll: 0 };

  it("ignores a glance", () => {
    expect(advanceProgress(start, { unitIndex: 0, scrollPercent: 2 })).toEqual(
      start,
    );
  });
  it("records how far into a unit the reader got", () => {
    expect(advanceProgress(start, { unitIndex: 0, scrollPercent: 40 })).toEqual(
      {
        finishedThrough: -1,
        furthestUnit: 0,
        furthestScroll: 40,
      },
    );
  });
  it("marks a unit done near its end", () => {
    expect(
      advanceProgress(start, { unitIndex: 0, scrollPercent: 95 }),
    ).toMatchObject({ finishedThrough: 0, furthestUnit: 0 });
  });
  it("never moves backward", () => {
    const ahead = { finishedThrough: 3, furthestUnit: 4, furthestScroll: 60 };
    expect(advanceProgress(ahead, { unitIndex: 1, scrollPercent: 99 })).toEqual(
      ahead,
    );
  });
});
