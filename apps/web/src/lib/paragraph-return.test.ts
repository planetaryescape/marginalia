import { describe, expect, it } from "vitest";
import {
  MAX_RETURN_ENTRIES,
  pushReturn,
  type ReturnEntry,
  returnedTo,
} from "./paragraph-return";

const at = (scrollY: number, paragraph = 0): ReturnEntry => ({
  scrollY,
  paragraph,
});

describe("pushReturn", () => {
  it("adds the place a jump started from", () => {
    expect(pushReturn([], at(100, 1), 800)).toEqual([at(100, 1)]);
  });

  it("stacks jumps made from far apart places", () => {
    const first = pushReturn([], at(100), 800);
    expect(pushReturn(first, at(2000, 9), 800)).toEqual([at(100), at(2000, 9)]);
  });

  it("adds nothing for a jump made within a viewport of the newest entry", () => {
    const stack = [at(100)];
    expect(pushReturn(stack, at(500), 800)).toBe(stack);
  });

  it("keeps at most the newest entries", () => {
    let stack: ReturnEntry[] = [];
    for (let i = 0; i < MAX_RETURN_ENTRIES + 3; i++)
      stack = pushReturn(stack, at(i * 2000, i), 800);
    expect(stack).toHaveLength(MAX_RETURN_ENTRIES);
    expect(stack[0].paragraph).toBe(3);
    expect(stack[stack.length - 1].paragraph).toBe(MAX_RETURN_ENTRIES + 2);
  });
});

describe("returnedTo", () => {
  it("drops the newest entry once the reader is back within a viewport of it", () => {
    expect(returnedTo([at(100), at(2000)], 2300, 800)).toEqual([at(100)]);
  });

  it("keeps the stack while the reader is further away", () => {
    const stack = [at(100)];
    expect(returnedTo(stack, 1000, 800)).toBe(stack);
  });

  it("returns the same array when there is nothing to drop", () => {
    const stack: ReturnEntry[] = [];
    expect(returnedTo(stack, 0, 800)).toBe(stack);
  });
});
