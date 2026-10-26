import { v } from "convex/values";

// Independent of the editor's 700ms persistence/leave-flush cadence.
export const NOTE_INDEX_DELAY_MS = 2_000;
// The provider already has a 30s deadline. This timer only recovers lost actions.
export const NOTE_INDEX_LEASE_MS = 60_000;
export const NOTE_INDEX_MAX_ATTEMPTS = 3;

/** One bounded job on the source row: deletion needs no new cleanup table. */
export const noteIndexState = v.object({
  revision: v.number(),
  input: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("ready"),
    v.literal("unavailable"),
    v.literal("failed"),
  ),
  attempt: v.number(),
  dueAt: v.optional(v.number()),
  wakeId: v.optional(v.id("_scheduled_functions")),
  leaseUntil: v.optional(v.number()),
  dispatched: v.optional(v.boolean()),
});

/** Preserve the deployed provider input, including its 8,000-character bound.
 * HTML/offset changes are not new embedding inputs; prompt/selection changes are.
 * Compare the exact bounded string rather than a collision-prone short hash. */
export function noteIndexInput(note: {
  selectedText: string;
  prompt?: string;
  contentPlain: string;
  licensedQuote?: boolean;
}) {
  if (!note.contentPlain) return "";
  return [
    note.licensedQuote ? "" : note.selectedText,
    note.prompt,
    note.contentPlain,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8000);
}

export const noteIndexFence = {
  noteId: v.id("userNotes"),
  userId: v.string(),
  revision: v.number(),
  attempt: v.number(),
};
