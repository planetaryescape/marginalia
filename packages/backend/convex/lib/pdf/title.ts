import type { Block } from "./structure";

// Titles that word processors and exporters write when nobody set one
const PLACEHOLDER =
  /^(microsoft word\b|untitled|document\d*$|title$|\S+\.(docx?|indd|tex|pdf)$)/i;

/** The name a PDF is shown under: its declared title, else its first heading, else its file name. */
export function titleOf(input: {
  declared?: string;
  blocks: readonly Block[];
  fileName: string;
}): string {
  const declared = input.declared?.replace(/\s+/g, " ").trim();
  if (declared && declared.length >= 3 && !PLACEHOLDER.test(declared))
    return declared.slice(0, 200);
  const heading = input.blocks.find((b) => b.kind === "h1" || b.kind === "h2");
  if (heading && heading.text.length >= 3) return heading.text.slice(0, 200);
  return (
    input.fileName
      .replace(/\.pdf$/i, "")
      .replace(/[_-]+/g, " ")
      .trim() || "Untitled PDF"
  );
}
