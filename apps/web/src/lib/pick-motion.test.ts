import { describe, expect, it } from "vitest";
import { MOVE, pickTransition, QUICK } from "./pick-motion";

describe("pickTransition", () => {
  it("fades the first pick in over 160 ms", () => {
    expect(pickTransition(0, false)).toBe(QUICK);
    expect(QUICK.duration).toBe(0.16);
  });

  it("shows the first pick at once with reduced motion", () => {
    expect(pickTransition(0, true)).toEqual({ duration: 0 });
  });

  it("slides later picks", () => {
    expect(pickTransition(1, false)).toBe(MOVE);
    expect(pickTransition(-1, true)).toBe(MOVE);
  });
});
