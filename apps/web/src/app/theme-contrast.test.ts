import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KINDS } from "@/lib/margin-kinds";

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

const tokenOf = (color: string) => color.replace(/^var\((.+)\)$/, "$1");

describe("margin kind colours", () => {
  const cases = THEMES.flatMap((theme) =>
    Object.entries(KINDS).map(
      ([kind, info]) => [theme, kind, info.color] as const,
    ),
  );

  it.each(
    cases,
  )("%s: the %s label reaches 4.5:1 on the page and on a raised card", (theme, _kind, color) => {
    const vars = themeVars(theme);
    const value = vars[tokenOf(color)];
    expect(value, `${theme} defines ${tokenOf(color)}`).toMatch(
      /^#[0-9a-f]{6}$/i,
    );
    expect(contrast(value, vars["--reader-bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(value, vars["--reader-surface"])).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it.each(THEMES)("%s: the muted family words reach 4.5:1 too", (theme) => {
    const vars = themeVars(theme);
    expect(
      contrast(vars["--reader-muted"], vars["--reader-bg"]),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(vars["--reader-muted"], vars["--reader-surface"]),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps one colour family per family", () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) =>
        Number.parseInt(hex.slice(i, i + 2), 16),
      );
      return { r, g, b };
    };
    const vars = themeVars("paper");
    for (const [, info] of Object.entries(KINDS)) {
      const { r, g, b } = hue(vars[tokenOf(info.color)]);
      if (info.family === "pushback") expect(r).toBeGreaterThan(b + 20);
      if (info.family === "support") expect(g).toBeGreaterThan(b);
    }
  });

  it("colours every kind's mark and dot from its own token", () => {
    for (const [kind, info] of Object.entries(KINDS))
      expect(css).toContain(
        `.annotation-mark[data-type="${kind}"] { --kind-color: ${info.color}; }`,
      );
  });
});
