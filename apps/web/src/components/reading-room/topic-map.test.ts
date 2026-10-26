import { describe, expect, it } from "vitest";
import { outcomes } from "./topic-map";

describe("outcomes", () => {
  it("leaves out a figure of nothing", () => {
    expect(outcomes({ finished: 3, skipped: 0 })).toBe("3 finished");
  });

  it("marks lower bounds when the period had more outcomes than were read", () => {
    expect(
      outcomes({ finished: 2, skipped: 1000, outcomesPartial: true }),
    ).toBe("2+ finished · 1000+ skipped");
  });
});
