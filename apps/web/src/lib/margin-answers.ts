import type { Doc } from "@marginalia/backend/convex/_generated/dataModel";
import type { SidenoteAnswer } from "@/components/sidenotes";
import type { CompanionMode, CompanionThread } from "./companion";
import { plainNote } from "./margin-kinds";

export const MODE_LABELS: Record<CompanionMode, string> = {
  explain: "Explain",
  simplify: "Simplify",
  define: "Define",
  ask: "Ask",
  article: "Ask the article",
};

type Answerable = Pick<
  CompanionThread,
  "mode" | "selection" | "question" | "paragraphIndex"
>;

/** The same question about the same words in the same place. */
function sameAnswer(a: Answerable, b: Answerable) {
  return (
    a.mode === b.mode &&
    a.selection === b.selection &&
    (a.question ?? "") === (b.question ?? "") &&
    a.paragraphIndex === b.paragraphIndex
  );
}

const firstLine = (turns: { role: string; content: string }[]) =>
  plainNote(
    turns.find((t) => t.role === "assistant" && t.content.trim())?.content ??
      "",
  ) || "…";

const labelOf = (mode: CompanionMode, kept: boolean) =>
  kept ? `${MODE_LABELS[mode]} · kept` : MODE_LABELS[mode];

/**
 * Everything Marginalia has said on this article as margin notes: this visit's
 * answers, then kept answers not already among them. An unkept answer that a
 * kept record already covers (a Keep that landed as the page refreshed) is
 * left out, so one answer never shows twice.
 */
export function answerNotes(
  answers: CompanionThread[],
  kept: Doc<"companionThreads">[] | undefined,
): SidenoteAnswer[] {
  const saved = kept ?? [];
  const notes: SidenoteAnswer[] = [];
  for (const a of answers) {
    if (
      !a.savedId &&
      saved.some((doc) =>
        sameAnswer(a, { ...doc, paragraphIndex: doc.paragraphIndex ?? null }),
      )
    )
      continue;
    notes.push({
      id: a.id,
      label: labelOf(a.mode, Boolean(a.savedId)),
      text: firstLine(a.turns),
      selection: a.selection,
      paragraphIndex: a.paragraphIndex,
    });
  }
  for (const doc of saved) {
    if (answers.some((a) => a.id === doc._id || a.savedId === doc._id))
      continue;
    notes.push({
      id: doc._id,
      label: labelOf(doc.mode, true),
      text: firstLine(doc.turns),
      selection: doc.selection,
      paragraphIndex: doc.paragraphIndex ?? null,
    });
  }
  return notes;
}
