import { describe, expect, it } from "vitest";
import type { CompanionThread } from "./companion";
import { answerNotes } from "./margin-answers";

const live = (over: Partial<CompanionThread>): CompanionThread => ({
  id: "u1",
  mode: "define",
  selection: "tarn",
  paragraphIndex: 1,
  turns: [{ role: "assistant", content: "A **small** lake. More." }],
  status: "done",
  ...over,
});
const saved = (over: Record<string, unknown>) =>
  ({
    _id: "t1",
    mode: "define",
    selection: "tarn",
    paragraphIndex: 1,
    turns: [{ role: "assistant", content: "A small lake." }],
    ...over,
  }) as never;

describe("answerNotes", () => {
  it("labels this visit's answers and previews their first line in plain text", () => {
    const [note] = answerNotes([live({})], []);
    expect(note).toMatchObject({
      id: "u1",
      label: "Define",
      text: "A small lake. More.",
      selection: "tarn",
      paragraphIndex: 1,
    });
  });
  it("marks a kept answer and lists kept answers from earlier visits", () => {
    const notes = answerNotes(
      [live({ savedId: "t9" as never })],
      [saved({ keptAt: 5 })],
    );
    expect(notes.map((n) => [n.id, n.label])).toEqual([
      ["u1", "Define · kept"],
      ["t1", "Define · kept"],
    ]);
  });
  it("never shows one answer twice: identity is the answer's id", () => {
    expect(
      answerNotes([live({ savedId: "t1" as never })], [saved({})]),
    ).toHaveLength(1);
    expect(answerNotes([live({ id: "t1" })], [saved({})])).toHaveLength(1);
  });
  it("shows a fresh answer to a passage and question that a kept answer already covers", () => {
    const notes = answerNotes(
      [live({ status: "streaming" })],
      [saved({ keptAt: 5 })],
    );
    expect(notes.map((n) => [n.id, n.label])).toEqual([
      ["u1", "Define"],
      ["t1", "Define · kept"],
    ]);
  });
  it("does not call a thread saved before Keep existed kept", () => {
    expect(answerNotes([], [saved({})])[0].label).toBe("Define");
  });
  it("labels a question about the whole article", () => {
    const [note] = answerNotes(
      [live({ mode: "article", selection: "", paragraphIndex: null })],
      undefined,
    );
    expect(note.label).toBe("Ask the article");
  });
});
