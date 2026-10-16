import { describe, expect, it } from "vitest";
import {
  describeDuration,
  readingSentence,
  type SentenceInput,
} from "./reading-sentence";

const slot = (weekday: number, hour: number) => weekday * 24 + hour;
const grid = (cells: [number, number, number][]) => {
  const g = new Array<number>(168).fill(0);
  for (const [d, h, n] of cells) g[slot(d, h)] += n;
  return g;
};
const empty = () => grid([]);
const input = (over: Partial<SentenceInput>): SentenceInput => ({
  period: "month",
  activeTimeMs: 6 * 3_600_000,
  readingDays: 19,
  heat: empty(),
  shortSlots: empty(),
  longSlots: empty(),
  ...over,
});

describe("readingSentence", () => {
  it("says there is no reading yet for an empty period", () => {
    expect(readingSentence(input({ activeTimeMs: 0, readingDays: 0 }))).toBe(
      "No reading yet this month.",
    );
    expect(
      readingSentence(
        input({ period: "30days", activeTimeMs: 0, readingDays: 0 }),
      ),
    ).toBe("No reading yet in the last 30 days.");
  });

  it("treats under a minute of reading as none", () => {
    expect(readingSentence(input({ activeTimeMs: 59_000 }))).toBe(
      "No reading yet this month.",
    );
  });

  it("names when short and long reads happen", () => {
    expect(
      readingSentence(
        input({
          // Weekday early mornings, spread over Mon to Fri
          shortSlots: grid([
            [0, 7, 3],
            [1, 8, 3],
            [2, 7, 2],
            [3, 6, 2],
          ]),
          // Saturday afternoons
          longSlots: grid([
            [5, 14, 2],
            [5, 15, 2],
            [6, 10, 1],
          ]),
        }),
      ),
    ).toBe(
      "This month you read for 6 hours over 19 days, mostly short reads before 9 a.m. and long ones on Saturday afternoons.",
    );
  });

  it("uses the part of the day alone when no one weekday stands out", () => {
    expect(
      readingSentence(
        input({
          period: "90days",
          shortSlots: grid([
            [0, 20, 1],
            [1, 20, 1],
            [2, 21, 1],
            [3, 19, 1],
            [4, 20, 1],
          ]),
        }),
      ),
    ).toBe(
      "In the last 90 days you read for 6 hours over 19 days, mostly short reads in the evening.",
    );
  });

  it("mentions only the length that has a pattern", () => {
    expect(readingSentence(input({ longSlots: grid([[5, 14, 4]]) }))).toBe(
      "This month you read for 6 hours over 19 days, with long reads mostly on Saturday afternoons.",
    );
  });

  it("falls back to the busiest part of the day, or to no pattern at all", () => {
    expect(
      readingSentence(
        input({
          heat: grid([
            [0, 23, 30],
            [1, 23, 30],
            [2, 22, 30],
            [3, 1, 30],
          ]),
        }),
      ),
    ).toBe(
      "This month you read for 6 hours over 19 days, mostly late at night.",
    );
    // Evenly spread, nothing to say
    expect(
      readingSentence(
        input({
          readingDays: 1,
          activeTimeMs: 45 * 60_000,
          heat: grid([
            [0, 2, 10],
            [0, 7, 10],
            [0, 10, 10],
            [0, 14, 10],
            [0, 20, 10],
          ]),
        }),
      ),
    ).toBe("This month you read for 45 minutes over 1 day.");
  });

  it("ignores a pattern from fewer than three reads", () => {
    expect(readingSentence(input({ shortSlots: grid([[0, 7, 2]]) }))).toBe(
      "This month you read for 6 hours over 19 days.",
    );
  });
});

describe("describeDuration", () => {
  it("rounds to a readable length", () => {
    expect(describeDuration(60_000)).toBe("1 minute");
    expect(describeDuration(45 * 60_000)).toBe("45 minutes");
    expect(describeDuration(60 * 60_000)).toBe("1 hour");
    expect(describeDuration(80 * 60_000)).toBe("1 hour 30 minutes");
    expect(describeDuration(105 * 60_000)).toBe("2 hours");
    expect(describeDuration(6 * 3_600_000 + 5 * 60_000)).toBe("6 hours");
    expect(describeDuration(12 * 3_600_000 + 40 * 60_000)).toBe("13 hours");
  });
});
