"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type AnnotationKind, KINDS, plainNote } from "@/lib/margin-kinds";
import { getArticleBody } from "@/lib/paragraphs";

export interface UnfoldAnnotation {
  _id: string;
  type: AnnotationKind;
  content: string;
  notePath?: string;
  noteExcerpt?: string;
}

/**
 * On a phone the note opens in the text flow, directly under its paragraph.
 * The article HTML belongs to the reader package, so the note renders through
 * a portal into a host element inserted after the paragraph.
 */
export function NoteUnfold({
  containerRef,
  version,
  annotation,
  paragraph,
  sheetOpen,
  onFold,
  onOpenCard,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  /** Bumps when the article HTML is re-tagged; the host is rebuilt if the HTML was replaced. */
  version: number;
  /** The open annotation on a phone, or null. */
  annotation: UnfoldAnnotation | null;
  /** Paragraph number the note belongs to, shown as ¶N. */
  paragraph: number | null;
  /** The sheet with sources and follow-up is open over the unfold. */
  sheetOpen: boolean;
  onFold: () => void;
  onOpenCard: () => void;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  const id = annotation?._id ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` signals the article HTML was replaced
  useLayoutEffect(() => {
    const current = hostRef.current;
    const mark = id
      ? getArticleBody(containerRef.current)?.querySelector(
          `[data-annotation-id="${CSS.escape(id)}"]`,
        )
      : null;
    const block = mark?.closest<HTMLElement>("[data-para]") ?? null;
    if (
      current?.isConnected &&
      block &&
      current.previousElementSibling === block &&
      current.dataset.annotationId === id
    )
      return;
    current?.remove();
    hostRef.current = null;
    if (!id || !block) {
      setHost(null);
      return;
    }
    const el = document.createElement("div");
    el.className = "note-unfold-host";
    el.dataset.annotationId = id;
    block.after(el);
    hostRef.current = el;
    setHost(el);
  }, [containerRef, id, version]);

  useEffect(
    () => () => {
      hostRef.current?.remove();
      hostRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!id || sheetOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      if (e.target instanceof Element && e.target.closest("input, textarea"))
        return;
      onFold();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [id, sheetOpen, onFold]);

  if (!annotation || !host) return null;
  const kind = KINDS[annotation.type];
  const hasSource = Boolean(annotation.notePath || annotation.noteExcerpt);

  return createPortal(
    <div
      className="note-unfold"
      // SAFETY: custom properties are valid inline style keys; React types only know CSS properties.
      style={{ "--kind-color": kind.color } as React.CSSProperties}
    >
      <div className="sidenote-kind">
        <i className="sidenote-dot" aria-hidden="true" />
        {kind.name}
        {paragraph !== null && ` · ¶${paragraph}`}
      </div>
      <div className="note-unfold-text">{plainNote(annotation.content)}</div>
      <div className="note-unfold-actions">
        {hasSource && (
          <>
            <button type="button" onClick={onOpenCard}>
              Sources
            </button>
            <span aria-hidden="true">·</span>
          </>
        )}
        <button type="button" onClick={onOpenCard}>
          Ask a follow-up
        </button>
      </div>
    </div>,
    host,
  );
}
