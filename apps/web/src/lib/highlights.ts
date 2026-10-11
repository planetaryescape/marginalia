"use client";
import type { Doc } from "@marginalia/backend/convex/_generated/dataModel";
import { useEffect, useState } from "react";
import { getArticleBody, getParagraphs } from "./paragraphs";
import { findTextRange, normalizeText, rangeContainsPoint } from "./text-range";

export type MarkKind = Doc<"highlights">["kind"];

export interface PlacedMark {
  doc: Doc<"highlights">;
  range: Range;
}

const HIGHLIGHT_NAMES: Record<MarkKind, string> = {
  highlight: "user-highlight",
  underline: "user-underline",
};

function rangesOverlap(a: Range, b: Range) {
  return (
    a.compareBoundaryPoints(Range.END_TO_START, b) < 0 &&
    a.compareBoundaryPoints(Range.START_TO_END, b) > 0
  );
}

/** The saved mark of `kind` covering the same words as `range`, if any. */
export function findMark(marks: PlacedMark[], kind: MarkKind, range: Range) {
  const text = normalizeText(range.toString());
  return marks.find(
    (m) =>
      m.doc.kind === kind &&
      normalizeText(m.doc.text) === text &&
      rangesOverlap(m.range, range),
  );
}

/**
 * Paints highlighter and pen marks, and selects a mark when it's clicked so
 * the selection toolbar can remove it or ask about it.
 */
export function useHighlights({
  containerRef,
  docs,
  version,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  docs: Doc<"highlights">[] | undefined;
  version: number;
}): PlacedMark[] {
  const [marks, setMarks] = useState<PlacedMark[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` signals a DOM change
  useEffect(() => {
    const body = getArticleBody(containerRef.current);
    if (!body || !docs?.length) {
      setMarks([]);
      return;
    }
    const paragraphs = getParagraphs(body);
    setMarks(
      docs.flatMap((doc) => {
        const preferred =
          doc.paragraphIndex === undefined
            ? null
            : paragraphs[doc.paragraphIndex];
        const range = findTextRange(body, doc.text, preferred);
        return range ? [{ doc, range }] : [];
      }),
    );
  }, [containerRef, docs, version]);

  useEffect(() => {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    for (const kind of ["highlight", "underline"] as const) {
      const ranges = marks
        .filter((m) => m.doc.kind === kind)
        .map((m) => m.range);
      CSS.highlights.set(HIGHLIGHT_NAMES[kind], new Highlight(...ranges));
    }
    return () => {
      for (const name of Object.values(HIGHLIGHT_NAMES))
        CSS.highlights.delete(name);
    };
  }, [marks]);

  useEffect(() => {
    const article = containerRef.current;
    if (!article || !marks.length) return;
    const onClick = (e: MouseEvent) => {
      // Saved companion passages and auto annotations open their own cards
      if (e.defaultPrevented) return;
      if ((e.target as HTMLElement).closest(".annotation-mark")) return;
      const selection = window.getSelection();
      if (!selection?.isCollapsed) return;
      const hit = marks.find((m) =>
        rangeContainsPoint(m.range, e.clientX, e.clientY),
      );
      if (!hit) return;
      selection.removeAllRanges();
      selection.addRange(hit.range.cloneRange());
    };
    article.addEventListener("click", onClick);
    return () => article.removeEventListener("click", onClick);
  }, [containerRef, marks]);

  return marks;
}
