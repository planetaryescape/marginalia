"use client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowUp,
  BookA,
  BookOpenText,
  Copy,
  Globe,
  Highlighter,
  MessageCircleQuestion,
  NotebookPen,
  Underline,
  Wand2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { type CompanionMode, usePassageHighlight } from "@/lib/companion";
import type { MarkKind } from "@/lib/highlights";
import { passagePlacement } from "@/lib/passage-placement";
import type { AnswerDepth } from "@/lib/reader-settings";
import { isTypingTarget, useShortcuts } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

interface SelectionToolbarProps {
  containerRef: React.RefObject<HTMLElement | null>;
  getCurrentParagraphRange: () => Range | null;
  onAddNote: (selection: {
    text: string;
    startOffset?: number;
    endOffset?: number;
  }) => void;
  onCompanion: (args: {
    mode: CompanionMode;
    range: Range;
    question?: string;
  }) => void;
  depth: AnswerDepth;
  onDepthChange: (depth: AnswerDepth) => void;
  web: boolean;
  onWebChange: (web: boolean) => void;
  isMarked: (kind: MarkKind, range: Range) => boolean;
  onToggleMark: (kind: MarkKind, range: Range) => void;
}

const SHORTCUTS: Record<string, CompanionMode | MarkKind> = {
  a: "ask",
  e: "explain",
  s: "simplify",
  d: "define",
  h: "highlight",
  p: "underline",
};

const MARK_TOOLS = [
  {
    kind: "highlight",
    label: "Highlight",
    key: "H",
    Icon: Highlighter,
    swatch: "var(--highlighter)",
  },
  {
    kind: "underline",
    label: "Underline",
    key: "P",
    Icon: Underline,
    swatch: "var(--pen)",
  },
] as const;

function placement(range: Range, menu?: HTMLElement | null) {
  const rect = range.getBoundingClientRect();
  if (window.innerWidth < 768) {
    const v = window.visualViewport;
    return passagePlacement(
      rect,
      {
        width: v?.width ?? innerWidth,
        height: v?.height ?? innerHeight,
        top: v?.offsetTop ?? 0,
      },
      { width: 276, height: menu?.offsetHeight || 192 },
    );
  }
  const centre = rect.left + rect.width / 2;
  const half = Math.min(270, window.innerWidth / 2 - 12);
  const below = rect.top < 120;
  return {
    top: below ? rect.bottom + 10 : rect.top - 10,
    left: Math.min(Math.max(centre, half + 12), window.innerWidth - half - 12),
    below,
    mobile: false,
  };
}

export function SelectionToolbar({
  containerRef,
  getCurrentParagraphRange,
  onAddNote,
  onCompanion,
  depth,
  onDepthChange,
  web,
  onWebChange,
  isMarked,
  onToggleMark,
}: SelectionToolbarProps) {
  const reducedMotion = useReducedMotion();
  const [range, setRange] = useState<Range | null>(null);
  const [position, setPosition] = useState<ReturnType<typeof placement> | null>(
    null,
  );
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const toolbarRef = useRef<HTMLDivElement>(null);
  const askingRef = useRef(false);
  useLayoutEffect(() => {
    askingRef.current = asking;
  }, [asking]);

  const hide = useCallback(() => {
    setRange(null);
    setPosition(null);
    setAsking(false);
    setQuestion("");
  }, []);

  const handleSelectionChange = useCallback(() => {
    if (askingRef.current) return;
    const selection = window.getSelection();
    if (
      !selection ||
      selection.isCollapsed ||
      !selection.rangeCount ||
      !containerRef.current
    ) {
      // Small delay before hiding — avoids flicker when clicking the toolbar
      setTimeout(() => {
        const sel = window.getSelection();
        if (!askingRef.current && (!sel || sel.isCollapsed)) hide();
      }, 200);
      return;
    }

    const current = selection.getRangeAt(0);
    if (
      !containerRef.current.contains(current.commonAncestorContainer) ||
      selection.toString().trim().length < 2
    ) {
      hide();
      return;
    }

    const snapshot = current.cloneRange();
    setRange(snapshot);
    setPosition(placement(snapshot));
  }, [containerRef, hide]);

  useEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelectionChange);
  }, [handleSelectionChange]);

  useEffect(() => {
    const preventDuplicateMenu = (event: MouseEvent) => {
      if (!window.matchMedia("(pointer: coarse)").matches) return;
      if (isTypingTarget(event.target)) return;
      const body = containerRef.current?.querySelector("[data-article-body]");
      const selection = window.getSelection();
      if (
        event.target instanceof Node &&
        body?.contains(event.target) &&
        selection &&
        !selection.isCollapsed &&
        selection.rangeCount &&
        selection.toString().trim().length >= 2 &&
        body.contains(selection.getRangeAt(0).commonAncestorContainer)
      )
        event.preventDefault();
    };
    document.addEventListener("contextmenu", preventDuplicateMenu);
    return () =>
      document.removeEventListener("contextmenu", preventDuplicateMenu);
  }, [containerRef]);

  // Follow the passage while the page scrolls
  useEffect(() => {
    if (!range) return;
    const reposition = () => setPosition(placement(range, toolbarRef.current));
    window.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      window.removeEventListener("scroll", reposition);
      window.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [range]);
  // Re-measure when the Ask editor changes the menu's height.
  // biome-ignore lint/correctness/useExhaustiveDependencies: asking changes the rendered dimensions.
  useLayoutEffect(() => {
    if (range) setPosition(placement(range, toolbarRef.current));
  }, [range, asking]);

  // Typing a question moves focus out of the article, so keep the passage tinted
  usePassageHighlight("companion-pending", asking ? range : null);

  useEffect(() => {
    if (!asking) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!toolbarRef.current?.contains(e.target as Node)) hide();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [asking, hide]);

  const finish = () => {
    window.getSelection()?.removeAllRanges();
    hide();
  };

  const runMode = useCallback(
    (mode: CompanionMode) => {
      if (!range) return;
      if (mode === "ask") {
        setAsking(true);
        return;
      }
      onCompanion({ mode, range });
      window.getSelection()?.removeAllRanges();
      hide();
    },
    [range, onCompanion, hide],
  );

  const toggleMark = useCallback(
    (kind: MarkKind) => {
      if (!range) return;
      onToggleMark(kind, range);
      window.getSelection()?.removeAllRanges();
      hide();
    },
    [range, onToggleMark, hide],
  );

  useShortcuts(
    Object.fromEntries(
      Object.entries(SHORTCUTS).map(([key, action]) => [
        key,
        () => {
          const selection = window.getSelection();
          const selected =
            selection && !selection.isCollapsed && selection.rangeCount
              ? selection.getRangeAt(0)
              : null;
          const target =
            selected &&
            containerRef.current?.contains(selected.commonAncestorContainer)
              ? selected.cloneRange()
              : getCurrentParagraphRange();
          if (!target?.toString().trim()) return;
          if (action === "ask") {
            setRange(target);
            setPosition(placement(target));
            setAsking(true);
          } else {
            if (action === "highlight" || action === "underline")
              onToggleMark(action, target);
            else onCompanion({ mode: action, range: target });
            finish();
          }
        },
      ]),
    ),
    !asking,
  );

  useShortcuts({ Escape: () => finish() }, Boolean(range) && !asking);

  const submitQuestion = () => {
    if (!range || !question.trim()) return;
    onCompanion({ mode: "ask", range, question: question.trim() });
    finish();
  };

  const text = range?.toString().trim() ?? "";

  const actionClass =
    "flex items-center justify-start gap-2 h-11 md:h-8 px-3 md:px-2.5 rounded-lg md:rounded-full text-[14px] md:text-[13px] font-medium transition-colors hover:bg-[var(--reader-chip)] md:hover:bg-white/10 dark:md:hover:bg-ink-950/[0.07]";
  const iconClass =
    "h-11 md:w-8 md:h-8 px-3 md:px-0 flex gap-2 items-center justify-start md:justify-center rounded-lg md:rounded-full text-[14px] transition-colors hover:bg-[var(--reader-chip)] md:hover:bg-white/10 dark:md:hover:bg-ink-950/[0.07]";

  return (
    <AnimatePresence>
      {position && range && (
        <motion.div
          ref={toolbarRef}
          initial={
            reducedMotion
              ? false
              : { opacity: 0, y: position.below ? -4 : 4, scale: 0.98 }
          }
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={
            reducedMotion
              ? { opacity: 0 }
              : { opacity: 0, y: position.below ? -4 : 4, scale: 0.98 }
          }
          transition={{ duration: reducedMotion ? 0 : 0.14, ease: "easeOut" }}
          className="passage-toolbar fixed z-50"
          role="toolbar"
          aria-label="Passage actions"
          style={{
            top: position.top,
            left: position.left,
            x: "-50%",
            translateY: position.mobile || position.below ? "0%" : "-100%",
          }}
          onMouseDown={(e) => {
            // Keep the article selection alive, except when typing a question
            if (!(e.target as HTMLElement).closest("input")) e.preventDefault();
          }}
        >
          <motion.div
            layout={!reducedMotion}
            // Measure only when the Ask editor opens or closes. Measuring on
            // every render (each keystroke) restarted the animation from the
            // parent's translateY(-100%) offset and made the menu jump.
            layoutDependency={asking}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { type: "spring", damping: 30, stiffness: 420 }
            }
            className={cn(
              "passage-menu grid grid-cols-2 md:flex md:flex-nowrap items-center gap-0.5 p-1.5 md:p-1 rounded-2xl md:rounded-full font-sans bg-[var(--reader-surface)] text-[var(--reader-fg)] md:bg-ink-950 md:text-parchment-50 dark:md:bg-parchment-50 dark:md:text-ink-950 shadow-[0_8px_30px_-6px_rgba(0,0,0,0.3)] ring-1 ring-[var(--reader-border)]",
              asking && "block",
            )}
          >
            {asking ? (
              <form
                className="flex flex-wrap md:flex-nowrap items-center gap-1 px-2 md:pl-3 md:pr-0 w-full md:w-auto"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitQuestion();
                }}
              >
                <input
                  ref={(el) => el?.focus({ preventScroll: true })}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") hide();
                  }}
                  placeholder="Ask about this passage…"
                  aria-label="Ask about this passage"
                  className="w-full md:w-[min(260px,50vw)] h-11 md:h-auto bg-transparent text-[16px] md:text-[14px] outline-none placeholder:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => onWebChange(!web)}
                  aria-pressed={web}
                  title="Let the model search the web if it helps"
                  className={cn(
                    "flex items-center gap-1 px-2 h-11 md:h-7 rounded-full text-[12px] transition-colors",
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
                      onClick={() => onDepthChange(d)}
                      className={cn(
                        "px-2.5 h-11 md:h-6 rounded-full capitalize transition-colors",
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
                  className="w-11 h-11 md:w-8 md:h-8 ml-auto md:ml-1 flex items-center justify-center rounded-full bg-[var(--pen)] text-white transition-opacity disabled:opacity-40"
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  aria-label="Close passage question"
                  onClick={finish}
                  className="md:hidden w-11 h-11 shrink-0 flex items-center justify-center rounded-full opacity-70 hover:opacity-100"
                >
                  <X size={16} />
                </button>
              </form>
            ) : (
              <>
                <button
                  className={actionClass}
                  onClick={() => runMode("ask")}
                  title="Ask (A)"
                >
                  <MessageCircleQuestion size={14} />
                  Ask
                </button>
                <button
                  className={actionClass}
                  onClick={() => runMode("explain")}
                  title="Explain (E)"
                >
                  <BookOpenText size={14} />
                  Explain
                </button>
                <button
                  className={actionClass}
                  onClick={() => runMode("simplify")}
                  title="Simplify (S)"
                >
                  <Wand2 size={14} />
                  Simplify
                </button>
                <button
                  className={actionClass}
                  onClick={() => runMode("define")}
                  title="Define in context (D)"
                  aria-keyshortcuts="d"
                >
                  <BookA size={14} />
                  Define
                </button>
                <span className="hidden md:block w-px h-4 mx-1 bg-current opacity-20" />
                {MARK_TOOLS.map(({ kind, label, key, Icon, swatch }) => {
                  const active = isMarked(kind, range);
                  return (
                    <button
                      key={kind}
                      className={cn(
                        iconClass,
                        "relative",
                        active && "opacity-100 bg-white/15 dark:bg-ink-950/10",
                      )}
                      title={`${active ? "Remove" : label} (${key})`}
                      aria-label={
                        active ? `Remove ${label.toLowerCase()}` : label
                      }
                      aria-pressed={active}
                      onClick={() => toggleMark(kind)}
                    >
                      <Icon size={14} />
                      <span className="md:hidden">
                        {active ? "Remove mark" : label}
                      </span>
                      <span
                        className="absolute bottom-1.5 left-1/2 -translate-x-1/2 h-[2px] w-3 rounded-full"
                        style={{ background: swatch }}
                      />
                    </button>
                  );
                })}
                <button
                  className={iconClass}
                  title="Add note"
                  aria-label="Add note"
                  onClick={() => {
                    onAddNote({ text });
                    finish();
                  }}
                >
                  <NotebookPen size={14} />
                  <span className="md:hidden">Note</span>
                </button>
                <button
                  className={iconClass}
                  title="Copy"
                  aria-label="Copy"
                  onClick={async () => {
                    await navigator.clipboard.writeText(text);
                    toast.success("Copied");
                    finish();
                  }}
                >
                  <Copy size={14} />
                  <span className="md:hidden">Copy</span>
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
