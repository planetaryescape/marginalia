import { describe, expect, it } from "vitest";
import { excerptOf } from "./ingest";

describe("excerptOf", () => {
  it("drops an emoji the 300-character cut would split", () => {
    const text = `${"a".repeat(299)}😀 and more`;
    const excerpt = excerptOf(text);
    expect(excerpt).toBe("a".repeat(299));
    expect(excerpt.isWellFormed()).toBe(true);
  });

  it("keeps an emoji that fits whole", () => {
    const text = `${"a".repeat(298)}😀 and more`;
    expect(excerptOf(text)).toBe(`${"a".repeat(298)}😀`);
  });

  it("returns short text unchanged", () => {
    expect(excerptOf("short 😀")).toBe("short 😀");
  });
});
