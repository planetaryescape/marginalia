import type { EpubDiagnostic } from "@marginalia/backend/epub-diagnostics";

export function importDiagnosticCopy(
  diagnostic: EpubDiagnostic,
): string | null {
  if (diagnostic.code === "unexpected_failure")
    return "Marginalia hit an internal error while importing this book. Try again, or expand Diagnostic details to share the import reference.";
  const observed = diagnostic.observed?.toLocaleString();
  const limit = diagnostic.limit?.toLocaleString();
  if (observed === undefined && limit === undefined) return null;
  const measurement = diagnosticMeasurement(diagnostic.code);
  if (!measurement) return null;
  const [subject, verb, unit, bounded, limitKind] = measurement;
  const found =
    observed === undefined
      ? null
      : `${subject} ${verb} ${bounded ? "at least " : ""}${observed} ${unit}`;
  const supported =
    limit === undefined
      ? null
      : `the ${limitKind} limit is ${limit}${observed === undefined ? ` ${unit}` : ""}`;
  if (!found) return `${subject} exceeds its limit; ${supported}.`;
  return `${found}${supported ? `; ${supported}` : ""}.`;
}

function diagnosticMeasurement(
  code: EpubDiagnostic["code"],
): readonly [string, string, string, boolean, string] | null {
  switch (code) {
    case "block_words":
      return ["A single text block", "has", "words", false, "supported"];
    case "block_bytes":
      return ["A single text block", "uses", "bytes", false, "supported"];
    case "archive_bytes":
      return ["The file", "is", "bytes", false, "upload"];
    case "expanded_bytes":
      return ["The unpacked book", "uses", "bytes", true, "supported"];
    case "entry_bytes":
      return ["A file inside this EPUB", "uses", "bytes", false, "supported"];
    case "archive_entries":
      return ["The EPUB", "contains", "files", true, "supported"];
    case "spine_items":
      return ["The EPUB", "contains", "chapter documents", true, "supported"];
    case "unit_count":
      return ["The book", "needs", "reading parts", true, "supported"];
    case "unit_bytes":
      return ["A reading part", "uses", "bytes", false, "supported"];
    case "storage_payload":
      return ["The prepared content", "uses", "bytes", false, "storage"];
    case "xml_depth":
      return ["Document nesting", "reaches", "levels", true, "supported"];
    case "xml_nodes":
      return ["A chapter", "contains", "document nodes", true, "supported"];
    default:
      return null;
  }
}
