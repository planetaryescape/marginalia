"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";

const pendingQuestionSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  requestKey: z.string().regex(/^[\w-]{1,100}$/),
});
function clearStoredPending(
  key: string,
  submission: z.infer<typeof pendingQuestionSchema>,
  clearDraft: boolean,
) {
  try {
    const saved = pendingQuestionSchema.safeParse(
      JSON.parse(sessionStorage.getItem(`${key}:pending`) ?? "null"),
    );
    if (!saved.success || saved.data.requestKey !== submission.requestKey)
      return;
    sessionStorage.removeItem(`${key}:pending`);
    if (
      clearDraft &&
      sessionStorage.getItem(key)?.trim() === submission.question
    )
      sessionStorage.removeItem(key);
  } catch {
    /* Storage may be blocked or malformed. */
  }
}

export function ScriptureStudyFollowUps({
  runId,
  renderCitations,
}: {
  runId: Id<"scriptureStudyRuns">;
  renderCitations: (ids: string[]) => ReactNode;
}) {
  const rows = useQuery(api.scriptureStudyFollowUps.list, { runId });
  const ask = useMutation(api.scriptureStudyFollowUps.ask);
  const cancel = useMutation(api.scriptureStudyFollowUps.cancel);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const pending = useRef<{ question: string; requestKey: string } | null>(null);
  const mounted = useRef(true);
  const labelId = useId();
  const key = `marginalia:study-question:${runId}`;
  useEffect(() => {
    mounted.current = true;
    pending.current = null;
    try {
      setDraft(sessionStorage.getItem(key) ?? "");
      const raw = sessionStorage.getItem(`${key}:pending`);
      const saved = pendingQuestionSchema.safeParse(
        raw ? JSON.parse(raw) : null,
      );
      if (saved.success) pending.current = saved.data;
    } catch {
      /* Storage may be blocked. */
    }
    return () => {
      mounted.current = false;
    };
  }, [key]);
  const writeDraft = (value: string) => {
    setDraft(value);
    try {
      if (value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
    } catch {
      /* The in-memory draft remains usable. */
    }
  };
  // Reconcile an uncertain HTTP acknowledgement with the authoritative saved row.
  useEffect(() => {
    const submission = pending.current;
    const confirmed =
      submission &&
      rows?.find((row) => row.requestKey === submission.requestKey);
    if (!confirmed) return;
    pending.current = null;
    setError(null);
    const accepted =
      confirmed.status === "queued" ||
      confirmed.status === "running" ||
      confirmed.status === "complete";
    clearStoredPending(
      key,
      { question: confirmed.question, requestKey: confirmed.requestKey },
      accepted,
    );
    if (accepted)
      setDraft((current) =>
        current.trim() === confirmed.question ? "" : current,
      );
  }, [rows, key]);
  const running = rows?.find(
    (row) => row.status === "queued" || row.status === "running",
  );
  const atLimit =
    (rows?.filter((row) => row.status === "complete").length ?? 0) >= 12 ||
    (rows?.length ?? 0) >= 24;
  const submit = async () => {
    const question = draft.trim();
    if (!question || !rows || running || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    if (pending.current?.question !== question)
      pending.current = { question, requestKey: crypto.randomUUID() };
    const submission = pending.current;
    try {
      sessionStorage.setItem(`${key}:pending`, JSON.stringify(pending.current));
    } catch {
      /* In-memory idempotency still applies. */
    }
    try {
      await ask({ runId, ...submission });
      pending.current = null;
      clearStoredPending(key, submission, true);
      if (mounted.current) writeDraft("");
    } catch {
      if (
        mounted.current &&
        pending.current?.requestKey === submission.requestKey
      )
        setError(
          "The question was not confirmed. Your draft is still here; try again.",
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const stop = async () => {
    if (!running || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await cancel({ id: running.id });
    } catch {
      if (mounted.current)
        setError("The answer could not be stopped. Try Stop again.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section
      aria-labelledby={labelId}
      className="space-y-5 border-t border-[var(--reader-border)] pt-6"
    >
      <h3 id={labelId} className="text-[1.1em]">
        Ask a follow-up
      </h3>
      {rows?.map((row) => (
        <div key={row.id} className="space-y-3">
          <p className="font-sans text-[14px] font-medium whitespace-pre-wrap">
            {row.question}
          </p>
          {row.answer?.evidenceCoverage === "outside_saved_sources" && (
            <p className="font-sans text-[13px] text-[var(--ink-muted)]">
              Beyond this study’s saved sources
            </p>
          )}
          {row.answer ? (
            <p className="whitespace-pre-wrap">
              {row.answer.answer}
              {renderCitations(row.answer.evidenceIds)}
            </p>
          ) : (
            <p
              role="status"
              className="font-sans text-[14px] text-[var(--ink-muted)]"
            >
              {row.status === "queued" || row.status === "running"
                ? "Preparing an answer…"
                : row.status === "cancelled"
                  ? "Answer stopped."
                  : "This answer could not finish. You can ask the question again."}
            </p>
          )}
          {!atLimit &&
            (row.status === "failed" || row.status === "cancelled") && (
              <button
                type="button"
                disabled={busy || !!running}
                onClick={() => {
                  pending.current = null;
                  setError(null);
                  writeDraft(row.question);
                }}
                className="font-sans text-[14px] text-[var(--pencil)] underline underline-offset-4"
              >
                Ask again
              </button>
            )}
        </div>
      ))}
      {running ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void stop()}
          className="font-sans text-[14px] text-[var(--pencil)] underline underline-offset-4"
        >
          Stop answer
        </button>
      ) : null}
      {!atLimit ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="sr-only" htmlFor={`${labelId}-question`}>
            Your follow-up question
          </label>
          <textarea
            id={`${labelId}-question`}
            value={draft}
            maxLength={2000}
            rows={3}
            onChange={(event) => writeDraft(event.target.value)}
            placeholder="What would you like to understand better?"
            disabled={busy}
            className="block w-full resize-y rounded-md border border-[var(--reader-border)] bg-transparent p-3 font-sans text-[14px] leading-relaxed"
          />
          <button
            type="submit"
            disabled={busy || !!running || !rows || !draft.trim()}
            className="font-sans text-[14px] text-[var(--pencil)] underline underline-offset-4 disabled:opacity-50"
          >
            {busy ? "Sending…" : "Ask about this study"}
          </button>
        </form>
      ) : (
        <p className="font-sans text-[14px] text-[var(--ink-muted)]">
          This study has reached its follow-up limit.
        </p>
      )}
      {error && (
        <p role="alert" className="font-sans text-[14px] text-[var(--danger)]">
          {error}
        </p>
      )}
    </section>
  );
}
