import type { Doc } from "@marginalia/backend/convex/_generated/dataModel";
import { expect, it } from "vitest";
import { legacyAnswer } from "./kept-answers";

// SAFETY: only the fields legacyAnswer reads; Convex owns the full shapes.
const note = (content: string, contentPlain: string) =>
  ({ content, contentPlain, selectedText: "generics" }) as Doc<"userNotes">;
const thread = (answer: string) =>
  ({
    mode: "explain",
    selection: "generics",
    turns: [{ role: "assistant", content: answer }],
  }) as Doc<"companionThreads">;

it("recognises an old copy of an answer with code-like text in it", () => {
  const copy = note(
    "<h3>Explain</h3><p>Use Array&lt;T&gt; for a list.</p>",
    "Explain\n\nUse Array<T> for a list.",
  );
  expect(legacyAnswer(copy, [thread("Use Array<T> for a list.")])).toBe(
    "explain",
  );
});

it("still reads a note whose text differs from the answer as the reader's own", () => {
  const mine = note(
    "<h3>Explain</h3><p>My own words.</p>",
    "Explain\n\nMy own words.",
  );
  expect(legacyAnswer(mine, [thread("Use Array<T> for a list.")])).toBeNull();
});
