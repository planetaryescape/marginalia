"use client";
import { CompanionAnswer } from "./companion-answer";

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
