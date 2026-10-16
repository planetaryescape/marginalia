"use client";
import {
  ArrowUp,
  BookA,
  BookOpenText,
  Check,
  Copy,
  MessageCircleQuestion,
  MessagesSquare,
  RotateCcw,
  Trash2,
  Wand2,
} from "lucide-react";
import { useState } from "react";
import type { CompanionThread } from "@/lib/companion";
import { modelName } from "@/lib/models";
import { CompanionAnswer } from "./companion-answer";
import { CardQuote, cardIconButton, MarginCard } from "./margin-card";

const MODES = {
  explain: { label: "Explain", Icon: BookOpenText },
  simplify: { label: "Simplify", Icon: Wand2 },
  define: { label: "Define", Icon: BookA },
  ask: { label: "Ask", Icon: MessageCircleQuestion },
  article: { label: "Article", Icon: MessagesSquare },
} as const;

export function CompanionCard({
  thread,
  range,
  containerRef,
  layoutVersion,
  inline = false,
  onClose,
  onDelete,
  onFollowUp,
  onRegenerate,
  onJump,
  onKeep,
  isBook = false,
}: {
  thread: CompanionThread;
  /** The passage the answer is about, for the floating card to sit beside. */
  range?: Range | null;
  containerRef: React.RefObject<HTMLElement | null>;
  layoutVersion: number;
  /** Sits in the margin column or the text flow, which place it. */
  inline?: boolean;
  /** Folds the answer back into the margin. */
  onClose: () => void;
  onDelete: () => void;
  onFollowUp: (question: string) => void;
  onRegenerate: () => void;
  onJump: (index: number) => void;
  onKeep: () => void;
  /** A question about a whole book reads as one, not as an article. */
  isBook?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const { Icon } = MODES[thread.mode];
  const label =
    thread.mode === "article" && isBook ? "Book" : MODES[thread.mode].label;
  const streaming = thread.status === "streaming";
  const kept = Boolean(thread.savedId);
  // Kept now, or saved automatically before answers became temporary
  const saved = kept || Boolean(thread.legacyId);
  const transcript = thread.turns
    .filter((t) => t.role === "assistant")
    .map((t) => t.content.trim())
    .join("\n\n");
  const textLength = thread.turns.reduce((n, t) => n + t.content.length, 0);

  const copy = async () => {
    await navigator.clipboard.writeText(transcript);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const body = (
    <>
      {thread.selection && <CardQuote>{thread.selection}</CardQuote>}

      {thread.question && (
        <p className="mb-3 text-[14px] font-medium text-[var(--reader-fg)]">
          {thread.question}
        </p>
      )}

      <div className="space-y-4">
        {thread.turns.map((turn, i) => {
          const isLast = i === thread.turns.length - 1;
          if (turn.role === "user") {
            return (
              <div
                key={i}
                className="pt-3 border-t border-[var(--reader-border)]"
              >
                <p className="text-[14px] font-medium text-[var(--reader-fg)]">
                  {turn.content}
                </p>
              </div>
            );
          }
          if (!turn.content && streaming && isLast) {
            return (
              <div
                key={i}
                className="space-y-2 py-1"
                role="status"
                aria-label="Thinking"
              >
                <div className="companion-shimmer h-3 w-[92%] rounded" />
                <div className="companion-shimmer h-3 w-[78%] rounded" />
                <div className="companion-shimmer h-3 w-[60%] rounded" />
              </div>
            );
          }
          return (
            <CompanionAnswer
              key={i}
              text={turn.content}
              lead={i === 0 || thread.turns[i - 1]?.role === "user"}
              streaming={streaming && isLast}
              onJump={onJump}
            />
          );
        })}
      </div>

      {thread.status === "error" && (
        <div className="mt-3 flex items-center gap-3 text-[13px]">
          <span className="text-annotation-tension">{thread.error}</span>
          <button
            type="button"
            onClick={onRegenerate}
            className="font-medium quiet-link"
          >
            Retry
          </button>
        </div>
      )}
    </>
  );

  const footer = (
    <>
      <div className="flex items-center gap-1 px-4 pb-2 pt-1">
        <span className="truncate font-mono text-[10px] text-[var(--reader-muted)] opacity-80">
          {thread.model ? modelName(thread.model) : "…"}
        </span>
        <div className="ml-auto flex items-center">
          <button
            type="button"
            onClick={onKeep}
            disabled={
              kept || streaming || thread.keeping || thread.status !== "done"
            }
            title={
              kept ? "Kept in your notes" : "Keep this answer in your notes"
            }
            className="mr-1 flex h-11 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-[var(--reader-fg-soft)] transition-colors hover:bg-[var(--reader-chip)] hover:text-[var(--reader-fg)] disabled:pointer-events-none disabled:opacity-60 sm:h-7"
          >
            {kept && <Check size={13} aria-hidden />}
            {kept ? "Kept" : "Keep"}
          </button>
          <button
            type="button"
            onClick={onRegenerate}
            className={cardIconButton}
            disabled={streaming}
            title="Regenerate"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            onClick={copy}
            className={cardIconButton}
            disabled={!transcript}
            title="Copy answer"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={thread.keeping}
            className={cardIconButton}
            title={saved ? "Delete the saved answer" : "Dismiss"}
            aria-label={saved ? "Delete the saved answer" : "Dismiss"}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <form
        className="focus-frame mx-3 mb-3 flex items-center gap-2 rounded-xl bg-[var(--reader-chip)] pl-3 pr-1 py-1 focus-within:ring-1 focus-within:ring-[var(--reader-focus)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (streaming || thread.keeping || !draft.trim()) return;
          onFollowUp(draft);
          setDraft("");
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask a follow-up"
          aria-label="Ask a follow-up"
          className="flex-1 min-w-0 bg-transparent text-[13px] outline-none placeholder:text-[var(--reader-muted)]"
        />
        <button
          type="submit"
          disabled={streaming || thread.keeping || !draft.trim()}
          aria-label="Send follow-up"
          className="w-7 h-7 flex items-center justify-center rounded-lg bg-[var(--ink)] text-[var(--reader-bg)] transition-opacity disabled:opacity-30"
        >
          <ArrowUp size={14} strokeWidth={2.5} />
        </button>
      </form>
    </>
  );

  return (
    <MarginCard
      inline={inline}
      containerRef={containerRef}
      layoutVersion={layoutVersion}
      anchorKey={range}
      getAnchorRect={() => range?.getBoundingClientRect() ?? null}
      title={
        <>
          <Icon size={13} strokeWidth={2.25} />
          {label}
          {kept && <span className="font-normal opacity-70">· kept</span>}
        </>
      }
      label={
        thread.mode === "article"
          ? isBook
            ? "Ask the book"
            : "Ask the article"
          : `${label} passage`
      }
      pinned={thread.mode === "article"}
      paragraphIndex={thread.paragraphIndex}
      onJump={onJump}
      onClose={onClose}
      body={body}
      footer={footer}
      scrollKey={thread.turns.length > 1 ? textLength : undefined}
    />
  );
}
