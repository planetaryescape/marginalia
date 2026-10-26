import { describe, expect, it } from "vitest";
import type { CompanionThread } from "./companion";
import { answerNotes, articleHistory } from "./margin-answers";

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
  it("previews an answer's markdown as plain text, list markers included", () => {
    const [note] = answerNotes(
      [
        live({
          turns: [
            {
              role: "assistant",
              content: "Terms:\n- *transducere*\n- **bold**",
            },
          ],
        }),
      ],
      [],
    );
    expect(note.text).toBe("Terms: transducere bold");
  });
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

describe("articleHistory", () => {
  it("lists this visit's whole-article answers, kept or not, ahead of earlier kept ones", () => {
    const whole = {
      mode: "article" as const,
      selection: "",
      paragraphIndex: null,
    };
    const items = articleHistory(
      [
        live({ ...whole, id: "u1", question: "First?" }),
        live({ ...whole, id: "u2", question: "Second?" }),
        live({ id: "u3" }),
      ],
      [
        saved({
          _id: "t1",
          mode: "article",
          question: "Earlier?",
          updatedAt: 5,
        }),
        saved({
          _id: "t2",
          mode: "article",
          question: "Newest?",
          updatedAt: 9,
        }),
        saved({ _id: "t3" }),
      ],
    );
    expect(items.map((i) => [i.id, i.question, i.when])).toEqual([
      ["u2", "Second?", undefined],
      ["u1", "First?", undefined],
      ["t2", "Newest?", 9],
      ["t1", "Earlier?", 5],
    ]);
  });

  it("lists a kept answer once", () => {
    const items = articleHistory(
      [
        live({
          id: "u1",
          mode: "article",
          question: "Q?",
          selection: "",
          paragraphIndex: null,
          savedId: "t1" as never,
        }),
      ],
      [saved({ _id: "t1", mode: "article", question: "Q?", updatedAt: 1 })],
    );
    expect(items).toHaveLength(1);
  });
});
