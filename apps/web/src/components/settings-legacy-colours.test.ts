import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const ownedFiles = [
  "app/(desk)/feeds/page.tsx",
  "app/(desk)/account/page.tsx",
  "app/(desk)/readers/page.tsx",
  "components/readwise-card.tsx",
  "components/api-tokens.tsx",
  "components/ai-providers.tsx",
  "components/interaction-feedback.tsx",
  "components/remove-feed-confirm.tsx",
  "components/settings-section.tsx",
  "components/settings-controls.ts",
  "components/settings-confirm.tsx",
];

// Legacy palette classes (ink-*, red-*, white) are replaced by theme tokens.
const legacy =
  /(?<![\w-])(?:text|bg|border|ring|from|to|via|fill|stroke|outline|divide|placeholder|accent|decoration)-(?:ink|red|white)(?![\w-])/;

describe("settings colours", () => {
  it.each(ownedFiles)("%s uses theme tokens only", (file) => {
    const source = readFileSync(`${root}${file}`, "utf8");
    expect(source.match(legacy)).toBeNull();
  });
});
