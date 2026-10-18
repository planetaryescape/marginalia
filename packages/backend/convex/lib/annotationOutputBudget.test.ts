import { expect, it } from "vitest";
import { annotationOutputTokens } from "./annotationOutputBudget";

it("reserves substantive current notes through the forty-note cap", () => {
  expect(annotationOutputTokens(300)).toBe(5_200);
  expect(annotationOutputTokens(30_000)).toBe(34_000);
  expect(annotationOutputTokens(1_000_000)).toBe(34_000);
  const substantiveNotes = Array.from({ length: 40 }, () => ({
    type: "context",
    anchorText: "A verbatim anchor with enough surrounding words to find it.",
    content:
      "The comparison depends on what was measured, not simply whether the outcome improved. A second sentence explains how this changes the author's conclusion. A third sentence connects it with a concrete implication for the reader.",
    reasoning:
      "This distinction changes how the reader should assess the evidence.",
    noteExcerpt:
      "A recalled source can provide a substantive comparison rather than a short label.",
    relevanceScore: 0.9,
  }));
  // Conservative fixture guard, not a tokenizer: enough room for this whole
  // substantive JSON answer even at one token per character, plus the envelope.
  expect(JSON.stringify(substantiveNotes).length + 2_000).toBeLessThan(
    annotationOutputTokens(30_000),
  );
});
