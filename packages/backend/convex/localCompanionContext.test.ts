import { expect, it } from "vitest";
import { LOCAL_PARAGRAPH_CHARS } from "./lib/localContext";
import {
  buildCompanionPrompt,
  companionRequestSchema,
  MAX_CONTEXT_CHARS,
  selectContext,
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

it.each([
  "define",
  "explain",
  "simplify",
] as const)("bounds %s for a near-limit paragraph while retaining its selected ending and original citation", (mode) => {
  const text = `${"Earlier background. ".repeat(15_000).slice(0, 299_000)} selected ending`;
  const body = {
    mode,
    title: "Fixture",
    selection: "selected ending",
    paragraphIndex: 149,
    paragraphs: [text],
    paragraphIndices: [149],
  };
  expect(JSON.stringify(body).length).toBeLessThan(300_000);
  const parsed = companionRequestSchema.parse(body);
  const prompt = buildCompanionPrompt(parsed).messages[0].content;
  expect(prompt.length).toBeLessThan(LOCAL_PARAGRAPH_CHARS + 5000);
  expect(prompt).toContain("background.");
  expect(prompt).toContain("selected ending");
  expect(prompt).not.toContain(text);
  expect(prompt).toContain("¶150");
});

it("preserves ordinary 20k paragraphs verbatim", () => {
  const paragraphs = [
    "before ".padEnd(20_000, "b"),
    "selected ".padEnd(20_000, "s"),
    "after ".padEnd(20_000, "a"),
  ];
  const request = companionRequestSchema.parse({
    mode: "explain",
    title: "Fixture",
    paragraphs,
    selection: "selected",
    paragraphIndex: 1,
  });
  const prompt = buildCompanionPrompt(request).messages[0].content;
  for (const paragraph of paragraphs) expect(prompt).toContain(paragraph);
});

it("keeps both crossing edges and neighbours without uploading oversized paragraphs", () => {
  const paragraphs = [
    "previous context",
    `${"before ".repeat(20_000)}selected tail`,
    `selected head ${"after ".repeat(20_000)}`,
    "following context",
  ];
  const body = {
    mode: "explain",
    title: "Fixture",
    paragraphs,
    selection: "selected tail selected head",
    paragraphIndex: 1,
    paragraphEnd: 2,
  };
  expect(JSON.stringify(body).length).toBeLessThan(300_000);
  const request = companionRequestSchema.parse(body);
  const context = selectContext(request);
  expect(
    [...context.excerpts!.values()].reduce((sum, text) => sum + text.length, 0),
  ).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  const prompt = buildCompanionPrompt(request).messages[0].content;
  expect(prompt).toContain("¶2 ←");
  expect(prompt).toContain("¶3 ←");
  expect(prompt).toContain("selected tail");
  expect(prompt).toContain("selected head");
  expect(prompt).toContain("previous context");
  expect(prompt).toContain("following context");
  expect(prompt.length).toBeLessThan(45_000);
});

it("caps many selected paragraphs at the aggregate budget, not just per paragraph", () => {
  const paragraphs = Array.from({ length: 14 }, (_, i) =>
    `${i} selected text `.padEnd(20_000, "x"),
  );
  const request = companionRequestSchema.parse({
    mode: "simplify",
    title: "Fixture",
    paragraphs,
    selection: "selected text",
    paragraphIndex: 1,
    paragraphEnd: 12,
  });
  const context = selectContext(request);
  expect(
    [...context.excerpts!.values()].reduce((sum, text) => sum + text.length, 0),
  ).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  expect(context.indices).toContain(1);
  expect(context.indices).toContain(12);
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
