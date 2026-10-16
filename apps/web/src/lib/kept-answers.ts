import type { Doc } from "@marginalia/backend/convex/_generated/dataModel";
import type { CompanionMode } from "./companion";
import { MODE_LABELS } from "./margin-answers";

export type KeptAnswer =
  | {
      kind: "thread";
      id: string;
      createdAt: number;
      mode: CompanionMode;
      thread: Doc<"companionThreads">;
    }
  | {
      kind: "legacy";
      id: string;
      createdAt: number;
      mode: CompanionMode;
      note: Doc<"userNotes">;
    };

// What the old "Add to notes" button wrote: one <h3> and then only <p> blocks.
const LEGACY_SHAPE = /^<h3>([\s\S]*?)<\/h3>((?:<p>[\s\S]*?<\/p>)+)$/;

const unescapeHtml = (text: string) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const modeOfLabel = (heading: string): CompanionMode | undefined =>
  (Object.keys(MODE_LABELS) as CompanionMode[]).find(
    (mode) =>
      MODE_LABELS[mode] === heading ||
      (mode === "article" && heading === "Article"),
  );

/**
 * Whether a note is a copy of an answer the old "Add to notes" button made.
 * The copy has no marker, only a shape: the heading was the question or the
 * mode's name, then the answer. That shape is also one a note of BK's own can
 * take (the editor allows level-3 headings), so a note counts only when its
 * heading is a mode's name, or when it is the question of a saved thread on
 * the same passage, which every answer had before answers became temporary.
 * A copy whose thread was since deleted and whose heading is a question reads
 * as one of BK's own notes: it stays visible, just not folded.
 */
export function legacyAnswer(
  note: Doc<"userNotes">,
  threads: Doc<"companionThreads">[],
): CompanionMode | null {
  if (note.annotationId) return null;
  const match = LEGACY_SHAPE.exec(note.content.trim());
  if (!match) return null;
  const heading = unescapeHtml(match[1]);
  if (!note.contentPlain.startsWith(`${heading}\n\n`)) return null;
  const labelled = modeOfLabel(heading);
  if (labelled) return labelled;
  return (
    threads.find(
      (t) => t.question === heading && t.selection === note.selectedText,
    )?.mode ?? null
  );
}

/** BK's own notes, and separately everything Marginalia said that he kept. */
export function splitNotes(
  notes: Doc<"userNotes">[],
  threads: Doc<"companionThreads">[],
): { mine: Doc<"userNotes">[]; answers: KeptAnswer[] } {
  const mine: Doc<"userNotes">[] = [];
  const answers: KeptAnswer[] = [];
  for (const note of notes) {
    const mode = legacyAnswer(note, threads);
    if (mode)
      answers.push({
        kind: "legacy",
        id: note._id,
        createdAt: note.createdAt,
        mode,
        note,
      });
    else mine.push(note);
  }
  for (const thread of threads) {
    // Threads saved before answers became temporary were not kept on purpose.
    if (thread.keptAt === undefined) continue;
    answers.push({
      kind: "thread",
      id: thread._id,
      createdAt: thread.keptAt,
      mode: thread.mode,
      thread,
    });
  }
  answers.sort((a, b) => b.createdAt - a.createdAt);
  return { mine, answers };
}
