import { describe, expect, it } from "vitest";
import { vaultUploadSchema } from "./vaultUpload";

describe("vault requests", () => {
  it.each([
    null,
    {},
    { action: "delete" },
    { action: "upload", chunks: [] },
    { action: "replace", filePath: "Note.md", chunks: [{}] },
  ])("rejects incomplete payloads", (body) => {
    expect(vaultUploadSchema.safeParse(body).success).toBe(false);
  });
  it("accepts a narrow deletion request", () => {
    expect(
      vaultUploadSchema.parse({ action: "delete", filePath: "Note.md" }),
    ).toEqual({ action: "delete", filePath: "Note.md" });
  });
});
