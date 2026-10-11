"use client";
import { useCallback, useSyncExternalStore } from "react";

export type ReaderTheme =
  | "auto"
  | "paper"
  | "sepia"
  | "snow"
  | "dusk"
  | "night"
  | "ink";

const DARK_THEMES = new Set<ReaderTheme>(["dusk", "night", "ink"]);

/** Explicit themes that need the app's dark mode; "auto" follows the system. */
export function isDarkTheme(theme: ReaderTheme): boolean {
  return DARK_THEMES.has(theme);
}
export type PenColor = "vermilion" | "cobalt" | "forest" | "graphite";
export type HighlighterColor = "yellow" | "green" | "blue" | "pink";
export type Typeface = "serif" | "book" | "sans" | "legible";
export type Spacing = "snug" | "even" | "airy";
export type Width = "narrow" | "even" | "wide";
export type Align = "left" | "justify";
export type ParagraphStyle = "spaced" | "indented";
export type DropCap = "off" | "text" | "ornate" | "gothic";
export type AnswerLength = "brief" | "standard" | "detailed";
export type AnswerLevel = "plain" | "balanced" | "expert";
export type AnswerDepth = "quick" | "deep";
export type WebSearch = "off" | "deep" | "always";

export interface ReaderSettings {
  theme: ReaderTheme;
  pen: PenColor;
  highlighter: HighlighterColor;
  numbers: boolean;
  map: boolean;
  focus: boolean;
  typeface: Typeface;
  size: number;
  spacing: Spacing;
  width: Width;
  align: Align;
  paragraphs: ParagraphStyle;
  dropCap: DropCap;
  dropCapLines: number;
  answerLength: AnswerLength;
  answerLevel: AnswerLevel;
  answerDepth: AnswerDepth;
  webSearch: WebSearch;
}

export const TEXT_DEFAULTS = {
  typeface: "serif",
  size: 20,
  spacing: "even",
  width: "even",
  align: "left",
  paragraphs: "spaced",
  dropCap: "text",
  dropCapLines: 3,
} satisfies Partial<ReaderSettings>;

export const DROP_CAP_LINES = [2, 3, 4, 5] as const;

export const DROP_CAP_FAMILIES: Record<Exclude<DropCap, "off">, string> = {
  text: "var(--reader-font)",
  ornate: "var(--font-cinzel-decorative), var(--font-newsreader), serif",
  gothic: "var(--font-unifraktur), var(--font-newsreader), serif",
};

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: "auto",
  pen: "cobalt",
  highlighter: "yellow",
  numbers: false,
  map: true,
  focus: false,
  ...TEXT_DEFAULTS,
  answerLength: "standard",
  answerLevel: "balanced",
  answerDepth: "quick",
  webSearch: "deep",
};

/** Whether the model may search the web for an answer at this depth. */
export function webSearchEnabled(settings: ReaderSettings): boolean {
  return (
    settings.webSearch === "always" ||
    (settings.webSearch === "deep" && settings.answerDepth === "deep")
  );
}

export const SIZE_RANGE = { min: 14, max: 28 } as const;

export const TYPEFACE_FAMILIES: Record<Typeface, string> = {
  serif: "var(--font-newsreader), Georgia, serif",
  book: "var(--font-literata), Georgia, serif",
  sans: "var(--font-dm-sans), system-ui, sans-serif",
  legible: "var(--font-atkinson), system-ui, sans-serif",
};

export const LINE_HEIGHTS: Record<Spacing, number> = {
  snug: 1.55,
  even: 1.8,
  airy: 2.05,
};

export const MAX_WIDTHS: Record<Width, string> = {
  narrow: "36rem",
  even: "42rem",
  wide: "50rem",
};

const STORAGE_KEY = "marginalia:reader-settings";
const listeners = new Set<() => void>();
let cached: ReaderSettings | null = null;

function read(): ReaderSettings {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cached = { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    cached = DEFAULT_SETTINGS;
  }
  return cached as ReaderSettings;
}

function write(next: ReaderSettings) {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or full storage: keep the in-memory value for this session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    cached = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useReaderSettings() {
  const settings = useSyncExternalStore(
    subscribe,
    read,
    () => DEFAULT_SETTINGS,
  );

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    write({ ...read(), ...patch });
  }, []);

  const resetText = useCallback(() => {
    write({ ...read(), ...TEXT_DEFAULTS });
  }, []);

  return { settings, update, resetText };
}
