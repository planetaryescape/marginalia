import { v } from "convex/values";
import {
  EPUB_DIAGNOSTIC_CODES,
  EPUB_DIAGNOSTIC_STAGES,
  type EpubDiagnostic,
} from "./epub/diagnostics";
import type { EpubFailure } from "./epub/types";

export const importDiagnostic = v.object({
  code: v.union(...EPUB_DIAGNOSTIC_CODES.map((code) => v.literal(code))),
  stage: v.union(...EPUB_DIAGNOSTIC_STAGES.map((stage) => v.literal(stage))),
  observed: v.optional(v.number()),
  limit: v.optional(v.number()),
  spineIndex: v.optional(v.number()),
  blockIndex: v.optional(v.number()),
  errorType: v.optional(
    v.union(
      v.literal("type_error"),
      v.literal("range_error"),
      v.literal("error"),
      v.literal("non_error"),
    ),
  ),
});

export function unexpectedImportDiagnostic(
  stage: EpubDiagnostic["stage"],
  error: unknown,
): EpubDiagnostic {
  return {
    stage,
    code: "unexpected_failure",
    errorType:
      error instanceof TypeError
        ? "type_error"
        : error instanceof RangeError
          ? "range_error"
          : error instanceof Error
            ? "error"
            : "non_error",
  };
}

export function epubFailureEvent(
  importId: string,
  failure: EpubFailure | "scanned" | "too_slow",
  diagnostic: EpubDiagnostic,
) {
  return {
    event:
      diagnostic.code === "unexpected_failure"
        ? "epub_import_failed"
        : "epub_import_refused",
    importId,
    failure,
    stage: diagnostic.stage,
    code: diagnostic.code,
    observed: diagnostic.observed,
    limit: diagnostic.limit,
    spineIndex: diagnostic.spineIndex,
    blockIndex: diagnostic.blockIndex,
    errorType: diagnostic.errorType,
  };
}
