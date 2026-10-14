import { useReaderSettings as useStoredReaderSettings } from "@planetaryescape/reader";

// Keeps the key Marginalia has always used, so stored settings survive the move to the package.
const SETTINGS_STORAGE_KEY = "marginalia:reader-settings";

export {
  type Align,
  type AnswerDepth,
  type AnswerLength,
  type AnswerLevel,
  DEFAULT_SETTINGS,
  DROP_CAP_FAMILIES,
  DROP_CAP_LINES,
  type DropCap,
  type HighlighterColor,
  isDarkTheme,
  LINE_HEIGHTS,
  MAX_WIDTHS,
  type ParagraphStyle,
  type PenColor,
  parseReaderSettings,
  type ReaderSettings,
  type ReaderTheme,
  SIZE_RANGE,
  type Spacing,
  TEXT_DEFAULTS,
  TYPEFACE_FAMILIES,
  type Typeface,
  type WebSearch,
  type Width,
  webSearchEnabled,
} from "@planetaryescape/reader";

export function useReaderSettings() {
  return useStoredReaderSettings(SETTINGS_STORAGE_KEY);
}
