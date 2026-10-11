import { describe, expect, it } from "vitest";
import { splitIntoSections } from "./marginaliaContext";

describe("splitIntoSections", () => {
  it("keeps a short article in one section", () => {
    expect(
      splitIntoSections("A short piece. With two sentences."),
    ).toHaveLength(1);
  });

  it("caps long articles at 12 sections and keeps every sentence", () => {
    const text = Array.from(
      { length: 2000 },
      (_, i) => `Sentence number ${i}.`,
    ).join(" ");
    const sections = splitIntoSections(text);
    expect(sections.length).toBeLessThanOrEqual(12);
    expect(sections.length).toBeGreaterThan(1);
    const rejoined = sections.join(" ");
    expect(rejoined).toContain("Sentence number 0.");
    expect(rejoined).toContain("Sentence number 1999.");
  });

  it("cuts at sentence boundaries", () => {
    const text = Array.from(
      { length: 800 },
      (_, i) => `Claim ${i} holds.`,
    ).join(" ");
    for (const section of splitIntoSections(text).slice(0, -1)) {
      expect(section.endsWith(".")).toBe(true);
    }
  });
});
