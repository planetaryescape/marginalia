import { describe, expect, it } from "vitest";
import { studyFailureDiagnostic } from "./scriptureStudyDiagnostics";

describe("study failure diagnostics", () => {
  it("classifies a nested provider rejection without exposing its message", () => {
    const error = Object.assign(new Error("Provider returned error"), {
      statusCode: 400,
      responseBody: JSON.stringify({
        error: {
          message: "Provider returned error",
          metadata: {
            raw: JSON.stringify({
              error: {
                message:
                  "Invalid JSON schema: unsupported property additionalProperties. secret-key private source",
                status: "INVALID_ARGUMENT",
              },
            }),
          },
        },
      }),
    });
    const diagnostic = studyFailureDiagnostic(error);
    expect(diagnostic.signals).toContain("schema");
    expect(diagnostic.parameters).toContain("additionalProperties");
    expect(JSON.stringify(diagnostic)).not.toMatch(
      /secret-key|private source|Provider returned/,
    );
  });
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
      /secret-key|private|Invalid response_format JSON schema/,
    );
  });

  it("ignores oversized provider bodies and never returns arbitrary parameter text", () => {
    const error = Object.assign(new Error("Provider returned error"), {
      responseBody: "private".repeat(3000),
    });
    expect(studyFailureDiagnostic(error).signals).toEqual([]);
    expect(studyFailureDiagnostic(error).parameters).toEqual([]);
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
      parameters: [],
    });
  });
});
