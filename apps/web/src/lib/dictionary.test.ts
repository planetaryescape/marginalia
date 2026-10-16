import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { describe, expect, it } from "vitest";
import {
  groupLookups,
  guideWords,
  type LookupRow,
  searchEntries,
  splitColumns,
  splitSense,
  thumbIndex,
  wordsThisMonth,
} from "./dictionary";

let n = 0;
const row = (over: Partial<LookupRow> & { wordKey: string }): LookupRow => {
  n++;
  return {
    _id: `l${n}`,
    articleId: "art1" as Id<"articles">,
    articleTitle: "On boring infrastructure",
    word: over.wordKey,
    sentence: `A sentence with ${over.wordKey}.`,
    paragraphIndex: 2,
    sense: "adj. A fixture sense.",
    createdAt: 1000 + n,
    ...over,
  };
};

describe("splitSense", () => {
  it("takes a leading part of speech", () => {
    expect(splitSense("adj. Changing a lot.")).toEqual({
      partOfSpeech: "adj.",
      text: "Changing a lot.",
    });
    expect(splitSense("(noun) a close reading")).toEqual({
      partOfSpeech: "n.",
      text: "a close reading",
    });
    expect(splitSense("Verb: to leave out")).toEqual({
      partOfSpeech: "v.",
      text: "to leave out",
    });
  });

  it("leaves a sense without one alone", () => {
    expect(splitSense("Noun phrase for a thing")).toEqual({
      partOfSpeech: null,
      text: "Noun phrase for a thing",
    });
    expect(splitSense("adj.")).toEqual({ partOfSpeech: null, text: "adj." });
    expect(splitSense("  to stretch  ").text).toBe("to stretch");
  });
});

describe("groupLookups", () => {
  it("makes one entry per word with every sense, oldest first", () => {
    const entries = groupLookups([
      row({
        wordKey: "epistemic",
        sense: "n. the study of it",
        createdAt: 200,
      }),
      row({
        wordKey: "epistemic",
        sense: "adj. to do with knowledge",
        createdAt: 100,
      }),
      row({ wordKey: "elide" }),
    ]);
    expect(entries.map((e) => e.headword)).toEqual(["elide", "epistemic"]);
    expect(entries[1].senses.map((s) => s.text)).toEqual([
      "to do with knowledge",
      "the study of it",
    ]);
    expect(entries[1].senses.map((s) => s.partOfSpeech)).toEqual([
      "adj.",
      "n.",
    ]);
  });

  it("orders words the same whatever order the rows arrive in", () => {
    const rows = [
      "zeal",
      "épistémique",
      "Ergodic".toLowerCase(),
      "c++",
      "epistemic",
      "42",
    ].map((wordKey) => row({ wordKey }));
    const forward = groupLookups(rows).map((e) => e.headword);
    const backward = groupLookups([...rows].reverse()).map((e) => e.headword);
    expect(forward).toEqual(backward);
    // Accents don't push a word to the end; digits file first
    expect(forward).toEqual([
      "42",
      "c++",
      "epistemic",
      "épistémique",
      "ergodic",
      "zeal",
    ]);
  });

  it("links a sentence to its line, and drops the link for a deleted article", () => {
    const [live, gone] = groupLookups([
      row({ wordKey: "alpha", sentence: "the quick fox", paragraphIndex: 3 }),
      row({ wordKey: "beta", articleTitle: null }),
    ]);
    expect(live.senses[0].href).toBe("/read/art1?quote=the+quick+fox&p=3");
    expect(gone.senses[0].href).toBeNull();
    expect(gone.senses[0].articleTitle).toBeNull();
    expect(gone.senses[0].sentence).toBeTruthy();
  });

  it("leaves out a row without a word key and handles an empty library", () => {
    expect(groupLookups([row({ wordKey: "" })])).toEqual([]);
    expect(groupLookups([])).toEqual([]);
  });
});

describe("searchEntries", () => {
  const entries = groupLookups(
    ["elastic", "epistemic", "épistémique", "ergodic", "Zeal"].map((wordKey) =>
      row({ wordKey: wordKey.toLowerCase() }),
    ),
  );
  it("matches the start or the middle of a word, ignoring accents and case", () => {
    expect(searchEntries(entries, "ER").map((e) => e.headword)).toEqual([
      "ergodic",
    ]);
    expect(searchEntries(entries, "stic").map((e) => e.headword)).toEqual([
      "elastic",
    ]);
    expect(searchEntries(entries, "epist").map((e) => e.headword)).toEqual([
      "epistemic",
      "épistémique",
    ]);
    expect(searchEntries(entries, "é").map((e) => e.headword)).toContain(
      "elastic",
    );
  });
  it("returns everything for a blank search and nothing for no match", () => {
    expect(searchEntries(entries, "  ")).toHaveLength(5);
    expect(searchEntries(entries, "qq")).toEqual([]);
  });
});

describe("thumbIndex", () => {
  it("dims the letters with no words", () => {
    const thumb = thumbIndex(
      groupLookups([row({ wordKey: "elastic" }), row({ wordKey: "zeal" })]),
    );
    expect(thumb).toHaveLength(26);
    expect(thumb.filter((t) => t.hasWords).map((t) => t.letter)).toEqual([
      "E",
      "Z",
    ]);
  });
  it("adds # only when a word needs it", () => {
    expect(thumbIndex(groupLookups([row({ wordKey: "42" })]))[0]).toEqual({
      letter: "#",
      hasWords: true,
    });
    expect(thumbIndex([])).toHaveLength(26);
  });
});

describe("columns and guide words", () => {
  it("splits into two columns, each headed by its first and last word", () => {
    const entries = groupLookups(
      ["ant", "bee", "cat", "dog", "eel", "fox"].map((wordKey) =>
        row({ wordKey }),
      ),
    );
    const [left, right] = splitColumns(entries);
    expect(left.length + right.length).toBe(6);
    expect(guideWords(left)).toEqual(["ant", "cat"]);
    expect(guideWords(right)).toEqual(["dog", "fox"]);
  });
  it("weights an entry by its senses and copes with a single word", () => {
    const [left, right] = splitColumns(
      groupLookups([row({ wordKey: "only" })]),
    );
    expect(left).toHaveLength(1);
    expect(right).toEqual([]);
    expect(guideWords(right)).toBeNull();
  });
});

describe("wordsThisMonth", () => {
  const now = new Date(2026, 9, 16, 12);
  it("counts words first looked up this month, not words met again", () => {
    const at = (m: number, d: number) => new Date(2026, m, d, 10).getTime();
    expect(
      wordsThisMonth(
        [
          row({ wordKey: "new", createdAt: at(9, 3) }),
          row({ wordKey: "old", createdAt: at(8, 20) }),
          row({ wordKey: "old", createdAt: at(9, 5) }),
        ],
        now,
      ),
    ).toBe(1);
  });
});
