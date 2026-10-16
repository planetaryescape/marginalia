import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file: string) => readFileSync(`${root}${file}`, "utf8");

const readerFiles = [
  "app/read/[articleId]/page.tsx",
  "components/article-renderer.tsx",
  "components/reflection-box.tsx",
  "components/article-back-matter.tsx",
  "components/impression-panel.tsx",
];

// Numbered ink-* and parchment-* classes are the legacy palette: they do not follow Sepia, Snow or Dusk.
const legacy =
  /(?<![\w-])(?:dark:)?(?:[\w-]+:)*(?:text|bg|border|ring|placeholder|decoration|divide)-(?:ink|parchment)-\d{2,3}/;

describe("reader colours", () => {
  it.each(
    readerFiles,
  )("%s uses theme tokens, not the legacy palette", (file) => {
    expect(read(file).match(legacy)).toBeNull();
  });

  it("draws the secondary text token from the reader's muted colour, which passes 4.5:1 in every theme", () => {
    expect(read("app/globals.css")).toMatch(
      /--ink-muted:\s*var\(--reader-muted\);/,
    );
  });
});
