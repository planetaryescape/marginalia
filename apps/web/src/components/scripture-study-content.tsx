"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Skeleton, SkeletonBar } from "./in-place";
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
    if (busy || running) return;
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
      if (mounted.current) setBusy(false);
    }
  };
  const stop = async () => {
    if (!runId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await cancel({ studyId, runId });
    } catch {
      setError("Cancellation could not be confirmed. Try Stop again.");
    } finally {
      setBusy(false);
    }
  };
  const forget = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await remove({ studyId });
      onRemoved();
    } catch {
      setError("This study could not be deleted. Try again.");
    } finally {
      setBusy(false);
    }
  };
  if (!study) return <StudySkeleton />;
  return (
    <>
      <p className="mb-6 font-sans text-[14px] leading-relaxed text-[var(--ink-muted)]">
        This study covers the containing verses, using WEB evidence. The wording
        in your displayed edition may differ; no English-to-original-word
        alignment is assumed. Saved notes from this chapter may be used as
        personal context, never as instructions or scholarly evidence.
      </p>
      {running && (
        <div className="mb-8">
          <p role="status" className="font-sans text-[14px]">
            {run.status === "queued"
              ? "Study queued."
              : "Reviewing permitted evidence and preparing findings."}{" "}
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
            ? "This study was stopped. Already submitted provider work may still incur cost."
            : run.errorCode === "model_output_limit_unavailable"
              ? "Your selected deep model cannot enforce this study's output limit. Choose a compatible API model in reading settings, then select the verses again."
              : run.errorCode === "findings_not_verified"
                ? "The study could not verify its findings after the bounded correction attempt. No unverified findings were published; any previous completed result remains below."
                : "This study could not finish. You can retry explicitly; any previous completed result remains below."}
        </p>
      )}
      {study.publishedRun &&
        (study.publishedRun.coverage.some((item) =>
          item.reviewedSourceIds.includes("aquifer-open-study-notes"),
        ) ? (
          <p className="mb-6 border-l border-[var(--pencil-rule)] pl-4 font-sans text-[13px] leading-relaxed text-[var(--ink-muted)]">
            These findings include AI-generated adaptations of Aquifer Open
            Study Notes, adapted by Mission Mutual © 2026 from Tyndale Open
            Study Notes © 2023 Tyndale House Publishers. The adapted findings
            and note excerpts are offered under{" "}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              CC BY-SA 4.0
            </a>
            . Changes include excerpting, plain-text conversion and AI analysis.
            This source license does not change the app’s license.
          </p>
        ) : null)}
      {study.publishedRun &&
        (study.publishedRun.generation?.omittedFindings ? (
          <p
            role="status"
            className="mb-5 font-sans text-[14px] leading-relaxed"
          >
            This is a partial result.{" "}
            {study.publishedRun.generation.omittedFindings} finding(s) could not
            be verified after correction and were omitted.
          </p>
        ) : null)}
      {study.publishedRun && (
        <PublishedStudy
          key={study.publishedRun.runId}
          runId={study.publishedRun.runId}
          outcome={study.publishedRun.outcome}
          onAnchor={onAnchor}
        />
      )}
      {study.publishedRun && (
        <details className="mt-8 border-t border-[var(--reader-border)] pt-5 font-sans text-[14px] leading-relaxed">
          <summary className="cursor-pointer text-[var(--pencil)]">
            Coverage and limits
          </summary>
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
            Delete this study?{" "}
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
          Reopening this saved result does not generate again. Refresh and Retry
          are new bounded requests. Deleting a study does not delete your notes
          or marks.
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
  onAnchor,
}: {
  runId: Id<"scriptureStudyRuns">;
  outcome: string | null;
  onAnchor: (verseId: string) => void;
}) {
  const result = useQuery(api.scriptureStudy.findings, {
    runId,
    paginationOpts: { cursor: null, numItems: 6 },
  });
  const keep = useMutation(api.scriptureKeeps.keep);
  if (!result) return <StudySkeleton />;
  return (
    <ScriptureStudyResult
      findings={result.page}
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
