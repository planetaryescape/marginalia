import { v } from "convex/values";

// The colours a mark can carry. They match the reader's highlighter and pen
// settings, so the setting is the default and a mark can override it.
export const HIGHLIGHTER_COLORS = ["yellow", "green", "blue", "pink"] as const;
export const PEN_COLORS = [
  "vermilion",
  "cobalt",
  "forest",
  "graphite",
] as const;

export type HighlighterColor = (typeof HIGHLIGHTER_COLORS)[number];
export type PenColor = (typeof PEN_COLORS)[number];
export type MarkColor = HighlighterColor | PenColor;
export type MarkKind = "highlight" | "underline";

export const markColor = v.union(
  v.literal("yellow"),
  v.literal("green"),
  v.literal("blue"),
  v.literal("pink"),
  v.literal("vermilion"),
  v.literal("cobalt"),
  v.literal("forest"),
  v.literal("graphite"),
);

/** Whether a colour belongs to the tool that made the mark (no yellow underlines). */
export function colorFitsKind(kind: MarkKind, color: MarkColor): boolean {
  const own: readonly MarkColor[] =
    kind === "highlight" ? HIGHLIGHTER_COLORS : PEN_COLORS;
  return own.includes(color);
}
