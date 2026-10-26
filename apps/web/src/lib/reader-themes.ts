import type { ReaderTheme } from "@/lib/reader-settings";

/** The theme swatches shared by the reader's settings panel and the avatar menu. */
export const THEMES: {
  id: ReaderTheme;
  label: string;
  bg: string;
  fg: string;
}[] = [
  { id: "auto", label: "Auto", bg: "#faf8f5", fg: "#201d1b" },
  { id: "paper", label: "Paper", bg: "#faf8f5", fg: "#201d1b" },
  { id: "sepia", label: "Sepia", bg: "#f3ead8", fg: "#4a3b2a" },
  { id: "snow", label: "Snow", bg: "#ffffff", fg: "#1a1a1a" },
  { id: "dusk", label: "Dusk", bg: "#34302c", fg: "#f1ece6" },
  { id: "night", label: "Night", bg: "#201d1b", fg: "#e7e5e3" },
  { id: "ink", label: "Ink", bg: "#0e1014", fg: "#dde1e8" },
];
