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
const LEGACY_COPY_PATTERN = /^<h3>([\s\S]*?)<\/h3>((?:<p>[\s\S]*?<\/p>)+)$/;

const unescapeHtml = (text: string) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** The heading the old button wrote: the question, or the mode's name. */
const headingOf = (thread: Doc<"companionThreads">) =>
  thread.question ??
  (thread.mode === "article" ? "Article" : MODE_LABELS[thread.mode]);

/**
 * Whether a note is a copy of an answer the old "Add to notes" button made.
 * The copy has no marker, only a shape (one <h3>, then only <p> blocks), and
 * BK's own notes can take that shape too: the editor allows level-3 headings,
 * and "Explain" is as good a heading as any. So the shape alone never decides
 * authorship. A note counts as Marginalia's only when a thread saved on the
 * same passage has that heading, which every answer had before answers became
 * temporary. A copy whose thread was since deleted reads as BK's own note: it
 * stays visible, just not folded.
 */
export function legacyAnswer(
  note: Doc<"userNotes">,
  threads: Doc<"companionThreads">[],
): CompanionMode | null {
  if (note.annotationId) return null;
  const match = LEGACY_COPY_PATTERN.exec(note.content.trim());
  if (!match) return null;
  const heading = unescapeHtml(match[1]);
  if (!note.contentPlain.startsWith(`${heading}\n\n`)) return null;
  return (
    threads.find(
      (t) => t.selection === note.selectedText && headingOf(t) === heading,
    )?.mode ?? null
  );
}

interface SplitNotes {
  mine: Doc<"userNotes">[];
  answers: KeptAnswer[];
}

/** BK's own notes, and separately everything Marginalia said that he kept. */
export function splitNotes(
  notes: Doc<"userNotes">[],
  threads: Doc<"companionThreads">[],
): SplitNotes {
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
