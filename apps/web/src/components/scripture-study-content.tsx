"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import type { StudyTeaching } from "@marginalia/backend/scripture-study";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Skeleton, SkeletonBar } from "./in-place";
import { ScriptureStudyFollowUps } from "./scripture-study-follow-ups";
import {
  ScriptureStudyEvidence,
  ScriptureStudyResult,
  studyReferenceLabel,
} from "./scripture-study-result";

export function ScriptureStudyContent({
  studyId,
  onAnchor,
  onRun,
  onRemoved,
}: {
  studyId: Id<"scriptureStudies">;
  onAnchor: (verseId: string) => void;
  onRun: (target: {
    studyId: Id<"scriptureStudies">;
    runId: Id<"scriptureStudyRuns">;
  }) => void;
  onRemoved: () => void;
}) {
  const study = useQuery(api.scriptureStudy.get, { studyId });
  const refresh = useMutation(api.scriptureStudy.refresh);
  const cancel = useMutation(api.scriptureStudy.cancel);
  const remove = useMutation(api.scriptureStudy.remove);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const mounted = useRef(true);
  const operation = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = study?.activeRun;
  const runId = run?.runId;
  useEffect(() => {
    if (runId) onRun({ studyId, runId });
  }, [onRun, runId, studyId]);
  const running = run?.status === "running" || run?.status === "queued";
  const replace = async () => {
    if (operation.current || running) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    try {
      const admitted = await refresh({
        studyId,
        publishedRunId: study?.publishedRun?.runId,
        requestKey: crypto.randomUUID(),
      });
      if (!mounted.current) {
        await cancel({ studyId, runId: admitted.runId });
        return;
      }
      onRun({ studyId, runId: admitted.runId });
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The study could not start. Try again.",
        );
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const stop = async () => {
    if (!runId || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    try {
      await cancel({ studyId, runId });
    } catch {
      if (mounted.current)
        setError("Cancellation could not be confirmed. Try Stop again.");
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const forget = async () => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    try {
      await remove({ studyId });
      if (mounted.current) onRemoved();
    } catch {
      if (mounted.current)
        setError("This study could not be deleted. Try again.");
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  if (!study) return <StudySkeleton />;
  return (
    <>
      {running && (
        <div className="mb-8">
          <p role="status" className="font-sans text-[14px]">
            {run.status === "queued"
              ? "Study queued."
              : "Preparing your study."}{" "}
            You can keep reading.
          </p>
          <button
            type="button"
            onClick={() => void stop()}
            disabled={busy}
            className="mt-2 font-sans text-[14px] underline underline-offset-4"
          >
            Stop study
          </button>
          {study.publishedRun ? (
            <p className="mt-3 font-sans text-[14px] text-[var(--ink-muted)]">
              Your previous result stays below until a replacement succeeds.
            </p>
          ) : (
            <StudySkeleton />
          )}
        </div>
      )}
      {run && (run.status === "failed" || run.status === "cancelled") && (
        <p role="status" className="mb-5 font-sans text-[14px] leading-relaxed">
          {run.status === "cancelled"
            ? "Study stopped."
            : run.errorCode === "model_output_limit_unavailable"
              ? "Your selected deep model cannot enforce this study's output limit. Choose a compatible API model in reading settings, then select the verses again."
              : run.errorCode === "findings_not_verified"
                ? "We couldn’t verify this study. You can try again."
                : "This study could not finish. You can try again."}
          {run.status === "failed" &&
            study.publishedRun &&
            " Your previous study is still available below."}
        </p>
      )}
      {study.publishedRun &&
        (study.publishedRun.generation?.omittedFindings ||
        study.publishedRun.teachingState === "omitted" ? (
          <p
            role="status"
            className="mb-5 font-sans text-[14px] leading-relaxed"
          >
            {study.publishedRun.generation?.omittedFindings
              ? study.publishedRun.generation.omittedFindings === 1
                ? "One finding was left out because it could not be verified."
                : `${study.publishedRun.generation.omittedFindings} findings were left out because they could not be verified.`
              : "The connected teaching could not be verified."}
            {study.publishedRun.teachingState === "omitted" &&
              " Only the verified observations are shown; the connected teaching was withheld."}
          </p>
        ) : null)}
      {study.publishedRun && (
        <PublishedStudy
          key={study.publishedRun.runId}
          runId={study.publishedRun.runId}
          outcome={study.publishedRun.outcome}
          teaching={study.publishedRun.teaching}
          sources={study.publishedRun.sources}
          onAnchor={onAnchor}
        />
      )}
      {study.publishedRun && (
        <details className="mt-8 border-t border-[var(--reader-border)] pt-5 font-sans text-[14px] leading-relaxed">
          <summary className="cursor-pointer text-[var(--pencil)]">
            Coverage and limits
          </summary>
          {study.publishedRun.coverage.some((item) =>
            item.reviewedSourceIds.includes("aquifer-open-study-notes"),
          ) && (
            <p className="mt-4 border-l border-[var(--pencil-rule)] pl-4 text-[13px] text-[var(--ink-muted)]">
              This study includes AI-generated adaptations of Aquifer Open Study
              Notes, adapted by Mission Mutual © 2026 from Tyndale Open Study
              Notes © 2023 Tyndale House Publishers. Study commentary, follow-up
              answers and note excerpts based on this source are offered under{" "}
              <a
                href="https://creativecommons.org/licenses/by-sa/4.0/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                CC BY-SA 4.0
              </a>
              . Changes include excerpting, plain-text conversion and AI
              analysis. This source license does not change the app’s license.
            </p>
          )}
          {study.publishedRun.contextSummary && (
            <div className="mt-4 space-y-2">
              <p>
                Chapter context:{" "}
                {study.publishedRun.contextSummary.chapterCoverage ===
                "full_retrieved_chapter"
                  ? "full retrieved WEB chapter"
                  : "bounded WEB context; not the full chapter"}
                .
              </p>
              <p>
                Supplied ranges:{" "}
                {study.publishedRun.contextSummary.chapterRanges
                  .map(studyReferenceLabel)
                  .join(", ")}
                .
              </p>
              <p>
                {study.publishedRun.contextSummary.readerNoteCount} saved reader
                note(s) used as personal context at the start of this run, not
                as evidence or instructions. Note text is not stored in the
                evidence manifest.
              </p>
              {study.publishedRun.contextSummary.notesLimited && (
                <p>
                  Some note context was shortened or omitted because of scope or
                  input limits.
                </p>
              )}
            </div>
          )}
          {study.publishedRun.generation && (
            <p className="mt-4">
              {study.publishedRun.generation.modelAttempts} model attempt(s),
              including any structure or finding corrections.
            </p>
          )}
          <ul className="mt-4 space-y-4">
            {study.publishedRun.coverage.map((coverage) => (
              <li key={coverage.lens}>
                <p>
                  {coverage.lens.replaceAll("_", " ")} ·{" "}
                  {coverage.status.replaceAll("_", " ")}
                </p>
                <p className="text-[var(--ink-muted)]">{coverage.reason}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 break-words text-[12px] text-[var(--ink-muted)]">
            Model: {study.publishedRun.modelId ?? "Unavailable"}. Evidence
            manifest: {study.publishedRun.evidenceSetHash ?? "Unavailable"}.
          </p>
        </details>
      )}
      <div className="mt-8 border-t border-[var(--reader-border)] pt-5 font-sans text-[14px]">
        {!running && (
          <button
            type="button"
            onClick={() => void replace()}
            disabled={busy}
            className="mr-5 text-[var(--pencil)] underline underline-offset-4"
          >
            {busy
              ? "Starting…"
              : study.publishedRun
                ? "Refresh study"
                : "Retry study"}
          </button>
        )}
        {confirmRemove ? (
          <span>
            Delete this study? Your notes and marks will stay.{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => void forget()}
              className="mx-2 text-[var(--danger)] underline"
            >
              Delete
            </button>
            <button type="button" onClick={() => setConfirmRemove(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className="text-[var(--ink-muted)] underline underline-offset-4"
          >
            Delete study
          </button>
        )}
        <p className="mt-3 text-[12px] leading-relaxed text-[var(--ink-muted)]">
          <a
            href="/help/deep-study"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            How Deep study works
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
        {error && (
          <p role="alert" className="mt-3 text-[var(--danger)]">
            {error}
          </p>
        )}
      </div>
    </>
  );
}

function PublishedStudy({
  runId,
  outcome,
  teaching,
  sources,
  onAnchor,
}: {
  runId: Id<"scriptureStudyRuns">;
  outcome: string | null;
  teaching?: StudyTeaching | null;
  sources?: { evidenceId: string; title: string; referenceKey: string }[];
  onAnchor: (verseId: string) => void;
}) {
  const result = useQuery(api.scriptureStudy.findings, {
    runId,
    paginationOpts: { cursor: null, numItems: 6 },
  });
  const followUpSources = useQuery(api.scriptureStudyFollowUps.sources, {
    runId,
  });
  const keep = useMutation(api.scriptureKeeps.keep);
  if (!result) return <StudySkeleton />;
  return (
    <ScriptureStudyResult
      findings={result.page}
      teaching={teaching}
      sources={[
        ...(sources ?? []),
        ...(followUpSources ?? []).map((item) => ({
          evidenceId: item.evidenceId,
          title: item.source.title,
          referenceKey: item.referenceKey,
        })),
      ]}
      renderFollowUps={(citations) => (
        <ScriptureStudyFollowUps runId={runId} renderCitations={citations} />
      )}
      outcome={outcome}
      onAnchor={onAnchor}
      renderEvidence={(evidenceId) => (
        <SavedStudyEvidence runId={runId} evidenceId={evidenceId} />
      )}
      onKeep={async (findingId, referenceKey) => {
        await keep({ runId, findingId, referenceKey });
      }}
    />
  );
}

function SavedStudyEvidence({
  runId,
  evidenceId,
}: {
  runId: Id<"scriptureStudyRuns">;
  evidenceId: string;
}) {
  const evidence = useQuery(api.scriptureStudy.evidence, { runId, evidenceId });
  return <ScriptureStudyEvidence evidence={evidence} />;
}

export function StudySkeleton() {
  return (
    <Skeleton label="Preparing study" className="mt-6 space-y-5">
      <SkeletonBar className="h-4 w-1/3" />
      <SkeletonBar className="h-6 w-11/12" />
      <SkeletonBar className="h-6 w-full" />
      <SkeletonBar className="h-6 w-4/5" />
    </Skeleton>
  );
}
