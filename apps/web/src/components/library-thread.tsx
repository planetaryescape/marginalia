"use client";
import { useState } from "react";
import { CompanionAnswer } from "@/components/companion-answer";
import { CitedRows } from "@/components/library-cited";

export interface LibraryTurn {
  role: "user" | "assistant";
  content: string;
}

interface Exchange {
  question: string;
  answer: string;
}

/** Pairs each question with the answer that follows it. */
export function exchangesOf(turns: LibraryTurn[]): Exchange[] {
  const exchanges: Exchange[] = [];
  for (const turn of turns) {
    if (turn.role === "user")
      exchanges.push({ question: turn.content, answer: "" });
    else if (exchanges.length)
      exchanges[exchanges.length - 1].answer = turn.content;
  }
  return exchanges;
}

function Answer({ text, streaming }: { text: string; streaming: boolean }) {
  if (!text)
    return (
      <div
        className="pl-4 border-l-2 border-[var(--pencil-rule)] max-w-2xl space-y-2 py-1"
        role="status"
        aria-label="Looking through your library"
      >
        <div className="companion-shimmer h-3 w-[86%] rounded" />
        <div className="companion-shimmer h-3 w-[70%] rounded" />
        <div className="companion-shimmer h-3 w-[48%] rounded" />
      </div>
    );
  return (
    <div className="pl-4 border-l-2 border-[var(--pencil-rule)] max-w-2xl">
      <CompanionAnswer
        text={text}
        lead
        streaming={streaming}
        onJump={() => {}}
      />
      {!streaming && <CitedRows answer={text} />}
    </div>
  );
}

/**
 * The conversation with the librarian. Only the newest exchange is open, so
 * the shelves below don't move further down with every follow-up; earlier
 * ones fold to their question and reopen on click. Remount it (by key) when
 * a new question arrives so the earlier ones fold again.
 */
export function LibraryThread({
  turns,
  streaming,
}: {
  turns: LibraryTurn[];
  streaming: boolean;
}) {
  const exchanges = exchangesOf(turns);
  const [reopened, setReopened] = useState<ReadonlySet<number>>(new Set());
  const newest = exchanges.length - 1;
  return (
    <div className="mt-10 space-y-5">
      {exchanges.map((exchange, i) => {
        if (i === newest)
          return (
            <div key={i} className="space-y-6">
              <p className="font-serif text-[21px] leading-snug text-[var(--reader-fg)]">
                {exchange.question}
              </p>
              <Answer text={exchange.answer} streaming={streaming} />
            </div>
          );
        const open = reopened.has(i);
        return (
          <div key={i}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() =>
                setReopened((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(i)) next.add(i);
                  return next;
                })
              }
              className="flex w-full items-baseline gap-2 py-1 text-left font-serif text-[17px] leading-snug text-[var(--reader-fg-soft)] hover:text-[var(--reader-fg)]"
            >
              <span aria-hidden="true" className="text-[13px] font-sans">
                {open ? "▾" : "▸"}
              </span>
              <span className={open ? "" : "min-w-0 truncate"}>
                {exchange.question}
              </span>
            </button>
            {open && (
              <div className="mt-3">
                <Answer text={exchange.answer} streaming={false} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
