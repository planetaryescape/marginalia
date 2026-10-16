"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { HighlighterColor, PenColor } from "@planetaryescape/reader";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { useReaderSettings } from "./reader-settings";

export type MarkKind = "highlight" | "underline";

/**
 * Changes the default colour of a tool without repainting existing marks.
 * Marks saved before each mark kept its own colour follow the default, so
 * they are first given the colour they show now.
 */
export function useSetMarkDefault() {
  const { settings, update } = useReaderSettings();
  const stamp = useMutation(api.highlights.stampUncoloured);
  return useCallback(
    async (kind: MarkKind, color: string) => {
      const current =
        kind === "highlight" ? settings.highlighter : settings.pen;
      if (current === color) return;
      try {
        await stamp({ kind, color: current });
      } catch {
        // Offline or refused: the default still changes; old marks may follow it
      }
      update(
        kind === "highlight"
          ? { highlighter: color as HighlighterColor }
          : { pen: color as PenColor },
      );
    },
    [settings.highlighter, settings.pen, stamp, update],
  );
}
