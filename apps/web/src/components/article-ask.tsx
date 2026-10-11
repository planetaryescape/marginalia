"use client";
import type { Doc } from "@marginalia/backend/convex/_generated/dataModel";
import * as Popover from "@radix-ui/react-popover";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Globe, History, MessagesSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AnswerDepth } from "@/lib/reader-settings";
import { useShortcuts } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

function when(timestamp: number) {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/**
 * A pill at the foot of the page for questions about the whole article, with
 * no passage selected. Expands into a question box; "/" opens it.
 */
export function ArticleAsk({
  hidden,
  onAsk,
  depth,
  onDepthChange,
  web,
  onWebChange,
  history,
  onOpen,
}: {
  hidden: boolean;
  onAsk: (question: string) => void;
  depth: AnswerDepth;
  onDepthChange: (depth: AnswerDepth) => void;
  web: boolean;
  onWebChange: (web: boolean) => void;
  /** Earlier whole-article conversations, newest first. */
  history: Doc<"companionThreads">[];
  onOpen: (thread: Doc<"companionThreads">) => void;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useShortcuts(
    {
      "/": () => {
        setOpen(true);
        window.setTimeout(
          () => inputRef.current?.focus({ preventScroll: true }),
          0,
        );
      },
    },
    !hidden,
  );

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      inputRef.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const submit = () => {
    if (!question.trim()) return;
    onAsk(question.trim());
    setQuestion("");
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {!hidden && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.2 }}
          // Centred by the flex container: motion's inline transform would override a translate class
          className="fixed bottom-6 inset-x-0 z-30 flex justify-center pointer-events-none"
        >
          <div className="flex items-center gap-2 pointer-events-auto">
            <motion.div
              layout
              transition={{ type: "spring", damping: 30, stiffness: 380 }}
              className="flex items-center rounded-full p-1 font-sans bg-ink-950 text-parchment-50 dark:bg-parchment-50 dark:text-ink-950 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.45)] ring-1 ring-black/5"
            >
              {open ? (
                <form
                  className="flex items-center gap-1 pl-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                  }}
                >
                  <MessagesSquare size={15} className="opacity-60 shrink-0" />
                  <input
                    ref={inputRef}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setOpen(false);
                    }}
                    placeholder="Ask about the whole article…"
                    aria-label="Ask about the whole article"
                    className="w-[min(320px,calc(100vw-250px))] ml-1.5 bg-transparent text-[14px] outline-none placeholder:opacity-50"
                  />
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onWebChange(!web)}
                    aria-pressed={web}
                    title="Let the model search the web if it helps"
                    className={cn(
                      "flex items-center gap-1 px-2 h-7 rounded-full text-[12px] transition-colors",
                      web
                        ? "bg-[var(--pen)] text-white"
                        : "opacity-60 hover:opacity-100",
                    )}
                  >
                    <Globe size={12} />
                    Web
                  </button>
                  <div className="flex items-center rounded-full bg-white/10 dark:bg-ink-950/[0.06] p-0.5 text-[12px]">
                    {(["quick", "deep"] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onDepthChange(d)}
                        className={cn(
                          "px-2.5 h-6 rounded-full capitalize transition-colors",
                          depth === d
                            ? "bg-parchment-50 text-ink-950 dark:bg-ink-950 dark:text-parchment-50"
                            : "opacity-60 hover:opacity-100",
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <button
                    type="submit"
                    disabled={!question.trim()}
                    aria-label="Send question"
                    className="w-8 h-8 ml-1 flex items-center justify-center rounded-full bg-[var(--pen)] text-white transition-opacity disabled:opacity-40"
                  >
                    <ArrowUp size={16} strokeWidth={2.5} />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="flex items-center gap-2 h-8 pl-3 pr-2 rounded-full text-[13px] font-medium"
                >
                  <MessagesSquare size={14} />
                  Ask about this article
                  <kbd className="ml-1 px-1.5 rounded border border-current/20 font-mono text-[10px] opacity-50">
                    /
                  </kbd>
                </button>
              )}
            </motion.div>

            {history.length > 0 && (
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button
                    type="button"
                    title="Earlier questions about this article"
                    aria-label="Earlier questions about this article"
                    className="relative w-10 h-10 flex items-center justify-center rounded-full font-sans bg-ink-950 text-parchment-50 dark:bg-parchment-50 dark:text-ink-950 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.45)] ring-1 ring-black/5"
                  >
                    <History size={15} />
                    <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-[var(--pen)] text-white text-[9px] font-bold flex items-center justify-center">
                      {history.length}
                    </span>
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    side="top"
                    align="end"
                    sideOffset={10}
                    collisionPadding={12}
                    className="reader-popover z-50 w-[320px] max-h-[50vh] overflow-y-auto rounded-xl p-1.5 font-sans bg-[var(--reader-surface)] text-[var(--reader-fg)] ring-1 ring-[var(--reader-border)] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45)] outline-none"
                  >
                    <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--reader-muted)]">
                      Earlier questions
                    </p>
                    {history.map((thread) => (
                      <Popover.Close asChild key={thread._id}>
                        <button
                          type="button"
                          onClick={() => onOpen(thread)}
                          className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-[var(--reader-chip)] transition-colors"
                        >
                          <span className="block text-[13px] leading-snug line-clamp-2">
                            {thread.question}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-[var(--reader-muted)]">
                            {when(thread.updatedAt)}
                            {thread.turns.length > 1 &&
                              ` · ${thread.turns.filter((t) => t.role === "user").length + 1} questions`}
                          </span>
                        </button>
                      </Popover.Close>
                    ))}
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
