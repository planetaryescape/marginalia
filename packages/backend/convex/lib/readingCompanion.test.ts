import { describe, expect, it } from "vitest";
import { sourcesFooter } from "./companionStream";
import {
  buildCompanionPrompt,
  buildSystemPrompt,
  companionRequestSchema,
  formatArticle,
  selectParagraphWindow,
} from "./readingCompanion";

describe("readingCompanion", () => {
  describe("selectParagraphWindow", () => {
    it("keeps every paragraph when the article fits the budget", () => {
      expect(selectParagraphWindow(["a", "b", "c"], 1, 100)).toEqual([0, 1, 2]);
    });

    it("grows outward from the highlighted paragraph when over budget", () => {
      const paragraphs = Array.from({ length: 10 }, () => "x".repeat(10));
      expect(selectParagraphWindow(paragraphs, 5, 30)).toEqual([4, 5, 6]);
    });

    it("keeps growing on one side once the other edge is reached", () => {
      const paragraphs = Array.from({ length: 10 }, () => "x".repeat(10));
      expect(selectParagraphWindow(paragraphs, 0, 30)).toEqual([0, 1, 2]);
    });
  });

  describe("formatArticle", () => {
    it("numbers paragraphs from 1 and marks the highlighted one", () => {
      const text = formatArticle("Title", ["First.", "Second."], 1);
      expect(text).toContain("¶1\nFirst.");
      expect(text).toContain("¶2 ← contains the highlighted passage\nSecond.");
    });

    it("marks gaps where paragraphs were left out", () => {
      const paragraphs = Array.from({ length: 5 }, (_, i) =>
        `p${i}`.padEnd(200_000 / 4, "x"),
      );
      const text = formatArticle("T", paragraphs, 2);
      expect(text.startsWith("# T\n\n[…]")).toBe(true);
      expect(text.trimEnd().endsWith("[…]")).toBe(true);
      expect(text).not.toContain("¶1\n");
    });
  });

  describe("companionRequestSchema", () => {
    const base = {
      title: "T",
      paragraphs: ["p"],
      selection: "passage",
      paragraphIndex: 0,
    };

    it("rejects ask without a question", () => {
      expect(
        companionRequestSchema.safeParse({ ...base, mode: "ask" }).success,
      ).toBe(false);
    });

    it("accepts explain without a question and defaults history", () => {
      const parsed = companionRequestSchema.parse({ ...base, mode: "explain" });
      expect(parsed.history).toEqual([]);
    });

    it("accepts Define without a question but requires a selected term", () => {
      expect(
        companionRequestSchema.safeParse({ ...base, mode: "define" }).success,
      ).toBe(true);
      expect(
        companionRequestSchema.safeParse({
          ...base,
          mode: "define",
          selection: " ",
        }).success,
      ).toBe(false);
    });
  });

  describe("buildCompanionPrompt", () => {
    it("grounds definitions and substitute phrases in the actual sentence without inventing etymology", () => {
      const request = companionRequestSchema.parse({
        mode: "define",
        title: "Markets",
        paragraphs: ["Demand for this product is elastic."],
        selection: "elastic",
        paragraphIndex: 0,
      });
      const { messages } = buildCompanionPrompt(request);
      const opening = messages[0].content;
      expect(opening).toContain("Demand for this product is elastic.");
      expect(opening).toContain("dictionary-style meaning and part of speech");
      expect(opening).toContain("precise sense in this sentence");
      expect(opening).toContain(
        "acknowledge uncertainty rather than inventing an origin",
      );
      expect(opening).toContain("sentence fragment with each replacement");
    });
    it("puts the article, passage and question first, then follow-ups", () => {
      const { system, messages } = buildCompanionPrompt({
        mode: "ask",
        length: "brief",
        level: "expert",
        depth: "quick",
        web: true,
        title: "T",
        paragraphs: ["Alpha.", "Beta."],
        selection: "Beta",
        paragraphIndex: 1,
        question: "Why beta?",
        history: [
          { role: "assistant", content: "Because." },
          { role: "user", content: "Say more" },
        ],
      });
      expect(system).toContain("under 70 words");
      expect(system).toContain("fluent in the field");
      expect(system).toContain("You can search the web");
      expect(messages).toHaveLength(3);
      const opening = String(messages[0].content);
      expect(opening).toContain('<highlighted_passage paragraph="¶2">\nBeta\n');
      expect(opening).toContain("Reader's question: Why beta?");
      expect(messages[2]).toEqual({ role: "user", content: "Say more" });
    });
  });

  it("leaves web guidance out when search is off", () => {
    expect(
      buildSystemPrompt({ length: "standard", level: "balanced" }),
    ).not.toContain("search the web");
  });

  describe("sourcesFooter", () => {
    it("lists only sources the answer didn't already link", () => {
      const footer = sourcesFooter("See [a.com](https://a.com/x).", [
        { url: "https://a.com/x" },
        { url: "https://www.b.org/y" },
        { url: "https://www.b.org/y" },
      ]);
      expect(footer).toBe("\n\nSources: [b.org](https://www.b.org/y)");
    });

    it("adds nothing when there were no searches", () => {
      expect(sourcesFooter("Answer.", [])).toBe("");
    });
  });

  describe("whole-article questions", () => {
    const base = {
      title: "T",
      paragraphs: ["Alpha.", "Beta."],
      paragraphIndex: null,
    };

    it("accept a question without a passage", () => {
      const parsed = companionRequestSchema.parse({
        ...base,
        mode: "article",
        question: "Why?",
      });
      const { messages } = buildCompanionPrompt(parsed);
      const opening = String(messages[0].content);
      expect(opening).not.toContain("<highlighted_passage");
      expect(opening).toContain("about the article as a whole");
      expect(opening).toContain("Reader's question: Why?");
    });

    it("still require a passage for Explain", () => {
      expect(
        companionRequestSchema.safeParse({ ...base, mode: "explain" }).success,
      ).toBe(false);
    });

    it("require a question", () => {
      expect(
        companionRequestSchema.safeParse({ ...base, mode: "article" }).success,
      ).toBe(false);
    });
  });
});
