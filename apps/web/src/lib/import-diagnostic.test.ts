import { expect, it } from "vitest";
import { importDiagnosticCopy } from "./import-diagnostic";

it("distinguishes a block limit from the compressed file size", () => {
  expect(
    importDiagnosticCopy({
      stage: "units",
      code: "block_words",
      observed: 14208,
      limit: 4000,
    }),
  ).toBe("A single text block has 14,208 words; the supported limit is 4,000.");
  expect(
    importDiagnosticCopy({
      stage: "archive",
      code: "expanded_bytes",
      observed: 67108865,
      limit: 67108864,
    }),
  ).toBe(
    "The unpacked book uses 67,108,865 bytes; the supported limit is 67,108,864.",
  );
});

it("does not invent measurements when diagnostics lack them", () => {
  expect(
    importDiagnosticCopy({ stage: "spine", code: "invalid_spine" }),
  ).toBeNull();
  expect(
    importDiagnosticCopy({ stage: "units", code: "block_words", limit: 4000 }),
  ).toBeNull();
});

it("does not blame a damaged book for an internal import failure", () => {
  expect(
    importDiagnosticCopy({
      stage: "publish",
      code: "unexpected_failure",
      errorType: "type_error",
    }),
  ).toBe(
    "Marginalia hit an internal error while importing this book. Try again, or expand Diagnostic details to share the import reference.",
  );
});
