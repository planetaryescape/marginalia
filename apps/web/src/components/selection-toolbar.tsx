"use client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowUp,
  BookA,
  BookOpenText,
  Check,
  ChevronDown,
  Copy,
  Feather,
  Globe,
  Highlighter,
  MessageCircleQuestion,
  NotebookPen,
  Underline,
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
import { Keycap } from "@/components/keycap";
import { type CompanionMode, usePassageHighlight } from "@/lib/companion";
import type { MarkKind } from "@/lib/highlights";
import { type MarkColor, SWATCHES } from "@/lib/mark-colours";
import { passagePlacement } from "@/lib/passage-placement";
import type { AnswerDepth } from "@/lib/reader-settings";
import { isOnControl, useShortcuts } from "@/lib/shortcuts";
import { useAltHint } from "@/lib/use-alt-hint";
import { cn } from "@/lib/utils";

interface SelectionToolbarProps {
  containerRef: React.RefObject<HTMLElement | null>;
  getCurrentParagraphRange: () => Range | null;
  /** The passage under the j/k cursor, or null when the reader has no cursor. Enter opens the menu on it. */
  getCursorRange?: () => Range | null;
  /** Puts focus back on the j/k cursor when a menu opened from the keyboard closes. */
  restoreCursorFocus?: () => void;
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
  /** Scripture-only: resolves containing verses without sending displayed wording. */
  onDeepStudy?: (range: Range) => Promise<string | null>;
  depth: AnswerDepth;
  onDepthChange: (depth: AnswerDepth) => void;
  web: boolean;
  onWebChange: (web: boolean) => void;
  isMarked: (kind: MarkKind, range: Range) => boolean;
  onToggleMark: (kind: MarkKind, range: Range) => void;
  /** Marks the passage in this colour (or recolours the mark there) and makes it the tool's default. */
  onMarkInColor: (kind: MarkKind, range: Range, color: MarkColor) => void;
  /** The colour of the mark already on this passage, if any. */
  markedColor: (kind: MarkKind, range: Range) => MarkColor | null;
  /** Each tool's current default colour. */
  defaultColors: Record<MarkKind, MarkColor>;
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
  },
  {
    kind: "underline",
    label: "Underline",
    key: "P",
    Icon: Underline,
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
  getCursorRange,
  restoreCursorFocus,
  onAddNote,
  onCompanion,
  onDeepStudy,
  depth,
  onDepthChange,
  web,
  onWebChange,
  isMarked,
  onToggleMark,
  onMarkInColor,
  markedColor,
  defaultColors,
}: SelectionToolbarProps) {
  const reducedMotion = useReducedMotion();
  const [range, setRange] = useState<Range | null>(null);
  const [position, setPosition] = useState<ReturnType<typeof placement> | null>(
    null,
  );
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [studyError, setStudyError] = useState<string | null>(null);
  const [studying, setStudying] = useState(false);
  const studyPending = useRef(false);
  // The tool whose colour picker is open
  const [picking, setPicking] = useState<MarkKind | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<Range | null>(null);
  const frame = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionChanged = useRef(false);
  const askingRef = useRef(false);
  // Opened from the keyboard: its keys show beside the actions, and Escape
  // hands focus back to the cursor. A pointer selection keeps keys in tooltips.
  const [viaKeyboard, setViaKeyboard] = useState(false);
  const viaKeyboardRef = useRef(false);
  const setKeyboard = useCallback((on: boolean) => {
    viaKeyboardRef.current = on;
    setViaKeyboard(on);
  }, []);
  const altHint = useAltHint();
  const showKeys = viaKeyboard || altHint;
  // Asking and picking a colour both keep the toolbar open without a selection
  const holding = asking || picking !== null;
  useLayoutEffect(() => {
    askingRef.current = holding;
  }, [holding]);

  const hide = useCallback(() => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    rangeRef.current = null;
    setRange(null);
    setPosition(null);
    setAsking(false);
    setQuestion("");
    setPicking(null);
    setStudyError(null);
    viaKeyboardRef.current = false;
    setViaKeyboard(false);
  }, []);

  const scheduleMeasurement = useCallback(() => {
    if (!rangeRef.current && !selectionChanged.current) return;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (selectionChanged.current) {
        selectionChanged.current = false;
        if (!askingRef.current) {
          const selection = window.getSelection();
          if (!selection || selection.isCollapsed || !selection.rangeCount) {
            // A menu opened on the cursor has no selection to keep it open.
            if (viaKeyboardRef.current) return;
            if (hideTimer.current === null)
              hideTimer.current = setTimeout(() => {
                hideTimer.current = null;
                if (
                  !askingRef.current &&
                  window.getSelection()?.isCollapsed !== false
                )
                  hide();
              }, 200);
            return;
          }
          const current = selection.getRangeAt(0);
          if (
            !containerRef.current?.contains(current.commonAncestorContainer) ||
            selection.toString().trim().length < 2
          ) {
            hide();
            return;
          }
          const previous = rangeRef.current;
          if (
            !previous ||
            previous.startContainer !== current.startContainer ||
            previous.startOffset !== current.startOffset ||
            previous.endContainer !== current.endContainer ||
            previous.endOffset !== current.endOffset
          ) {
            const snapshot = current.cloneRange();
            rangeRef.current = snapshot;
            setRange(snapshot);
            setKeyboard(false);
          }
        }
      }
      if (!rangeRef.current) return;
      const next = placement(rangeRef.current, toolbarRef.current);
      setPosition((previous) =>
        previous &&
        previous.top === next.top &&
        previous.left === next.left &&
        previous.below === next.below &&
        previous.mobile === next.mobile
          ? previous
          : next,
      );
    });
  }, [containerRef, hide, setKeyboard]);

  useEffect(() => {
    const handleSelectionChange = () => {
      if (askingRef.current) return;
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      hideTimer.current = null;
      selectionChanged.current = true;
      scheduleMeasurement();
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    window.addEventListener("scroll", scheduleMeasurement, { passive: true });
    window.addEventListener("resize", scheduleMeasurement);
    window.visualViewport?.addEventListener("resize", scheduleMeasurement);
    window.visualViewport?.addEventListener("scroll", scheduleMeasurement);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      window.removeEventListener("scroll", scheduleMeasurement);
      window.removeEventListener("resize", scheduleMeasurement);
      window.visualViewport?.removeEventListener("resize", scheduleMeasurement);
      window.visualViewport?.removeEventListener("scroll", scheduleMeasurement);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      hideTimer.current = null;
    };
  }, [scheduleMeasurement]);
  // Re-measure when the Ask editor changes the menu's height.
  // biome-ignore lint/correctness/useExhaustiveDependencies: asking and picking change the rendered dimensions.
  useLayoutEffect(() => {
    scheduleMeasurement();
  }, [asking, picking, scheduleMeasurement]);

  // Typing a question moves focus out of the article, so keep the passage tinted
  usePassageHighlight("companion-pending", asking ? range : null);

  useEffect(() => {
    if (!holding && !viaKeyboard) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!toolbarRef.current?.contains(e.target as Node)) hide();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [holding, viaKeyboard, hide]);

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

  const pickColor = (kind: MarkKind, color: MarkColor) => {
    if (!range) return;
    onMarkInColor(kind, range, color);
    finish();
  };

  /** Opens the menu on a passage taken from the keyboard (the cursor or a selection). */
  const openOn = (target: Range, mode: "menu" | "ask") => {
    const snapshot = target.cloneRange();
    rangeRef.current = snapshot;
    setRange(snapshot);
    setKeyboard(true);
    setAsking(mode === "ask");
    scheduleMeasurement();
  };

  const closeToCursor = () => {
    const fromKeyboard = viaKeyboardRef.current;
    finish();
    if (fromKeyboard) restoreCursorFocus?.();
  };

  const selectedInArticle = () => {
    const selection = window.getSelection();
    const selected =
      selection && !selection.isCollapsed && selection.rangeCount
        ? selection.getRangeAt(0)
        : null;
    return selected &&
      containerRef.current?.contains(selected.commonAncestorContainer)
      ? selected.cloneRange()
      : null;
  };

  // Enter belongs to links, buttons, notes and anything else focusable; it
  // opens the menu only from the page itself or the cursor's own block.
  const onCursorSurface = (target: EventTarget | null) =>
    target === document.body ||
    target === document.documentElement ||
    (target instanceof HTMLElement &&
      Boolean(containerRef.current?.contains(target)) &&
      !target.closest(
        "a, button, summary, input, textarea, select, [role='button'], [contenteditable], .annotation-mark, [tabindex]:not([tabindex='-1'])",
      ));

  useShortcuts(
    {
      ...Object.fromEntries(
        Object.entries(SHORTCUTS).map(([key, action]) => [
          key,
          () => {
            // An open menu owns the keys: they act on its range, whatever is selected now.
            if (range) {
              if (action === "highlight" || action === "underline")
                toggleMark(action);
              else {
                if (action === "ask") setKeyboard(true);
                runMode(action);
              }
              return;
            }
            const target = selectedInArticle() ?? getCurrentParagraphRange();
            if (!target?.toString().trim()) return;
            if (action === "ask") {
              openOn(target, "ask");
            } else {
              if (action === "highlight" || action === "underline")
                onToggleMark(action, target);
              else onCompanion({ mode: action, range: target });
              finish();
            }
          },
        ]),
      ),
      Enter: (event) => {
        if (isOnControl(event) || !onCursorSurface(event.target)) return false;
        // Already open (a pointer selection): Enter shows its keys.
        if (range) return void setKeyboard(true);
        const target = selectedInArticle() ?? getCursorRange?.() ?? null;
        if (!target?.toString().trim()) return false;
        openOn(target, "menu");
      },
    },
    !holding,
    {
      help: {
        group: "Reading",
        keys: [
          ["Enter", "Open passage actions on the cursor or selection"],
          ["e", "Explain the selection or paragraph"],
          ["s", "Simplify it"],
          ["d", "Define a word or phrase in context"],
          ["a", "Ask about it"],
          ["h", "Highlight it"],
          ["p", "Pen-mark it"],
        ],
      },
    },
  );

  const text = range?.toString().trim() ?? "";
  const addNote = () => {
    onAddNote({ text });
    finish();
  };
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
    finish();
  };

  // Keys for the actions that have no global letter. They shadow the reader's
  // own n only while the menu is open, and j/k close it before moving the cursor.
  const menuOpen = Boolean(range) && !holding;
  useShortcuts(
    {
      n: () => addNote(),
      c: () => void copy(),
      t: () => (onDeepStudy ? void runStudy() : false),
      j: () => {
        hide();
        return false;
      },
      k: () => {
        hide();
        return false;
      },
      Escape: () => closeToCursor(),
    },
    menuOpen,
    {
      priority: true,
      help: {
        group: "Passage actions",
        keys: [
          ["n", "Add a note"],
          ["c", "Copy"],
          ...(onDeepStudy ? [["t", "Deep study"] as [string, string]] : []),
          ["Esc", "Close and return to the cursor"],
        ],
      },
    },
  );

  const submitQuestion = () => {
    if (!range || !question.trim()) return;
    onCompanion({ mode: "ask", range, question: question.trim() });
    finish();
  };
  const runStudy = async () => {
    if (!range || !onDeepStudy || studyPending.current) return;
    studyPending.current = true;
    const selected = rangeRef.current;
    setStudying(true);
    setStudyError(null);
    try {
      const error = await onDeepStudy(range.cloneRange());
      if (rangeRef.current !== selected) return;
      if (error) setStudyError(error);
      else finish();
    } catch {
      if (rangeRef.current === selected)
        setStudyError("Study could not open. Try selecting the verses again.");
    } finally {
      studyPending.current = false;
      setStudying(false);
    }
  };

  const actionClass =
    "flex items-center justify-start gap-2 h-11 md:h-8 px-3 md:px-2.5 rounded-lg md:rounded-full text-[14px] md:text-[13px] font-medium transition-colors hover:bg-[var(--reader-chip)] md:hover:bg-white/10";
  // Keys beside an icon-only button widen it past the round 2rem.
  const iconClass = cn(
    "h-11 md:h-8 px-3 flex gap-2 items-center justify-start md:justify-center rounded-lg md:rounded-full text-[14px] transition-colors hover:bg-[var(--reader-chip)] md:hover:bg-white/10",
    showKeys ? "md:w-auto md:px-2" : "md:w-8 md:px-0",
  );
  const keycap = (key: string) => (
    <Keycap force={viaKeyboard} className="opacity-70">
      {key}
    </Keycap>
  );

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
          className="passage-toolbar fixed z-50 max-w-[calc(100vw-24px)]"
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
              "passage-menu grid grid-cols-2 md:flex md:flex-wrap items-center gap-0.5 p-1.5 md:p-1 rounded-lg md:rounded-full font-sans bg-[var(--reader-surface)] text-[var(--reader-fg)] md:reader-float shadow-[0_8px_30px_-6px_rgba(0,0,0,0.3)] ring-1 ring-[var(--reader-border)]",
              holding && "block",
            )}
          >
            {picking ? (
              <ColorPicker
                kind={picking}
                selected={markedColor(picking, range) ?? defaultColors[picking]}
                onPick={(color) => pickColor(picking, color)}
                onClose={() => setPicking(null)}
              />
            ) : asking ? (
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
                    if (e.key === "Escape") closeToCursor();
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
                      ? "bg-[var(--reader-fg)] text-[var(--reader-bg)]"
                      : "opacity-60 hover:opacity-100",
                  )}
                >
                  <Globe size={12} />
                  Web
                </button>
                <div className="flex items-center rounded-full bg-white/10 p-0.5 text-[12px]">
                  {(["quick", "deep"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => onDepthChange(d)}
                      className={cn(
                        "px-2.5 h-11 md:h-6 rounded-full capitalize transition-colors",
                        depth === d
                          ? "bg-[var(--reader-fg)] text-[var(--reader-bg)]"
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
                  className="w-11 h-11 md:w-8 md:h-8 ml-auto md:ml-1 flex items-center justify-center rounded-full bg-[var(--reader-fg)] text-[var(--reader-bg)] transition-opacity disabled:opacity-40"
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
                {MARK_TOOLS.map(({ kind, label, key, Icon }) => {
                  const active = isMarked(kind, range);
                  const color = markedColor(kind, range) ?? defaultColors[kind];
                  const swatch = SWATCHES[kind].find((c) => c.id === color);
                  return (
                    <div key={kind} className="flex items-stretch">
                      <button
                        className={cn(
                          iconClass,
                          "relative flex-1",
                          active && "opacity-100 bg-white/15",
                        )}
                        title={`${active ? "Remove" : label} (${key})`}
                        aria-keyshortcuts={key.toLowerCase()}
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
                        {keycap(key)}
                        <span
                          className="absolute bottom-1.5 left-1/2 -translate-x-1/2 h-[2px] w-3 rounded-full"
                          style={{ background: swatch?.hex }}
                        />
                      </button>
                      <button
                        type="button"
                        className="flex items-center justify-center w-6 md:w-4 rounded-full opacity-60 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                        title={`${label} colour`}
                        aria-label={`${label} colour, now ${swatch?.label.toLowerCase()}`}
                        aria-haspopup="true"
                        onClick={() => setPicking(kind)}
                      >
                        <ChevronDown size={10} />
                      </button>
                    </div>
                  );
                })}
                <button
                  className={iconClass}
                  title="Add note (N)"
                  aria-label="Add note"
                  aria-keyshortcuts="n"
                  onClick={addNote}
                >
                  <NotebookPen size={14} />
                  <span className="md:hidden">Note</span>
                  {keycap("N")}
                </button>
                <hr
                  aria-orientation="vertical"
                  className="hidden md:block w-px h-4 mx-1 border-0 bg-current opacity-20"
                />
                <button
                  className={actionClass}
                  onClick={() => runMode("explain")}
                  title="Explain (E)"
                  aria-keyshortcuts="e"
                >
                  <BookOpenText size={14} />
                  Explain
                  {keycap("E")}
                </button>
                <button
                  className={actionClass}
                  onClick={() => runMode("simplify")}
                  title="Simplify (S)"
                  aria-keyshortcuts="s"
                >
                  <Feather size={14} />
                  Simplify
                  {keycap("S")}
                </button>
                <button
                  className={actionClass}
                  onClick={() => runMode("define")}
                  title="Define in context (D)"
                  aria-keyshortcuts="d"
                >
                  <BookA size={14} />
                  Define
                  {keycap("D")}
                </button>
                <button
                  className={actionClass}
                  onClick={() => runMode("ask")}
                  title="Ask (A)"
                  aria-keyshortcuts="a"
                >
                  <MessageCircleQuestion size={14} />
                  Ask
                  {keycap("A")}
                </button>
                {onDeepStudy && (
                  <button
                    type="button"
                    className={actionClass}
                    disabled={studying}
                    title="Deep study (T)"
                    aria-keyshortcuts="t"
                    onClick={() => void runStudy()}
                  >
                    <BookOpenText size={14} />
                    {studying ? "Opening…" : "Deep study"}
                    {keycap("T")}
                  </button>
                )}
                <button
                  className={iconClass}
                  title="Copy (C)"
                  aria-label="Copy"
                  aria-keyshortcuts="c"
                  onClick={() => void copy()}
                >
                  <Copy size={14} />
                  <span className="md:hidden">Copy</span>
                  {keycap("C")}
                </button>
              </>
            )}
          </motion.div>
          {studyError && (
            <p
              role="alert"
              className="mt-2 max-w-sm rounded-lg bg-[var(--reader-surface)] p-3 font-sans text-[14px] leading-relaxed text-[var(--reader-fg)] shadow-lg"
            >
              {studyError}
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Four dots for a tool. Arrow keys move between them, Enter or Space picks,
 * Escape goes back to the toolbar. The selected dot takes focus on open.
 */
function ColorPicker({
  kind,
  selected,
  onPick,
  onClose,
}: {
  kind: MarkKind;
  selected: MarkColor;
  onPick: (color: MarkColor) => void;
  onClose: () => void;
}) {
  const swatches = SWATCHES[kind];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const name = kind === "highlight" ? "Highlighter" : "Pen";

  // Focus once, when the picker opens; later selection changes must not steal it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: opens once
  useEffect(() => {
    const at = swatches.findIndex((c) => c.id === selected);
    refs.current[Math.max(at, 0)]?.focus({ preventScroll: true });
  }, []);

  const move = (from: number, step: number) =>
    refs.current[(from + step + swatches.length) % swatches.length]?.focus({
      preventScroll: true,
    });

  return (
    <div
      role="radiogroup"
      aria-label={`${name} colour`}
      className="flex items-center gap-1 px-2 h-11 md:h-8"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <span className="text-[12px] opacity-60 pr-1">{name}</span>
      {swatches.map(({ id, label, hex }, i) => (
        <button
          key={id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={id === selected}
          aria-label={label}
          title={label}
          tabIndex={id === selected ? 0 : -1}
          onClick={() => onPick(id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              move(i, 1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              move(i, -1);
            }
          }}
          className="flex items-center justify-center w-9 h-9 md:w-7 md:h-7 rounded-full transition-colors hover:bg-[var(--reader-chip)] md:hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
        >
          <span
            className="flex items-center justify-center w-5 h-5 rounded-full ring-1 ring-black/20"
            style={{ background: hex }}
          >
            {id === selected && (
              <Check size={12} strokeWidth={3} className="text-black/70" />
            )}
          </span>
        </button>
      ))}
      <button
        type="button"
        aria-label="Back to passage actions"
        onClick={onClose}
        className="ml-1 w-9 h-9 md:w-7 md:h-7 flex items-center justify-center rounded-full opacity-60 hover:opacity-100"
      >
        <X size={14} />
      </button>
    </div>
  );
}
