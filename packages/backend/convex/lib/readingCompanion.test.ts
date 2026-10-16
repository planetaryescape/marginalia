import { describe, expect, it } from "vitest";
import { sourcesFooter } from "./companionStream";
import {
  buildCompanionPrompt,
  buildSystemPrompt,
  companionRequestSchema,
  formatArticle,
  selectContext,
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

  describe("per-tool context", () => {
    const paragraphs = Array.from({ length: 9 }, (_, i) => `Paragraph ${i}.`);
    const request = (over: Record<string, string | number | null>) =>
      companionRequestSchema.parse({
        mode: "explain",
        title: "T",
        paragraphs,
        selection: "Paragraph 4.",
        paragraphIndex: 4,
        ...over,
      });

    it("gives Define only the sentence's paragraph", () => {
      expect(selectContext(request({ mode: "define" })).indices).toEqual([4]);
    });

    it("gives Explain, Simplify and Ask the passage and a paragraph either side", () => {
      for (const mode of ["explain", "simplify"])
        expect(selectContext(request({ mode })).indices).toEqual([3, 4, 5]);
      expect(
        selectContext(request({ mode: "ask", question: "Why?" })).indices,
      ).toEqual([3, 4, 5]);
    });

    it("includes every paragraph a passage runs across", () => {
      const context = selectContext(
        request({
          paragraphIndex: 2,
          selection: "Paragraph 2. Paragraph 3. Paragraph 4.",
        }),
      );
      expect(context.indices).toEqual([1, 2, 3, 4, 5]);
      expect([...context.marked]).toEqual([2, 3, 4]);
    });

    it("includes the next paragraph when the selection ends only a few characters into it", () => {
      const long = [
        "First paragraph that is comfortably long enough to matter here.",
        "Second paragraph that is also comfortably long enough to matter.",
        "Third paragraph, which the selection barely enters, and then goes on.",
        "Fourth paragraph, untouched by the selection.",
        "Fifth paragraph, well away.",
      ];
      const context = selectContext(
        companionRequestSchema.parse({
          mode: "explain",
          title: "T",
          paragraphs: long,
          paragraphIndex: 1,
          selection: "also comfortably long enough to matter. Thi",
        }),
      );
      expect([...context.marked]).toEqual([1, 2]);
      expect(context.indices).toEqual([0, 1, 2, 3]);
    });

    it("includes every paragraph the client says the selection crosses, however short", () => {
      const blocks = [
        "An opening paragraph that is long enough to stand alone here.",
        "Why?",
        "No.",
        "A long closing paragraph that the selection does not reach at all.",
        "Another.",
      ];
      const asked = (extra: Record<string, number>) =>
        selectContext(
          companionRequestSchema.parse({
            mode: "explain",
            title: "T",
            paragraphs: blocks,
            paragraphIndex: 1,
            selection: "Why? No.",
            ...extra,
          }),
        );
      const told = asked({ paragraphEnd: 2 });
      expect([...told.marked]).toEqual([1, 2]);
      expect(told.indices).toEqual([0, 1, 2, 3]);
      // Old clients send no range, and text matching alone misses blocks this short
      expect([...asked({}).marked]).toEqual([1]);
    });

    it("clamps a range end that is out of order or past the article", () => {
      expect([
        ...selectContext(
          request({
            paragraphIndex: 4,
            paragraphEnd: 1,
            selection: "Paragraph 4.",
          }),
        ).marked,
      ]).toEqual([4]);
      expect(
        selectContext(
          request({
            paragraphIndex: 7,
            paragraphEnd: 99,
            selection: "Paragraph 7.",
          }),
        ).indices,
      ).toEqual([6, 7, 8]);
    });

    it("does not extend when the selection ends exactly at the paragraph's end", () => {
      const context = selectContext(
        request({ paragraphIndex: 4, selection: "Paragraph 4." }),
      );
      expect([...context.marked]).toEqual([4]);
    });

    it("stops at the edges of the article", () => {
      expect(
        selectContext(request({ paragraphIndex: 0, selection: "Paragraph 0." }))
          .indices,
      ).toEqual([0, 1]);
      expect(
        selectContext(request({ paragraphIndex: 8, selection: "Paragraph 8." }))
          .indices,
      ).toEqual([7, 8]);
    });

    it("finds the paragraph by its text when the client sent no index", () => {
      expect(
        selectContext(request({ mode: "define", paragraphIndex: null }))
          .indices,
      ).toEqual([4]);
    });

    it("keeps today's window for a question about the whole article", () => {
      const context = selectContext(
        request({
          mode: "article",
          selection: "",
          paragraphIndex: null,
          question: "Why?",
        }),
      );
      expect(context.indices).toEqual(paragraphs.map((_, i) => i));
    });

    it("sends a definition only its paragraph, not the whole article", () => {
      const { messages } = buildCompanionPrompt(request({ mode: "define" }));
      const opening = String(messages[0].content);
      expect(opening).toContain("Paragraph 4.");
      expect(opening).not.toContain("Paragraph 3.");
      expect(opening).not.toContain("Paragraph 5.");
    });

    it("tells Define which usage of a repeated word was selected", () => {
      const text = (sentence: string, occurrence: number) =>
        String(
          buildCompanionPrompt(
            request({
              mode: "define",
              selection: "bass",
              sentence,
              occurrence,
            }),
          ).messages[0].content,
        );
      const first = text("He caught a bass.", 0);
      const second = text("She played the bass.", 1);
      expect(first).toContain('in this sentence: "He caught a bass."');
      expect(first).not.toContain("occurrence");
      expect(second).toContain('in this sentence: "She played the bass."');
      expect(second).toContain("occurrence 2 of the selected words");
      expect(first).not.toBe(second);
      // Other tools, and old clients that send no sentence, are unchanged
      expect(
        String(
          buildCompanionPrompt(request({ mode: "explain", sentence: "x" }))
            .messages[0].content,
        ),
      ).not.toContain("selected usage");
      expect(
        String(
          buildCompanionPrompt(request({ mode: "define" })).messages[0].content,
        ),
      ).not.toContain("selected usage");
    });

    it("adds the summary as background when there is one", () => {
      const { messages } = buildCompanionPrompt(request({}), {
        thesis: "Prices drive demand.",
        gist: "A tour of markets.",
      });
      const opening = String(messages[0].content);
      expect(opening).toContain("<summary>");
      expect(opening).toContain("Prices drive demand.");
      expect(opening).toContain("A tour of markets.");
      expect(opening.indexOf("<summary>")).toBeLessThan(
        opening.indexOf("<article>"),
      );
      expect(
        String(buildCompanionPrompt(request({})).messages[0].content),
      ).not.toContain("<summary>");
    });

    it("tells each tool how long to be", () => {
      const text = (mode: string, extra = {}) =>
        String(
          buildCompanionPrompt(request({ mode, ...extra })).messages[0].content,
        );
      expect(text("define")).toContain("a line or two");
      expect(text("explain")).toContain("one short paragraph");
      expect(text("simplify")).toContain("one short paragraph");
      expect(text("ask", { question: "Why?" })).toContain(
        "as long as the question needs",
      );
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
