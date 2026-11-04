import { expect, it } from "vitest";
import {
  epubFailureEvent,
  unexpectedImportDiagnostic,
} from "./importDiagnostics";

it("projects a correlated refusal without book text, file paths or arbitrary error payloads", () => {
  const privateValue = "PRIVATE_SENTINEL_NEVER_LOG";
  const diagnostic = {
    stage: "units" as const,
    code: "block_words" as const,
    observed: 14208,
    limit: 4000,
    spineIndex: 76,
    blockIndex: 1,
    fileName: privateValue,
    text: privateValue,
    error: { message: privateValue, cause: privateValue },
  };
  const event = epubFailureEvent("import-reference", "too_long", diagnostic);
  expect(event).toEqual({
    event: "epub_import_refused",
    importId: "import-reference",
    failure: "too_long",
    stage: "units",
    code: "block_words",
    observed: 14208,
    limit: 4000,
    spineIndex: 76,
    blockIndex: 1,
    errorType: undefined,
  });
  expect(JSON.stringify(event)).not.toContain(privateValue);
});

it.each([
  {
    error: new TypeError("PRIVATE_EXCEPTION_SENTINEL"),
    errorType: "type_error",
  },
  {
    error: new RangeError("PRIVATE_EXCEPTION_SENTINEL"),
    errorType: "range_error",
  },
  { error: new Error("PRIVATE_EXCEPTION_SENTINEL"), errorType: "error" },
  { error: { message: "PRIVATE_EXCEPTION_SENTINEL" }, errorType: "non_error" },
])("classifies $errorType without retaining private exception payloads", ({
  error,
  errorType,
}) => {
  const diagnostic = unexpectedImportDiagnostic("publish", error);
  expect(diagnostic).toEqual({
    stage: "publish",
    code: "unexpected_failure",
    errorType,
  });
  const event = epubFailureEvent("import-reference", "unreadable", diagnostic);
  expect(event.event).toBe("epub_import_failed");
  expect(JSON.stringify(event)).not.toContain("PRIVATE_EXCEPTION_SENTINEL");
});
