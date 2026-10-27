import { describe, expect, it } from "vitest";
import { studyFailureDiagnostic } from "./scriptureStudyDiagnostics";

describe("study failure diagnostics", () => {
  it("identifies a schema rejection without logging provider text or payloads", () => {
    const error = Object.assign(
      new Error(
        "Invalid response_format JSON schema. token=secret-key private verse",
      ),
      {
        statusCode: 400,
        responseBody: "private provider response",
        requestBodyValues: { apiKey: "secret-key", prompt: "private verse" },
      },
    );
    const diagnostic = studyFailureDiagnostic(error);
    expect(diagnostic).toMatchObject({ status: 400, errorType: "Error" });
    expect(diagnostic.signals).toContain("schema");
    expect(JSON.stringify(diagnostic)).not.toMatch(
      /secret-key|private|response_format/,
    );
  });

  it("recognizes quota failures and bounds unknown metadata", () => {
    const error = Object.assign(new Error("Insufficient credits"), {
      statusCode: 402,
    });
    expect(studyFailureDiagnostic(error).signals).toContain("quota");
    expect(
      studyFailureDiagnostic({
        name: "private-user-name",
        statusCode: "secret",
      }),
    ).toEqual({
      errorType: "unknown",
      status: null,
      signals: [],
    });
  });
});
