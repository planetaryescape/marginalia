import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("./globals.css", import.meta.url)),
  "utf8",
);

describe("focus-frame keyboard focus contract", () => {
  it("lets the opt-in inner reset outrank the global focus-visible outline", () => {
    expect(css).toMatch(
      /\.focus-frame\s+:is\(input,\s*textarea,\s*\[contenteditable\]\)\.outline-none:focus-visible\s*\{\s*outline:\s*none;/,
    );
  });

  it("moves keyboard focus indication to the containing frame", () => {
    expect(css).toMatch(
      /\.focus-frame:has\(:is\(input,\s*textarea,\s*\[contenteditable\]\):focus-visible\)\s*\{\s*outline:\s*1px solid var\(--reader-focus\);\s*outline-offset:\s*3px;/,
    );
  });
});
