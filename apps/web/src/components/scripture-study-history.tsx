"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import type { StudySelection } from "@/lib/bible-study-selection";
import { StudySkeleton } from "./scripture-study-content";
import { studyReferenceLabel } from "./scripture-study-result";

export function ScriptureStudyHistory({
  articleId,
  onOpen,
}: {
  articleId: Id<"articles">;
  onOpen: (
    studyId: Id<"scriptureStudies">,
    selection: StudySelection,
    runId: Id<"scriptureStudyRuns"> | null,
  ) => void;
}) {
  const studies = useQuery(api.scriptureStudy.listByArticle, { articleId });
  if (!studies) return <StudySkeleton />;
  return (
    <div className="font-sans text-[15px] leading-relaxed">
      <p className="mb-6 text-[var(--ink-muted)]">
        Reopen a saved study without generating again. To study another range,
        return to the passage and select its verses.
      </p>
      {studies.length ? (
        <ul>
          {studies.map((item) => (
            <li
              key={item.studyId}
              className="border-t border-[var(--reader-border)] py-4"
            >
              <button
                type="button"
                className="min-h-11 text-left text-[var(--pencil)] underline underline-offset-4"
                onClick={() => {
                  if (item.selection.versificationId !== "web") return;
                  onOpen(
                    item.studyId,
                    { ...item.selection, versificationId: "web" },
                    item.activeRunId ?? item.publishedRunId,
                  );
                }}
              >
                {studyReferenceLabel(item.selection.referenceKey)}
              </button>
              <p className="text-[13px] text-[var(--ink-muted)]">
                {item.publishedRunId ? "Saved result" : "Previous attempt"} ·{" "}
                {new Date(item.updatedAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p>No deep studies for this reading yet.</p>
      )}
      {studies.length === 20 && (
        <p className="mt-5 text-[13px] text-[var(--ink-muted)]">
          Showing the 20 most recent studies for this reading.
        </p>
      )}
    </div>
  );
}
