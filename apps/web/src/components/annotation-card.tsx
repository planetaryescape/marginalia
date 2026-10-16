"use client";
import { ArrowUp, ArrowUpRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn, obsidianLink } from "@/lib/utils";
import { CompanionAnswer } from "./companion-answer";
import { CardQuote, cardIconButton, MarginCard } from "./margin-card";

export const ANNOTATION_TYPES = {
  cross_reference: {
    label: "Cross-reference",
    color: "#5b7f95",
    prompt: "Add your thoughts…",
  },
  context: { label: "Context", color: "#7a8f6f", prompt: "Add your thoughts…" },
  tension: {
    label: "Tension",
    color: "#b07050",
    prompt: "Where do you land on this?",
  },
  question: {
    label: "Question",
    color: "#8b7bb0",
    prompt: "Write your reflection…",
  },
} as const;

export interface Reflection {
  _id: string;
  contentPlain: string;
  createdAt: number;
}

function formatWhen(timestamp: number) {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year:
      new Date(timestamp).getFullYear() === new Date().getFullYear()
        ? undefined
        : "numeric",
  });
}

export interface AnnotationCardData {
  _id: string;
  type: keyof typeof ANNOTATION_TYPES;
  anchorText: string;
  content: string;
  notePath?: string;
  noteExcerpt?: string;
}

export function AnnotationCard({
  annotation,
  paragraphIndex,
  reflections,
  containerRef,
  layoutVersion,
  onClose,
  onJump,
  onReflect,
  onDeleteReflection,
  inline = false,
}: {
  annotation: AnnotationCardData;
  reflections: Reflection[];
  onReflect: (text: string) => Promise<void>;
  onDeleteReflection: (id: string) => void;
  paragraphIndex: number | null;
  containerRef: React.RefObject<HTMLElement | null>;
  layoutVersion: number;
  onClose: () => void;
  onJump: (index: number) => void;
  /** Sits in the sidenote column, which places it. */
  inline?: boolean;
}) {
  const type = ANNOTATION_TYPES[annotation.type];
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await onReflect(text);
      setDraft("");
    } finally {
      setSaving(false);
    }
  };

  const body = (
    <>
      <CardQuote>{annotation.anchorText}</CardQuote>
      <CompanionAnswer
        text={annotation.content}
        lead={false}
        streaming={false}
        onJump={onJump}
      />
      {annotation.noteExcerpt && (
        <figure className="mt-3 rounded-lg bg-[var(--reader-chip)] px-3 py-2.5">
          <blockquote className="font-serif italic text-[14px] leading-snug text-[var(--reader-fg-soft)]">
            {annotation.noteExcerpt}
          </blockquote>
          {annotation.notePath && (
            <figcaption className="mt-2">
              <a
                href={obsidianLink(annotation.notePath)}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--card-accent)] hover:underline"
              >
                {annotation.notePath.replace(/\.md$/, "").split("/").pop()}
                <ArrowUpRight size={12} />
              </a>
            </figcaption>
          )}
        </figure>
      )}
      {!annotation.noteExcerpt && annotation.notePath && (
        <a
          href={obsidianLink(annotation.notePath)}
          className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--card-accent)] hover:underline"
        >
          {annotation.notePath.replace(/\.md$/, "").split("/").pop()}
          <ArrowUpRight size={12} />
        </a>
      )}
      {reflections.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--reader-border)] space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--reader-muted)]">
            {annotation.type === "question"
              ? "Your reflection"
              : "Your thoughts"}
          </p>
          {reflections.map((reflection) => (
            <div
              key={reflection._id}
              className="group relative pl-3 border-l-2 border-[var(--card-accent)]"
            >
              <p className="font-serif text-[15px] leading-relaxed whitespace-pre-wrap text-[var(--reader-fg)]">
                {reflection.contentPlain}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[11px] text-[var(--reader-muted)]">
                  {formatWhen(reflection.createdAt)}
                </span>
                <button
                  type="button"
                  onClick={() => onDeleteReflection(reflection._id)}
                  className={cn(
                    cardIconButton,
                    "w-5 h-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                  )}
                  aria-label="Delete reflection"
                  title="Delete"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const footer = (
    <form
      className="mx-3 mb-3 mt-1 flex items-end gap-2 rounded-xl bg-[var(--reader-chip)] pl-3 pr-1 py-1 focus-within:ring-1 focus-within:ring-[var(--card-accent)]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        value={draft}
        rows={1}
        onChange={(e) => {
          setDraft(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={type.prompt}
        aria-label={type.prompt.replace("…", "")}
        className="flex-1 min-w-0 resize-none bg-transparent py-1.5 font-serif text-[15px] leading-snug outline-none placeholder:font-sans placeholder:text-[13px] placeholder:text-[var(--reader-muted)]"
      />
      <button
        type="submit"
        disabled={!draft.trim() || saving}
        aria-label="Save"
        title="Save (⌘↵)"
        className="mb-0.5 w-7 h-7 shrink-0 flex items-center justify-center rounded-lg bg-[var(--card-accent)] text-white transition-opacity disabled:opacity-30"
      >
        <ArrowUp size={14} strokeWidth={2.5} />
      </button>
    </form>
  );

  return (
    <MarginCard
      inline={inline}
      containerRef={containerRef}
      layoutVersion={layoutVersion}
      anchorKey={annotation._id}
      getAnchorRect={() =>
        containerRef.current
          ?.querySelector(
            `[data-annotation-id="${CSS.escape(annotation._id)}"]`,
          )
          ?.getBoundingClientRect() ?? null
      }
      accent={type.color}
      title={
        <>
          <span
            className="w-1.5 h-1.5 rounded-full bg-[var(--card-accent)]"
            aria-hidden
          />
          {type.label}
        </>
      }
      label={`${type.label} annotation`}
      paragraphIndex={paragraphIndex}
      onJump={onJump}
      onClose={onClose}
      body={<div className="pb-1">{body}</div>}
      footer={footer}
      scrollKey={reflections.length}
    />
  );
}
