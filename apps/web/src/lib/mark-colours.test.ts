import { describe, expect, it } from "vitest";
import {
  ALL_MARK_COLORS,
  defaultColor,
  markColor,
  SWATCHES,
} from "./mark-colours";

const settings = { highlighter: "blue", pen: "forest" } as const;

describe("mark colours", () => {
  it("draws a mark in the colour it was saved with, whatever the setting says", () => {
    expect(markColor({ kind: "highlight", color: "pink" }, settings)).toBe(
      "pink",
    );
    expect(markColor({ kind: "underline", color: "vermilion" }, settings)).toBe(
      "vermilion",
    );
  });

  it("makes a mark without a colour follow the current setting", () => {
    expect(markColor({ kind: "highlight" }, settings)).toBe("blue");
    expect(markColor({ kind: "underline", color: null }, settings)).toBe(
      "forest",
    );
    expect(
      markColor({ kind: "highlight" }, { ...settings, highlighter: "green" }),
    ).toBe("green");
  });

  it("reads each tool's default from its own setting", () => {
    expect(defaultColor("highlight", settings)).toBe("blue");
    expect(defaultColor("underline", settings)).toBe("forest");
  });

  it("offers four dots per tool, and every dot is a known colour", () => {
    expect(SWATCHES.highlight).toHaveLength(4);
    expect(SWATCHES.underline).toHaveLength(4);
    for (const { id } of [...SWATCHES.highlight, ...SWATCHES.underline])
      expect(ALL_MARK_COLORS).toContain(id);
  });
});
