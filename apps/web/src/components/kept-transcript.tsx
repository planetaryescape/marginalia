"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { CompanionAnswer } from "./companion-answer";

/** Mount only when expanded: no transcript subscription exists for closed rows. */
export function LazyKeptTranscript({
  threadId,
  onJump,
}: {
  threadId: Id<"companionThreads">;
  onJump: (index: number) => void;
}) {
  const body = useQuery(api.companionThreads.getBody, { threadId });
  if (body === undefined) return <p role="status">Loading answer…</p>;
  if (body === null)
    return <p role="status">This answer is no longer available.</p>;
  return (
    <>
      {body.legacyOversized && (
        <p role="status">
          This older conversation is larger than the current save limit. The
          complete saved conversation is shown.
        </p>
      )}
      <KeptTranscript thread={body} onJump={onJump} />
    </>
  );
}

/** A kept answer's conversation: the question, each answer and each follow-up. */
export function KeptTranscript({
  thread,
  onJump,
}: {
  thread: {
    question?: string;
    turns: { role: "user" | "assistant"; content: string }[];
  };
  onJump: (index: number) => void;
}) {
  return (
    <div className="space-y-3">
      {thread.question && (
        <p className="text-[14px] font-medium text-[var(--reader-fg)]">
          {thread.question}
        </p>
      )}
      {thread.turns.map((turn, i) =>
        turn.role === "user" ? (
          <p
            key={i}
            className="border-t border-[var(--reader-border)] pt-3 text-[14px] font-medium text-[var(--reader-fg)]"
          >
            {turn.content}
          </p>
        ) : (
          <CompanionAnswer
            key={i}
            text={turn.content}
            lead={false}
            streaming={false}
            onJump={onJump}
          />
        ),
      )}
    </div>
  );
}
