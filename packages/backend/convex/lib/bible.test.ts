import { describe, expect, it } from "vitest";
import {
  parseBibleReference,
  parseBibleSearchReference,
  starterPassages,
} from "./bible";

describe("Bible references", () => {
  it.each([
    ["colosians 2", "Colossians 2"],
    ["Colossians 2", "Colossians 2"],
    ["col2:3-5", "Colossians 2:3-5"],
    ["Mathew 5", "Matthew 5"],
    ["1Corinthians13", "1 Corinthians 13"],
  ])("recognizes direct search %s deterministically as %s", (input, reference) => {
    expect(parseBibleSearchReference(input)?.reference).toBe(reference);
  });
  it.each([
    "Peter 2",
    "John 22",
    "Colosians 5",
    "about hope 2",
    "coffee 2",
    "John 3:16-4:2",
    "Colosians 2 and Romans 8",
  ])("does not guess ambiguous, invalid or topical search %s", (input) => {
    expect(parseBibleSearchReference(input)).toBeNull();
  });
  it.each([
    ["john 3:16–21", "John 3:16-21", "JHN.3.16-JHN.3.21"],
    ["Psalm 23", "Psalms 23", "PSA.23"],
    ["1 Corinthians 13", "1 Corinthians 13", "1CO.13"],
    ["Matthew 5-7", "Matthew 5-7", "MAT.5-MAT.7"],
    ["Jude 1", "Jude 1", "JUD.1"],
    ["Song of Songs 2", "Song of Solomon 2", "SNG.2"],
  ])("normalizes %s without changing the passage", (input, reference, passageId) => {
    expect(parseBibleReference(input)).toMatchObject({ reference, passageId });
  });
  it.each([
    "John 0",
    "John 22",
    "Jude 2",
    "John 3:0",
    "John 3:21-16",
    "John 1-4",
    "John 3:16; DROP TABLE",
    "https://example.com",
    "John 3:16-4:2",
    "Madeup 1",
    "John 3:177",
  ])("rejects invalid or oversized references: %s", (input) => {
    expect(parseBibleReference(input)).toBeNull();
  });
});

describe("starter passages", () => {
  it("connects a topic to relevant passages without requiring AI", () => {
    expect(starterPassages("forgiveness")).toEqual([
      expect.objectContaining({ reference: "Luke 15" }),
    ]);
    expect(starterPassages("quantum networking")).toEqual([]);
  });
  it("keeps starter passages inside the requested reading window", () => {
    const passages = starterPassages("", 1);
    expect(passages).toEqual([
      expect.objectContaining({ reference: "Psalms 23", minutes: 1 }),
    ]);
    expect(starterPassages("", 15)[0]).toMatchObject({
      reference: "Matthew 5-7",
      minutes: 15,
    });
  });
});
