import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { FAILURE_COPY, failureSentence } from "./failure-copy";

describe("failureSentence", () => {
  it("shows the server's sentence when it sent one", () => {
    const error = new ConvexError("Too many API requests in the last minute.");
    expect(failureSentence(error, FAILURE_COPY.save)).toBe(
      "Too many API requests in the last minute.",
    );
  });

  it("falls back for a transport error rather than showing its raw message", () => {
    const error = new Error("Connection lost while action was in flight");
    expect(failureSentence(error, FAILURE_COPY.unreachable)).toBe(
      FAILURE_COPY.unreachable,
    );
  });

  it("falls back when a ConvexError carries no sentence", () => {
    const error = new ConvexError({ code: 500 });
    expect(failureSentence(error, FAILURE_COPY.save)).toBe(FAILURE_COPY.save);
  });
});
