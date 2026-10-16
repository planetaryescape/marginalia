import type { Doc } from "@marginalia/backend/convex/_generated/dataModel";
import type { SidenoteAnswer } from "@/components/sidenotes";
import type { CompanionMode, CompanionThread } from "./companion";
import { plainNote } from "./margin-kinds";

export const MODE_LABELS = {
  explain: "Explain",
  simplify: "Simplify",
  define: "Define",
  ask: "Ask",
  article: "Ask the article",
} as const satisfies Record<CompanionMode, string>;

const firstLine = (turns: { role: string; content: string }[]) =>
  plainNote(
    turns.find((t) => t.role === "assistant" && t.content.trim())?.content ??
      "",
  ) || "…";

const labelOf = (mode: CompanionMode, kept: boolean) =>
  kept ? `${MODE_LABELS[mode]} · kept` : MODE_LABELS[mode];

/**
 * Everything Marginalia has said on this article as margin notes: this visit's
 * answers, then saved answers not already among them. An answer's identity is
 * its id, never its passage and question: asking the same thing of a kept
 * passage again is a new answer and must show.
 */
export function answerNotes(
  answers: CompanionThread[],
  kept: Doc<"companionThreads">[] | undefined,
): SidenoteAnswer[] {
  const saved = kept ?? [];
  const notes: SidenoteAnswer[] = [];
  for (const a of answers) {
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
      label: labelOf(doc.mode, doc.keptAt !== undefined),
      text: firstLine(doc.turns),
      selection: doc.selection,
      paragraphIndex: doc.paragraphIndex ?? null,
    });
  }
  return notes;
}
