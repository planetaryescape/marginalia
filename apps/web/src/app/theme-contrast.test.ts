import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("./globals.css", import.meta.url)),
  "utf8",
);

const THEMES = ["paper", "night", "sepia", "snow", "dusk", "ink"] as const;

/** Custom properties declared by the rule that targets this reader theme. */
function themeVars(theme: string): Record<string, string> {
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
    ([, selector, body]) =>
      selector.includes(`html[data-reader-theme="${theme}"]`) &&
      body.includes("--reader-bg"),
  );
  if (!rule) throw new Error(`no rule for theme ${theme}`);
  return Object.fromEntries(
    [...rule[2].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]),
  );
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("--pencil contrast", () => {
  it("computes the WCAG ratio for a known pair", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it.each(THEMES)("reaches 4.5:1 on the %s reader background", (theme) => {
    const vars = themeVars(theme);
    expect(vars["--pencil"], `${theme} defines --pencil`).toMatch(
      /^#[0-9a-f]{6}$/i,
    );
    expect(
      contrast(vars["--pencil"], vars["--reader-bg"]),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
