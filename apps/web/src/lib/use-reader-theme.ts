"use client";
import {
  useReaderTheme as applyReaderTheme,
  desiredColorScheme,
  type ReaderSettings,
} from "@planetaryescape/reader";
import { useTheme } from "next-themes";
import { useEffect } from "react";

/**
 * Applies the reader theme to <html> and keeps the app's light/dark mode in
 * step with it, so Marginalia's own dark-mode rules follow the reader theme.
 */
export function useReaderTheme(settings: ReaderSettings) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const desired = desiredColorScheme(settings.theme);
    if (theme !== desired) setTheme(desired);
  }, [settings.theme, theme, setTheme]);

  applyReaderTheme(settings, resolvedTheme === "dark" ? "dark" : "light");
}
