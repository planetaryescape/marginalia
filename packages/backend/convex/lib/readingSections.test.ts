import { describe, expect, it } from "vitest";
import { sectionRanges, sectionToQueueFrom } from "./readingSections";

const text = Array.from(
  { length: 800 },
  (_, i) => `Claim ${i} holds in this setting.`,
).join(" ");

describe("sectionRanges", () => {
  it("says where each section sits in the text", () => {
    const ranges = sectionRanges(text);
    expect(ranges.length).toBeGreaterThan(3);
    for (const section of ranges)
      expect(text.slice(section.start, section.end)).toBe(section.text);
    expect(ranges.map((s) => s.index)).toEqual(ranges.map((_, i) => i));
  });

  it("keeps offsets exact when a section begins with whitespace", () => {
    const padded = `\n\n  ${text}`;
    for (const section of sectionRanges(padded))
      expect(padded.slice(section.start, section.end)).toBe(section.text);
  });
});

describe("sectionToQueueFrom", () => {
  const ranges = sectionRanges(text);
  const at = (offset: number) => offset / text.length;

  it("waits until the reader is 40% through the section", () => {
    const [first] = ranges;
    const size = first.end - first.start;
    expect(
      sectionToQueueFrom(ranges, at(first.start + size * 0.2), text.length),
    ).toBeNull();
    expect(
      sectionToQueueFrom(ranges, at(first.start + size * 0.45), text.length),
    ).toBe(0);
  });

  it("names the section being read, so only the one after it is asked for", () => {
    const third = ranges[2];
    const size = third.end - third.start;
    expect(
      sectionToQueueFrom(ranges, at(third.start + size * 0.6), text.length),
    ).toBe(2);
  });

  it("has nothing to queue in the last section or a single-section text", () => {
    const last = ranges[ranges.length - 1];
    expect(
      sectionToQueueFrom(ranges, at(last.start + 10), text.length),
    ).toBeNull();
    expect(sectionToQueueFrom(ranges, 1, text.length)).toBeNull();
    const short = sectionRanges("A short piece.");
    expect(sectionToQueueFrom(short, 0.9, 14)).toBeNull();
  });
});
