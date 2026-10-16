import { describe, expect, it } from "vitest";
import {
  alreadySaid,
  buildAlongsidePrompt,
  type SaidNote,
} from "./alongsidePrompt";

const note = (start: number, content = "A note."): SaidNote => ({
  type: "assumption",
  anchorText: `anchor ${start}`,
  content,
  start,
  end: start + 10,
});

describe("alreadySaid", () => {
  it("keeps only notes anchored inside the section, in reading order", () => {
    const said = alreadySaid([note(500), note(50), note(5000)], {
      start: 0,
      end: 1000,
    });
    expect(said.map((n) => n.start)).toEqual([50, 500]);
  });

  it("stays within the context budget", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      note(i, "x".repeat(300)),
    );
    const said = alreadySaid(many, { start: 0, end: 1000 });
    expect(said.length).toBeGreaterThan(0);
    expect(said.length).toBeLessThan(30);
  });
});

describe("buildAlongsidePrompt", () => {
  const prompt = buildAlongsidePrompt({
    title: "A piece",
    sectionIndex: 2,
    sectionCount: 5,
    sectionText: "The section text.",
    outline: ["one", "two", "three", "four", "five"],
    contextText: "## Context",
    said: [note(1, "Already pointed out the missing control group.")],
    wordCount: 700,
  });

  it("gives the section, its place and what the margin already says", () => {
    expect(prompt).toContain("section 3 of 5");
    expect(prompt).toContain("The section text.");
    expect(prompt).toContain("Already pointed out the missing control group.");
    expect(prompt).toMatch(/Do not repeat one/);
  });

  it("asks in proportion to the section's length and for annotations only", () => {
    expect(prompt).toContain("about 700 words");
    expect(prompt).toMatch(/Aim for about 2 new notes, and no more than 4/);
    expect(prompt).toMatch(/Return only the annotations/);
  });
});
