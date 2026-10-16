import {
  HIGHLIGHTER_COLORS,
  type HighlighterColor,
  type MarkColor,
  type MarkKind,
  PEN_COLORS,
  type PenColor,
} from "@marginalia/backend/mark-colours";

export {
  HIGHLIGHTER_COLORS,
  type HighlighterColor,
  type MarkColor,
  PEN_COLORS,
  type PenColor,
};

export const ALL_MARK_COLORS: readonly MarkColor[] = [
  ...HIGHLIGHTER_COLORS,
  ...PEN_COLORS,
];

/** Opaque dots for the picker; the marks themselves use the translucent per-theme --mark-* values. */
export const SWATCHES: Record<
  MarkKind,
  { id: MarkColor; label: string; hex: string }[]
> = {
  highlight: [
    { id: "yellow", label: "Yellow", hex: "#f6d55c" },
    { id: "green", label: "Green", hex: "#9fd89a" },
    { id: "blue", label: "Blue", hex: "#9cc4f5" },
    { id: "pink", label: "Pink", hex: "#f2a7c8" },
  ],
  underline: [
    { id: "vermilion", label: "Vermilion", hex: "#d1492b" },
    { id: "cobalt", label: "Cobalt", hex: "#3b63d9" },
    { id: "forest", label: "Forest", hex: "#2f7d47" },
    { id: "graphite", label: "Graphite", hex: "#555555" },
  ],
};

/** The reader's current default colour for a tool. */
export function defaultColor(
  kind: MarkKind,
  settings: { highlighter: HighlighterColor; pen: PenColor },
): MarkColor {
  return kind === "highlight" ? settings.highlighter : settings.pen;
}

/**
 * The colour a saved mark is drawn in: its own, or for marks made before
 * colours were stored, the reader's current setting.
 */
export function markColor(
  doc: { kind: MarkKind; color?: MarkColor | null },
  settings: { highlighter: HighlighterColor; pen: PenColor },
): MarkColor {
  return doc.color ?? defaultColor(doc.kind, settings);
}
