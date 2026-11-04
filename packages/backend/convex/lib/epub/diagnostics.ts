export const EPUB_DIAGNOSTIC_CODES = [
  "archive_bytes",
  "expanded_bytes",
  "entry_bytes",
  "archive_entries",
  "spine_items",
  "xml_depth",
  "xml_nodes",
  "block_words",
  "block_bytes",
  "unit_count",
  "unit_bytes",
  "invalid_archive",
  "invalid_package",
  "invalid_navigation",
  "invalid_encryption",
  "invalid_spine",
  "protected_content",
  "empty_text",
  "storage_payload",
  "unexpected_failure",
] as const;

export const EPUB_DIAGNOSTIC_STAGES = [
  "archive",
  "package",
  "encryption",
  "navigation",
  "spine",
  "units",
  "publish",
  "images",
] as const;

export type EpubDiagnostic = {
  readonly code: (typeof EPUB_DIAGNOSTIC_CODES)[number];
  readonly stage: (typeof EPUB_DIAGNOSTIC_STAGES)[number];
  readonly observed?: number;
  readonly limit?: number;
  readonly spineIndex?: number;
  readonly blockIndex?: number;
  readonly errorType?: "type_error" | "range_error" | "error" | "non_error";
};
