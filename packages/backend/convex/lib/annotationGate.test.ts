import { describe, expect, it } from "vitest";
import {
  annotationBudget,
  type CandidateNote,
  gateNotes,
} from "./annotationGate";
import { ANNOTATION_KINDS, KIND_FAMILIES } from "./annotationKinds";

const content =
  "Every team we studied shipped more. Remote work makes teams faster. Either embrace it or fall behind. Written culture matters most.";

const note = (fields: Partial<CandidateNote>): CandidateNote => ({
  type: "assumption",
  anchorText: "Remote work makes teams faster.",
  content: "Assumes the office was the cause.",
  relevanceScore: 0.8,
  ...fields,
});

const gate = (candidates: CandidateNote[], offered: string[] = [], cap = 10) =>
  gateNotes(candidates, {
    content,
    offeredArticleIds: new Set(offered),
    cap,
  });

describe("annotation kinds", () => {
  it("covers ten kinds in three families, each kind once", () => {
    expect(ANNOTATION_KINDS).toHaveLength(10);
    expect(new Set(ANNOTATION_KINDS).size).toBe(10);
    expect(KIND_FAMILIES.pushback).toHaveLength(5);
    expect(KIND_FAMILIES.support).toEqual(["strong_point", "crux"]);
    expect(KIND_FAMILIES.connection).toEqual([
      "cross_reference",
      "context",
      "question",
    ]);
  });
});

describe("annotationBudget", () => {
  it("is about one note per screen, never fewer than a couple", () => {
    expect(annotationBudget(100).target).toBe(2);
    expect(annotationBudget(1_400).target).toBe(4);
    expect(annotationBudget(3_500).target).toBe(10);
  });

  it("allows more than the target where the text is dense, within a ceiling", () => {
    const { target, cap } = annotationBudget(3_500);
    expect(cap).toBeGreaterThan(target);
    expect(annotationBudget(500_000).cap).toBe(40);
    expect(annotationBudget(0).cap).toBeGreaterThanOrEqual(2);
  });
});

describe("gateNotes", () => {
  it("keeps every real kind and drops invented ones", () => {
    const kept = gate(
      ANNOTATION_KINDS.map((type, i) =>
        note({
          type,
          // A vault path keeps cross_reference valid on its own
          notePath: "a.md",
          anchorText: content.slice(i * 3, i * 3 + 12),
        }),
      ).concat([
        note({
          type: "constructor",
          anchorText: "Written culture matters most.",
        }),
        note({ type: "praise", anchorText: "Either embrace it" }),
      ]),
      [],
      40,
    );
    expect(kept.rejected.kind).toBe(2);
    expect(kept.notes.every((n) => ANNOTATION_KINDS.includes(n.type))).toBe(
      true,
    );
  });

  it("drops a note whose anchor is not in the article", () => {
    const { notes, rejected } = gate([
      note({ anchorText: "Not in the text." }),
      note({ anchorText: "" }),
    ]);
    expect(notes).toHaveLength(0);
    expect(rejected.anchor).toBe(2);
  });

  it("drops a note below the relevance floor, and NaN", () => {
    const { notes, rejected } = gate([
      note({ relevanceScore: 0.4 }),
      note({ relevanceScore: Number.NaN }),
    ]);
    expect(notes).toHaveLength(0);
    expect(rejected.relevance).toBe(2);
  });

  it("accepts a library connection only for an id it was offered", () => {
    const connection = note({
      type: "cross_reference",
      articleRefId: "abc",
      notePath: undefined,
    });
    expect(gate([connection], ["abc"]).notes).toMatchObject([
      { articleRefId: "abc" },
    ]);
    const invented = gate([connection], ["xyz"]);
    expect(invented.notes).toHaveLength(0);
    expect(invented.rejected.articleRef).toBe(1);
    // Even a valid vault path does not rescue a note citing an id that was never offered
    expect(
      gate([{ ...connection, notePath: "note.md" }], []).notes,
    ).toHaveLength(0);
  });

  it("drops a connection that cites nothing", () => {
    const { notes, rejected } = gate([note({ type: "cross_reference" })]);
    expect(notes).toHaveLength(0);
    expect(rejected.connection).toBe(1);
  });

  it("lets only a connection cite an article, and only a fallacy carry a name", () => {
    const { notes } = gate(
      [
        note({ type: "assumption", articleRefId: "abc", fallacyName: "x" }),
        note({
          type: "fallacy",
          anchorText: "Either embrace it or fall behind.",
          fallacyName: "  false dilemma  ",
          articleRefId: "abc",
        }),
      ],
      ["abc"],
    );
    expect(notes).toHaveLength(2);
    for (const n of notes) expect(n.articleRefId).toBeUndefined();
    expect(
      notes.find((n) => n.type === "assumption")?.fallacyName,
    ).toBeUndefined();
    expect(notes.find((n) => n.type === "fallacy")?.fallacyName).toBe(
      "false dilemma",
    );
  });

  it("keeps the stronger of two overlapping notes and honours the cap", () => {
    const { notes } = gate(
      [
        note({
          anchorText: "Remote work makes teams faster.",
          relevanceScore: 0.6,
        }),
        note({ anchorText: "work makes teams", relevanceScore: 0.9 }),
        note({
          anchorText: "Written culture matters most.",
          relevanceScore: 0.7,
        }),
        note({
          anchorText: "Either embrace it or fall behind.",
          relevanceScore: 0.55,
        }),
      ],
      [],
      2,
    );
    expect(notes.map((n) => n.anchorText)).toEqual([
      "work makes teams",
      "Written culture matters most.",
    ]);
  });

  it("does not depend on the order the model listed notes in", () => {
    const list = [
      note({
        anchorText: "Written culture matters most.",
        relevanceScore: 0.7,
      }),
      note({
        anchorText: "Every team we studied shipped more.",
        relevanceScore: 0.9,
      }),
      note({
        anchorText: "Either embrace it or fall behind.",
        relevanceScore: 0.8,
      }),
    ];
    const a = gate(list, [], 2).notes.map((n) => n.anchorText);
    const b = gate([...list].reverse(), [], 2).notes.map((n) => n.anchorText);
    expect(a).toEqual(b);
  });
});
