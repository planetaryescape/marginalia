"use client";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { type AnnotationKind, KINDS, plainNote } from "@/lib/margin-kinds";
import {
  getArticleBody,
  getParagraphs,
  UI_HOST_ATTRIBUTE,
} from "@/lib/paragraphs";

export interface UnfoldAnnotation {
  _id: string;
  type: AnnotationKind;
  content: string;
  notePath?: string;
  noteExcerpt?: string;
}

/** Where on the page a note unfolds: after the paragraph, or at the top of the article. */
interface UnfoldPlace {
  block: HTMLElement | null;
  position: "after" | "before";
}

/**
 * A host element in the text flow for a note to render into through a portal.
 * The article HTML belongs to the reader package, so the host is inserted next
 * to a paragraph and rebuilt if the HTML was replaced.
 */
function useUnfoldHost(
  id: string | null,
  version: number,
  findPlace: () => UnfoldPlace,
) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` signals the article HTML was replaced; `findPlace` reads the DOM afresh each time
  useLayoutEffect(() => {
    const current = hostRef.current;
    const { block, position } = id
      ? findPlace()
      : { block: null, position: "after" as const };
    if (
      current?.isConnected &&
      block &&
      (position === "after"
        ? current.previousElementSibling
        : current.nextElementSibling) === block &&
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
    // Never numbered as a paragraph, searched, or used as an insertion anchor.
    el.setAttribute(UI_HOST_ATTRIBUTE, "");
    el.dataset.annotationId = id;
    if (position === "after") block.after(el);
    else block.before(el);
    hostRef.current = el;
    setHost(el);
  }, [id, version]);

  useEffect(
    () => () => {
      hostRef.current?.remove();
      hostRef.current = null;
    },
    [],
  );

  return host;
}

/** Escape folds the open note, unless a dialog or a text field has it. */
function useFoldOnEscape(active: boolean, onFold: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      if (e.target instanceof Element && e.target.closest("input, textarea"))
        return;
      onFold();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, onFold]);
}

/**
 * On a phone the note opens in the text flow, directly under its paragraph.
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
  const id = annotation?._id ?? null;
  const host = useUnfoldHost(id, version, () => ({
    block:
      getArticleBody(containerRef.current)
        ?.querySelector(`[data-annotation-id="${CSS.escape(id ?? "")}"]`)
        ?.closest<HTMLElement>("[data-para]") ?? null,
    position: "after",
  }));
  useFoldOnEscape(Boolean(id) && !sheetOpen, onFold);

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

/**
 * On a phone one of Marginalia's answers unfolds in the flow: under the
 * passage's paragraph, or at the top of the article for a question about the
 * whole piece. The card inside keeps its follow-up and Keep, and folds on
 * Escape itself.
 */
export function AnswerUnfold({
  containerRef,
  version,
  id,
  paragraphIndex,
  children,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  version: number;
  /** The open answer on a phone, or null. */
  id: string | null;
  /** The paragraph the answer sits under; null puts it at the top of the article. */
  paragraphIndex: number | null;
  children: ReactNode;
}) {
  const host = useUnfoldHost(id, version, () => {
    const paragraphs = getParagraphs(getArticleBody(containerRef.current));
    return paragraphIndex === null
      ? { block: paragraphs[0] ?? null, position: "before" }
      : { block: paragraphs[paragraphIndex] ?? null, position: "after" };
  });
  return host ? createPortal(children, host) : null;
}
