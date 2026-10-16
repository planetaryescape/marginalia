"use client";
import { useEffect } from "react";
import type { MarkKind } from "@/lib/highlights";
import {
  ALL_MARK_COLORS,
  type HighlighterColor,
  type MarkColor,
  markColor,
  type PenColor,
} from "@/lib/mark-colours";

interface PaintedMark {
  doc: { kind: MarkKind; color?: MarkColor | null };
  range: Range;
}

/**
 * Paints each placed mark under its own colour's custom highlight
 * (`mark-yellow`, `mark-cobalt`, ...). The reader package registers every mark
 * under one name per tool, which can only take one colour, so globals.css
 * leaves those unpainted and this does the painting.
 */
export function useMarkPaint(
  marks: PaintedMark[],
  settings: { highlighter: HighlighterColor; pen: PenColor },
) {
  const { highlighter, pen } = settings;
  useEffect(() => {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const byColor = new Map<MarkColor, Range[]>();
    for (const mark of marks) {
      const color = markColor(mark.doc, { highlighter, pen });
      byColor.set(color, [...(byColor.get(color) ?? []), mark.range]);
    }
    for (const [color, ranges] of byColor)
      CSS.highlights.set(`mark-${color}`, new Highlight(...ranges));
    return () => {
      for (const color of ALL_MARK_COLORS)
        CSS.highlights.delete(`mark-${color}`);
    };
  }, [marks, highlighter, pen]);
}
