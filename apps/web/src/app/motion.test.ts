import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("./globals.css", import.meta.url)),
  "utf8",
);

/** The text of every `@media (prefers-reduced-motion: reduce)` block, braces balanced. */
function reducedBlocks() {
  const blocks: string[] = [];
  const start = /@media \(prefers-reduced-motion: reduce\) \{/g;
  for (let m = start.exec(css); m; m = start.exec(css)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const from = i;
    while (depth && i < css.length) {
      if (css[i] === "{") depth++;
      if (css[i] === "}") depth--;
      i++;
    }
    blocks.push(css.slice(from, i - 1));
  }
  return blocks.join("\n");
}

describe("motion tokens", () => {
  it("keeps the five tokens at the blueprint's durations and easings", () => {
    const token = (name: string) =>
      css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1];
    expect(token("page-duration")).toBe("320ms");
    expect(token("page-ease")).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
    expect(token("sweep-duration")).toBe("180ms");
    expect(token("motion-press")).toBe("90ms ease-out");
    expect(token("motion-quick")).toBe("160ms cubic-bezier(0.2, 0.8, 0.2, 1)");
    expect(token("motion-move")).toBe("240ms cubic-bezier(0.2, 0.8, 0.2, 1)");
    expect(token("motion-page")).toBe("var(--page-duration) var(--page-ease)");
    expect(token("motion-sweep")).toBe("var(--sweep-duration) linear");
  });
});

describe("reduced motion has a form for every moment", () => {
  const reduced = reducedBlocks();

  it("swaps the route at once and keeps only a 120 ms cross-fade for finishing", () => {
    expect(reduced).toMatch(/::view-transition-group\(\*\)/);
    expect(reduced).toMatch(/animation-duration: 0s !important/);
    expect(reduced).toMatch(
      /active-view-transition-type\(finish-article\)::view-transition-old\(root\)[^}]*vt-fade-out 120ms/,
    );
    expect(reduced).toMatch(
      /active-view-transition-type\(finish-article\)::view-transition-new\(root\)[^}]*vt-fade-in 120ms/,
    );
  });

  it("fades the body in over 120 ms after an instant opening", () => {
    expect(reduced).toMatch(/\.reader-arriving > :not\(header\)[^}]*120ms/);
  });

  it("fades the next pick in without sliding", () => {
    const rule = reduced.match(
      /\[data-arrival\^="finish"\] > \*\s*\{([^}]*)\}/,
    );
    expect(rule?.[1]).toContain("vt-fade-in 120ms");
    expect(rule?.[1]).not.toContain("slot-arrive");
  });

  it("fades Saved and errors over 120 ms, and holds the change wash for 600 ms", () => {
    expect(reduced).toMatch(/\.saved-mark \{ animation: saved-mark-reduced/);
    expect(reduced).toMatch(/\.inline-error \{ animation: vt-fade-in 120ms/);
    expect(reduced).toMatch(/change-wash-reduced 720ms/);
    expect(css).toMatch(/@keyframes change-wash-reduced \{\s*0%, 83\.333%/);
  });

  it("does not run motion outside the no-preference or reduced branches", () => {
    // The pen tick and the pick's slide are only defined for users who allow motion
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*\.sidenote-tick \{ animation/,
    );
    expect(reduced).not.toMatch(/\.sidenote-tick/);
  });
});

describe("the title morph", () => {
  it("runs one group for the page duration and gives the toolbar its own group above it", () => {
    expect(css).toMatch(
      /::view-transition-group\(\.article-title\) \{\s*animation-duration: var\(--page-duration\)/,
    );
    expect(css).toMatch(
      /::view-transition-group\(\.reader-toolbar\) \{ z-index: 100; animation: none; \}/,
    );
  });

  it("keeps clicks reaching the page during the transition", () => {
    expect(css).toMatch(/::view-transition \{ pointer-events: none; \}/);
  });

  it("no longer overrides the root animations for every route change", () => {
    expect(css).not.toMatch(/^\s*::view-transition-(old|new)\(root\)/m);
  });
});
