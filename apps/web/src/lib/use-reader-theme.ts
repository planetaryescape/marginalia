"use client";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { isDarkTheme, type ReaderSettings } from "./reader-settings";

/**
 * Applies the reader theme, pen and highlighter to <html> so every surface
 * (and portals such as popovers and toasts) can use the --reader-* tokens.
 */
export function useReaderTheme(settings: ReaderSettings) {
  const { resolvedTheme, setTheme } = useTheme();

  // Keep light/dark in step with an explicit reader theme (e.g. after toggling elsewhere in the app)
  useEffect(() => {
    if (settings.theme === "auto" || !resolvedTheme) return;
    const wantDark = isDarkTheme(settings.theme);
    if ((resolvedTheme === "dark") !== wantDark)
      setTheme(wantDark ? "dark" : "light");
  }, [settings.theme, resolvedTheme, setTheme]);

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
