"use client";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MIN_GUTTER, measureGutter } from "@/lib/margin-mode";
import { cn } from "@/lib/utils";

type Layout =
  | {
      kind: "margin";
      top: number;
      left: number;
      width: number;
      lineFrom: number;
    }
  | { kind: "pinned"; left: number; width: number }
  | { kind: "sheet" };

function computeLayout(
  container: HTMLElement,
  anchor: DOMRect | null,
  previous: Layout | null,
  pinned: boolean,
): Layout {
  const article = container.getBoundingClientRect();
  // The docked notes pane owns the right edge while it is open.
  const gutter = measureGutter(container);
  if (gutter < MIN_GUTTER) return { kind: "sheet" };
  if (pinned) {
    return {
      kind: "pinned",
      left: article.right + 8,
      width: Math.min(380, gutter - 40),
    };
  }

  // A detached anchor (article HTML re-rendered) reports an empty rect: keep the old position.
  const anchored = anchor && (anchor.width > 0 || anchor.height > 0);
  const top = anchored
    ? anchor.top + window.scrollY
    : previous?.kind === "margin"
      ? previous.top
      : window.scrollY + 120;
  return {
    kind: "margin",
    top,
    left: article.right + window.scrollX + 16,
    width: Math.min(340, gutter - 32),
    lineFrom: article.right + window.scrollX - 20,
  };
}

export const cardIconButton =
  "w-11 h-11 sm:w-7 sm:h-7 flex items-center justify-center rounded-md text-[var(--reader-muted)] hover:text-[var(--reader-fg)] hover:bg-[var(--reader-chip)] transition-colors disabled:opacity-40 disabled:pointer-events-none";

/**
 * Shell shared by every card that annotates a passage: sits in the right margin
 * level with its anchor, joined by a connector line, and falls back to a bottom
 * sheet when the margin is too narrow.
 */
export function MarginCard({
  containerRef,
  layoutVersion,
  anchorKey,
  getAnchorRect,
  accent = "var(--pencil)",
  title,
  label,
  paragraphIndex,
  onJump,
  onClose,
  body,
  footer,
  scrollKey,
  pinned = false,
  inline = false,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  /** Bump to re-measure, e.g. after text settings change. */
  layoutVersion: number;
  /** Changes when the card should re-anchor to a different passage. */
  anchorKey: unknown;
  getAnchorRect: () => DOMRect | null;
  accent?: string;
  title: ReactNode;
  label: string;
  paragraphIndex: number | null;
  onJump: (index: number) => void;
  onClose: () => void;
  body: ReactNode;
  footer?: ReactNode;
  /** When the body scrolls inside the card, it scrolls to its end whenever this changes. */
  scrollKey?: unknown;
  /** Stays fixed in the margin instead of following a passage (whole-article questions). */
  pinned?: boolean;
  /** Rendered by the caller in the margin column, which sets its position and width. */
  inline?: boolean;
}) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef(getAnchorRect);
  useLayoutEffect(() => {
    anchorRef.current = getAnchorRect;
  }, [getAnchorRect]);
  const hasLayout = inline || layout !== null;
  useEffect(() => {
    if (!hasLayout) return;
    const previous = document.activeElement;
    // Keyboard-opened cards move focus directly to their controls. Pointer
    // interactions keep the article selection and don't steal typing focus.
    if (previous instanceof HTMLElement && previous.matches(":focus-visible")) {
      cardRef.current
        ?.querySelector<HTMLElement>("button, input, textarea")
        ?.focus({ preventScroll: true });
      return () => {
        if (previous.isConnected) previous.focus({ preventScroll: true });
      };
    }
  }, [hasLayout]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `anchorKey` and `layoutVersion` ask for a re-measure
  useLayoutEffect(() => {
    if (inline) return;
    const measure = () => {
      const container = containerRef.current;
      if (container) {
        setLayout((prev) =>
          computeLayout(container, anchorRef.current(), prev, pinned),
        );
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [containerRef, anchorKey, layoutVersion, pinned, inline]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-radix-popper-content-wrapper]")) return;
      if (
        target?.closest("input, textarea") &&
        !cardRef.current?.contains(target)
      )
        return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const scrollsInside = layout !== null && layout.kind !== "margin";
  useEffect(() => {
    if (scrollsInside && scrollKey !== undefined) {
      endRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [scrollKey, scrollsInside]);

  if (!layout && !inline) return null;
  const kind = inline || !layout ? "margin" : layout.kind;

  const card = (
    <motion.div
      ref={cardRef}
      initial={{
        opacity: 0,
        x: kind === "margin" && !inline ? 10 : 0,
        y: kind === "sheet" ? 16 : 0,
      }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ type: "spring", damping: 30, stiffness: 320 }}
      role="dialog"
      aria-label={label}
      style={{ "--card-accent": accent } as React.CSSProperties}
      className={cn(
        "relative font-sans flex flex-col bg-[var(--reader-surface)] text-[var(--reader-fg)]",
        kind !== "margin" &&
          "ring-1 ring-[var(--reader-border)] shadow-[0_18px_50px_-20px_rgba(0,0,0,0.35)]",
        kind === "margin"
          ? // Raised like .reader-menu: a hairline, and a shadow only on light themes.
            "margin-card-raised rounded-[10px] border border-[var(--reader-border)]"
          : kind === "pinned"
            ? "rounded-r-xl rounded-l-[3px] border-l-2 border-l-[var(--card-accent)] max-h-[calc(100vh-96px)]"
            : "rounded-2xl border-t-2 border-t-[var(--card-accent)] max-h-[calc(var(--app-viewport-height)-6rem)]",
      )}
    >
      <div
        className={cn(
          "px-4 pt-3 pb-2",
          kind !== "margin" && "min-h-0 overflow-y-auto",
        )}
      >
        <div className="flex items-center gap-2 mb-2.5">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-[var(--card-accent)]">
            {title}
          </span>
          {paragraphIndex !== null && (
            <button
              type="button"
              onClick={() => onJump(paragraphIndex)}
              className="px-1.5 h-[18px] rounded-md font-mono text-[10px] tabular-nums bg-[var(--reader-chip)] text-[var(--reader-muted)] hover:text-[var(--card-accent)] transition-colors"
            >
              ¶{paragraphIndex + 1}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className={cn(cardIconButton, "ml-auto -mr-1.5")}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
        {body}
        <div ref={endRef} />
      </div>
      {footer}
    </motion.div>
  );

  if (inline) return card;

  if (layout?.kind === "pinned") {
    return (
      <div
        className="fixed z-30 top-[72px]"
        style={{ left: layout.left, width: layout.width }}
      >
        {card}
      </div>
    );
  }

  if (layout?.kind === "sheet") {
    return (
      <div className="fixed z-40 [html[data-notes-open]_&]:z-[55] bottom-[calc(var(--app-keyboard-inset)+env(safe-area-inset-bottom)+0.75rem)] right-3 left-3 sm:left-auto sm:right-[calc(var(--notes-inset)+0.75rem)] sm:w-[400px]">
        {card}
      </div>
    );
  }

  if (!layout) return null;

  return (
    <div
      className="absolute z-30"
      style={{ top: layout.top - 12, left: 0, width: 0 }}
    >
      {/* Connector from the text column to the card */}
      <div
        className="absolute flex items-center"
        style={
          {
            top: 21,
            left: layout.lineFrom,
            width: layout.left - layout.lineFrom,
            "--card-accent": accent,
          } as React.CSSProperties
        }
        aria-hidden
      >
        <span className="flex-1 h-[1.5px] bg-[var(--pencil)]" />
      </div>
      <div
        className="absolute"
        style={{ left: layout.left, width: layout.width }}
      >
        {card}
      </div>
    </div>
  );
}

export function CardQuote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="border-l-2 border-[var(--reader-border-strong)] pl-3 mb-3 font-serif text-[15px] leading-snug text-[var(--reader-muted)] line-clamp-3">
      {children}
    </blockquote>
  );
}
