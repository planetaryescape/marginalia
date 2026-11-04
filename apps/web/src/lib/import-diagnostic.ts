import type { EpubDiagnostic } from "@marginalia/backend/epub-diagnostics";

export function importDiagnosticCopy(
  diagnostic: EpubDiagnostic,
): string | null {
  if (diagnostic.code === "unexpected_failure")
    return "Marginalia hit an internal error while importing this book. Try again, or expand Diagnostic details to share the import reference.";
  const observed = diagnostic.observed?.toLocaleString();
  const limit = diagnostic.limit?.toLocaleString();
  if (observed === undefined || limit === undefined) return null;
  switch (diagnostic.code) {
    case "block_words":
      return `A single text block has ${observed} words; the supported limit is ${limit}.`;
    case "block_bytes":
      return `A single text block uses ${observed} bytes; the supported limit is ${limit}.`;
    case "archive_bytes":
      return `The file is ${observed} bytes; the upload limit is ${limit}.`;
    case "expanded_bytes":
      return `The unpacked book uses ${observed} bytes; the supported limit is ${limit}.`;
    case "entry_bytes":
      return `A file inside this EPUB uses ${observed} bytes; the supported limit is ${limit}.`;
    case "archive_entries":
      return `The EPUB contains ${observed} files; the supported limit is ${limit}.`;
    case "spine_items":
      return `The EPUB contains ${observed} chapter documents; the supported limit is ${limit}.`;
    case "unit_count":
      return `The book needs ${observed} reading parts; the supported limit is ${limit}.`;
    case "unit_bytes":
      return `A reading part uses ${observed} bytes; the supported limit is ${limit}.`;
    case "storage_payload":
      return `The prepared content uses ${observed} bytes; the storage limit is ${limit}.`;
    case "xml_depth":
      return `Document nesting reaches ${observed} levels; the supported limit is ${limit}.`;
    case "xml_nodes":
      return `A chapter contains ${observed} document nodes; the supported limit is ${limit}.`;
    default:
      return null;
  }
}
