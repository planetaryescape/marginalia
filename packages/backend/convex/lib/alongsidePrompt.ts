import { annotationBudget } from "./annotationGate";

export interface SaidNote {
  type: string;
  anchorText: string;
  content: string;
  /** Where the anchor sits in the whole article. */
  start: number;
  end: number;
}

// "Already said" shares the prompt with the section and the reader's context,
// so it is held to a few screens of notes
const MAX_SAID_CHARS = 5_000;
const MAX_SAID_NOTE_CHARS = 280;

/** The notes the margin already has on a section, newest context last, within a character budget. */
export function alreadySaid(
  notes: readonly SaidNote[],
  section: { start: number; end: number },
): SaidNote[] {
  const inSection = notes
    .filter((n) => n.start < section.end && n.end > section.start)
    .sort((a, b) => a.start - b.start);
  const kept: SaidNote[] = [];
  let used = 0;
  for (const note of inSection) {
    used +=
      Math.min(note.content.length, MAX_SAID_NOTE_CHARS) +
      note.anchorText.length;
    if (used > MAX_SAID_CHARS) break;
    kept.push(note);
  }
  return kept;
}

/** The user message of a reading-alongside pass: one section, with what the margin has said there. */
export function buildAlongsidePrompt(input: {
  title: string;
  author?: string;
  sectionIndex: number;
  sectionCount: number;
  sectionText: string;
  /** Opening words of every section, so the model knows where this one sits. */
  outline: readonly string[];
  contextText: string;
  said: readonly SaidNote[];
  wordCount: number;
}): string {
  const { target, cap } = annotationBudget(input.wordCount);
  const said = input.said.length
    ? input.said
        .map(
          (n) =>
            `- On "${n.anchorText}" (${n.type}): ${n.content.slice(0, MAX_SAID_NOTE_CHARS)}`,
        )
        .join("\n")
    : "Nothing yet.";
  return `## Article: "${input.title}"
${input.author ? `By: ${input.author}` : ""}

You are reading alongside the reader, who is partway through this piece. Only section ${input.sectionIndex + 1} of ${input.sectionCount} is given below, with the opening words of each section. Write notes about this section and anchor them only to its text.

Outline:
${input.outline.map((line, i) => `${i + 1}. ${line}`).join("\n")}

## Section ${input.sectionIndex + 1}

${input.sectionText}

${input.contextText}

## Already said in this section

The margin already has these notes here. Do not repeat one, restate its point from another angle, or anchor to the same passage. Add something only if it is new.

${said}

## Budget

This section is about ${input.wordCount} words. Aim for about ${target} new notes, and no more than ${cap}; fewer, or none, if nothing new is worth saying. Lean toward pushback, close to balance. Each note says what you noticed and why it matters here, usually two to four sentences; never a bare label, never padding. Return only the annotations: no thesis, gist, tags or reflection.`;
}
