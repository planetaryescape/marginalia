"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { HighlighterColor, PenColor } from "@planetaryescape/reader";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { HIGHLIGHTER_COLORS, PEN_COLORS } from "./mark-colours";
import { parseReaderSettings, useReaderSettings } from "./reader-settings";

export type MarkKind = "highlight" | "underline";
const LEGACY_KEY = "marginalia:legacy-mark-defaults-v1";
type Defaults = { highlighter: HighlighterColor; pen: PenColor };
const memory = new Map<string, Defaults>();
const stamping = new Set<string>();
const defaultsSchema = z.object({
  highlighter: z.enum(HIGHLIGHTER_COLORS),
  pen: z.enum(PEN_COLORS),
});

/** Freeze the pre-migration colours locally, including while offline or a
 * paginated server stamp is still running. Explicitly coloured marks ignore it.
 */
export function useLegacyMarkDefaults() {
  const { settings } = useReaderSettings();
  const readerId = useQuery(api.readerBootstrap.readerKey, {});
  const [provisional] = useState<Defaults>(() => {
    let current = settings;
    // useSyncExternalStore exposes server defaults during hydration. Read the
    // existing browser preference, not that temporary hydration snapshot.
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem("marginalia:reader-settings");
        if (raw) current = parseReaderSettings(JSON.parse(raw));
      } catch {
        /* The live settings still work without storage. */
      }
    }
    return { highlighter: current.highlighter, pen: current.pen };
  });
  const legacy = useMemo(() => {
    if (!readerId || typeof window === "undefined") return provisional;
    const cached = memory.get(readerId);
    if (cached) return cached;
    let initial = provisional;
    const key = `${LEGACY_KEY}:${readerId}`;
    try {
      const stored = defaultsSchema.safeParse(
        JSON.parse(localStorage.getItem(key) ?? "null"),
      );
      if (stored.success) initial = stored.data;
      localStorage.setItem(key, JSON.stringify(initial));
    } catch {
      /* Memory still preserves colours for this visit. */
    }
    memory.set(readerId, initial);
    return initial;
  }, [readerId, provisional]);
  return { colors: legacy, readerId };
}

/**
 * Changes the default colour of a tool without repainting existing marks.
 * Marks saved before each mark kept its own colour follow the default, so
 * they are first given the colour they show now.
 */
export function useSetMarkDefault() {
  const { settings, update } = useReaderSettings();
  const { colors: legacy, readerId } = useLegacyMarkDefaults();
  const stamp = useMutation(api.highlights.stampUncoloured);
  useEffect(() => {
    const prepare = () => {
      if (!readerId || navigator.onLine === false) return;
      for (const kind of ["highlight", "underline"] as const) {
        const color = kind === "highlight" ? legacy.highlighter : legacy.pen;
        const key = `${readerId}:${kind}:${color}`;
        if (stamping.has(key)) continue;
        stamping.add(key);
        void stamp({ kind, color }).catch(() => {
          stamping.delete(key);
        });
      }
    };
    prepare();
    window.addEventListener("online", prepare);
    return () => window.removeEventListener("online", prepare);
  }, [legacy, readerId, stamp]);
  return useCallback(
    (kind: MarkKind, color: string) => {
      const current =
        kind === "highlight" ? settings.highlighter : settings.pen;
      if (current === color) return;
      if (kind === "highlight")
        update({ highlighter: z.enum(HIGHLIGHTER_COLORS).parse(color) });
      else update({ pen: z.enum(PEN_COLORS).parse(color) });
    },
    [settings.highlighter, settings.pen, update],
  );
}
