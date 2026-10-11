"use client";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { isDarkTheme, type ReaderSettings } from "./reader-settings";

/**
 * Applies the reader theme, pen and highlighter to <html> so every surface
 * (and portals such as popovers and toasts) can use the --reader-* tokens.
 */
export function useReaderTheme(settings: ReaderSettings) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  // Keep light/dark in step with an explicit reader theme (e.g. after toggling elsewhere in the app)
  useEffect(() => {
    const desired =
      settings.theme === "auto"
        ? "system"
        : isDarkTheme(settings.theme)
          ? "dark"
          : "light";
    if (theme !== desired) setTheme(desired);
  }, [settings.theme, theme, setTheme]);

  useEffect(() => {
    const html = document.documentElement;
    html.dataset.readerTheme =
      settings.theme === "auto"
        ? resolvedTheme === "dark"
          ? "night"
          : "paper"
        : settings.theme;
    html.dataset.pen = settings.pen;
    html.dataset.highlighter = settings.highlighter;
    return () => {
      delete html.dataset.readerTheme;
      delete html.dataset.pen;
      delete html.dataset.highlighter;
    };
  }, [settings.theme, settings.pen, settings.highlighter, resolvedTheme]);
}
