import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  parseReaderSettings,
  webSearchEnabled,
} from "./reader-settings";

describe("reader preferences", () => {
  it.each([
    null,
    [],
    "invalid",
    42,
  ])("repairs invalid storage roots", (value) => {
    expect(parseReaderSettings(value)).toEqual(DEFAULT_SETTINGS);
  });
  it("keeps valid preferences while repairing removed choices and impossible sizes", () => {
    expect(
      parseReaderSettings({
        theme: "sepia",
        pen: "forest",
        typeface: "removed",
        size: 999,
        map: false,
        dropCapLines: -1,
      }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      theme: "sepia",
      pen: "forest",
      map: false,
    });
  });
  it("fills missing settings without persisting unknown keys", () => {
    expect(parseReaderSettings({ theme: "night", oldFeature: true })).toEqual({
      ...DEFAULT_SETTINGS,
      theme: "night",
    });
  });
  it.each([
    ["off", "quick", false],
    ["off", "deep", false],
    ["deep", "quick", false],
    ["deep", "deep", true],
    ["always", "quick", true],
    ["always", "deep", true],
  ] as const)("applies the %s web policy for %s answers", (webSearch, answerDepth, enabled) => {
    expect(
      webSearchEnabled({ ...DEFAULT_SETTINGS, webSearch, answerDepth }),
    ).toBe(enabled);
  });
});
