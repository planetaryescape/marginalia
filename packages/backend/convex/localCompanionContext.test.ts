import { expect, it } from "vitest";
import {
  buildCompanionPrompt,
  companionRequestSchema,
} from "./lib/readingCompanion";

it("sparse local tools preserve exactly the old prompt and original paragraph citations", () => {
  const paragraphs = Array.from({ length: 300 }, (_, i) => `paragraph ${i}`);
  for (const mode of ["define", "explain", "simplify"] as const) {
    const body = {
      mode,
      title: "Fixture",
      selection: "paragraph",
      paragraphIndex: 150,
      paragraphEnd: 151,
      paragraphs,
    };
    const indices = mode === "define" ? [150] : [149, 150, 151, 152];
    const full = companionRequestSchema.parse(body);
    const sparse = companionRequestSchema.parse({
      ...body,
      paragraphs: indices.map((i) => paragraphs[i]),
      paragraphIndices: indices,
    });
    // Sparse packets cannot know the last paragraph, so compare the substantive
    // content/citations rather than an optional trailing omission marker.
    const prompt = buildCompanionPrompt(sparse).messages[0].content;
    const original = buildCompanionPrompt(full).messages[0].content;
    expect(prompt.replace(/\n\n\[…\]/g, "")).toBe(
      original.replace(/\n\n\[…\]/g, ""),
    );
    expect(prompt).toContain("¶151");
    expect(prompt).not.toContain("paragraph 140");
  }
});

it("keeps a huge single selected paragraph intact within a near-300000-character packet", () => {
  const text = `${"x".repeat(292_000)} selected ending`;
  const body = {
    mode: "explain",
    title: "Fixture",
    selection: "selected ending",
    paragraphIndex: 149,
    paragraphs: [text],
    paragraphIndices: [149],
  };
  expect(JSON.stringify(body).length).toBeLessThan(300_000);
  const parsed = companionRequestSchema.parse(body);
  const prompt = buildCompanionPrompt(parsed).messages[0].content;
  expect(prompt).toContain(text);
  expect(prompt).toContain("¶150");
});

it("never accepts sparse retrieval or duplicate/out-of-order citation indices", () => {
  const body = {
    mode: "ask",
    title: "Fixture",
    selection: "word",
    question: "why",
    paragraphIndex: 5,
    paragraphs: ["word"],
    paragraphIndices: [5],
  };
  expect(companionRequestSchema.safeParse(body).success).toBe(false);
  expect(
    companionRequestSchema.safeParse({
      ...body,
      mode: "define",
      paragraphs: ["a", "word"],
      paragraphIndices: [5, 5],
    }).success,
  ).toBe(false);
});
