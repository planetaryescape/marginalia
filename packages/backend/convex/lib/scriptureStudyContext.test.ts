import { describe, expect, it } from "vitest";
import { STUDY_LIMITS } from "./scriptureStudy";
import {
  chapterVerses,
  studyChapterContext,
  studyReaderContext,
} from "./scriptureStudyContext";

const selection = {
  referenceKey: "COL.2.20-COL.2.23",
  startVerseId: "COL.2.20",
  endVerseId: "COL.2.23",
  versificationId: "web",
};
const chapter = Array.from({ length: 23 }, (_, i) => ({
  id: `COL.2.${i + 1}`,
  verse: i + 1,
  text: `WEB verse ${i + 1}.`,
}));
describe("bounded wider chapter context", () => {
  it("retains the beginning of Colossians2 for a final-paragraph selection without duplicating existing selected/adjacent evidence", () => {
    const context = studyChapterContext(chapter, selection, 12_000);
    expect(context.coverage).toBe("full_retrieved_chapter");
    expect(context.ranges).toEqual(["COL.2.1-COL.2.23"]);
    expect(context.evidenceBlocks).toEqual([
      {
        referenceKey: "COL.2.1-COL.2.17",
        excerpt: chapter
          .slice(0, 17)
          .map((v) => `${v.id} ${v.text}`)
          .join("\n"),
      },
    ]);
  });
  it("falls back to nearby, accurately labelled context when a long chapter cannot fit", () => {
    const long = chapter.map((v) => ({ ...v, text: "x".repeat(900) }));
    const context = studyChapterContext(long, selection, 2_000);
    expect(context.coverage).toBe("bounded");
    expect(context.ranges).toEqual(["COL.2.16-COL.2.23"]);
    expect(
      context.evidenceBlocks.reduce((n, b) => n + b.excerpt.length, 0),
    ).toBeLessThanOrEqual(2_000);
    expect(
      context.evidenceBlocks.every(
        (b) => b.excerpt.length <= STUDY_LIMITS.excerptChars,
      ),
    ).toBe(true);
  });
  it("never jumps over an absent verse or labels a sparse response a full chapter", () => {
    const context = studyChapterContext(
      chapter.filter((v) => v.verse !== 17),
      selection,
      12_000,
    );
    expect(context.coverage).toBe("bounded");
    expect(context.ranges).toEqual(["COL.2.18-COL.2.23"]);
    expect(context.evidenceBlocks).toEqual([]);
  });
});

describe("saved notes are bounded data, not evidence or instructions", () => {
  const note = {
    selectedText: "WEB verse 21.",
    contentPlain: "My question",
    licensedQuote: false,
  };
  const content = chapter.map((v) => `2:${v.verse} ${v.text}`).join("\n\n");
  it("prioritises verified passage notes but never guesses an alignment for licensed selections", () => {
    const result = studyReaderContext(
      [{ ...note, licensedQuote: true, contentPlain: "Chapter note" }, note],
      "Colossians 2",
      content,
      selection,
      false,
    );
    expect(result.notes.map((n) => [n.scope, n.text])).toEqual([
      ["passage", "My question"],
      ["chapter", "Chapter note"],
    ]);
    expect(JSON.stringify(result)).not.toContain("WEB verse 21.");
  });
  it("excludes ambiguously located notes in multi-chapter readings and includes uniquely located ones in the selected chapter", () => {
    const source = `1:1 Repeated phrase\n\n${content}\n\n2:24 Repeated phrase`;
    const result = studyReaderContext(
      [
        { ...note, selectedText: "Repeated phrase", contentPlain: "AMBIGUOUS" },
        { ...note, licensedQuote: true, contentPlain: "UNLOCATED_LICENSED" },
        note,
      ],
      "Colossians 1-2",
      source,
      selection,
      false,
    );
    expect(result.notes).toEqual([
      { label: "reader-note-1", scope: "passage", text: "My question" },
    ]);
  });
  it("bounds serialized note context even with control characters and never exposes HTML or selected wording", () => {
    const result = studyReaderContext(
      Array.from({ length: 40 }, () => ({
        ...note,
        contentPlain: "\u0001".repeat(10_000),
      })),
      "Colossians 2",
      content,
      selection,
      true,
    );
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      STUDY_LIMITS.readerContextChars,
    );
    expect(result.notes.length).toBeLessThanOrEqual(STUDY_LIMITS.readerNotes);
    expect(
      result.notes.every((n) => n.text.length <= STUDY_LIMITS.readerNoteChars),
    ).toBe(true);
    expect(result.limited).toBe(true);
    expect(chapterVerses(content, "Colossians 2")).toHaveLength(23);
  });
});
