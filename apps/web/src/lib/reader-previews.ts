import type { api } from "@marginalia/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { SidenoteAnswer } from "@/components/sidenotes";
import { answerPreview } from "./answer-preview";
import type { CompanionThread } from "./companion";
import { answerNotes, articleHistory, MODE_LABELS } from "./margin-answers";

export type NotePreview = FunctionReturnType<
  typeof api.userNotes.listPreviews
>["page"][number];
export type ThreadPreview = FunctionReturnType<
  typeof api.companionThreads.listKeptPreviews
>["page"][number];

/** Keep the existing live-answer precedence without inventing transcript turns. */
export function answerNotesFromPreviews(
  live: CompanionThread[],
  saved: ThreadPreview[] | undefined,
): SidenoteAnswer[] {
  return [
    ...answerNotes(live, []),
    ...(saved ?? [])
      .filter(
        (doc) =>
          !live.some(
            (answer) => answer.id === doc._id || answer.savedId === doc._id,
          ),
      )
      .map((doc) => ({
        id: doc._id,
        label: `${MODE_LABELS[doc.mode]}${doc.keptAt === undefined ? "" : " · kept"}`,
        text: answerPreview(doc.preview) || "…",
        selection: doc.selection,
        paragraphIndex: doc.paragraphIndex ?? null,
      })),
  ];
}

export function articleHistoryFromPreviews(
  live: CompanionThread[],
  saved: ThreadPreview[] | undefined,
) {
  return [
    ...articleHistory(live, []),
    ...(saved ?? [])
      .filter(
        (doc) =>
          doc.mode === "article" &&
          doc.question &&
          !live.some(
            (answer) => answer.id === doc._id || answer.savedId === doc._id,
          ),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((doc) => ({
        id: doc._id,
        question: doc.question ?? "",
        when: doc.updatedAt,
        questions: doc.questionCount,
      })),
  ];
}
