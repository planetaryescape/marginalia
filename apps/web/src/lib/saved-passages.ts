"use client";
import { useEffect, useRef, useState } from "react";
import { getArticleBody, getParagraphs } from "./paragraphs";
import { findTextRange, rangeContainsPoint } from "./text-range";

/** An answer with a passage in the article, kept or not. */
export interface PassageSource {
  _id: string;
  selection: string;
  paragraphIndex?: number;
  /** Tinted in the text and opened by a click. Answers with a margin note aren't until kept. */
  marked: boolean;
}

export interface SavedPassage {
  doc: PassageSource;
  range: Range;
}

function supportsHighlights() {
  return typeof CSS !== "undefined" && "highlights" in CSS;
}

/**
 * Tints every kept answer's passage in the article, and the passage of any
 * answer that has no margin note to return to, and reopens it on click. Uses the CSS Custom Highlight API, so the
 * article DOM is never modified.
 */
export function useSavedPassages({
  containerRef,
  threads,
  version,
  activeId,
  onOpen,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  threads: PassageSource[] | undefined;
  /** Paragraph tagging version: bumps whenever the article DOM changes. */
  version: number;
  activeId: string | undefined;
  onOpen: (passage: SavedPassage) => void;
}): SavedPassage[] {
  const [passages, setPassages] = useState<SavedPassage[]>([]);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` signals a DOM change
  useEffect(() => {
    const body = getArticleBody(containerRef.current);
    if (!body || !threads?.length) {
      setPassages([]);
      return;
    }
    const paragraphs = getParagraphs(body);
    setPassages(
      threads.flatMap((doc) => {
        const preferred =
          doc.paragraphIndex === undefined
            ? null
            : paragraphs[doc.paragraphIndex];
        const range = findTextRange(body, doc.selection, preferred);
        return range ? [{ doc, range }] : [];
      }),
    );
  }, [containerRef, threads, version]);

  useEffect(() => {
    if (!supportsHighlights()) return;
    const ranges = passages
      .filter((p) => p.doc.marked && p.doc._id !== activeId)
      .map((p) => p.range);
    CSS.highlights.set("companion-saved", new Highlight(...ranges));
    return () => {
      CSS.highlights.delete("companion-saved");
    };
  }, [passages, activeId]);

  useEffect(() => {
    const article = containerRef.current;
    if (!article || !passages.length) return;

    // A paragraph lookup bounds hover work without changing the ordered click path.
    const byParagraph = new Map<Element, SavedPassage[]>();
    const paragraphs = getParagraphs(getArticleBody(article));
    const indices = new Map(
      paragraphs.map((paragraph, index) => [paragraph, index]),
    );
    const paragraphOf = (node: Node) =>
      (node instanceof Element
        ? node
        : node.parentElement
      )?.closest<HTMLElement>("[data-para]");
    for (const passage of passages) {
      if (!passage.doc.marked) continue;
      const start = paragraphOf(passage.range.startContainer);
      const end = paragraphOf(passage.range.endContainer);
      const first = start ? indices.get(start) : undefined;
      const last = end ? indices.get(end) : undefined;
      const candidates =
        first !== undefined && last !== undefined
          ? paragraphs.slice(first, last + 1)
          : paragraphs;
      for (const paragraph of candidates) {
        if (!passage.range.intersectsNode(paragraph)) continue;
        const list = byParagraph.get(paragraph) ?? [];
        list.push(passage);
        byParagraph.set(paragraph, list);
      }
    }

    const hitTest = (e: MouseEvent) =>
      passages.find(
        (p) =>
          p.doc.marked && rangeContainsPoint(p.range, e.clientX, e.clientY),
      ) ?? null;

    const onClick = (e: MouseEvent) => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      const hit = hitTest(e);
      if (!hit) return;
      // Takes priority over an annotation mark or highlight under the same words
      e.stopPropagation();
      e.preventDefault();
      onOpenRef.current(hit);
    };

    let frame = 0;
    let hovered: SavedPassage | null = null;
    const showHover = (hit: SavedPassage | null) => {
      if (hit === hovered) return;
      hovered = hit;
      article.style.cursor = hit ? "pointer" : "";
      if (!supportsHighlights()) return;
      if (hit)
        CSS.highlights.set("companion-saved-hover", new Highlight(hit.range));
      else CSS.highlights.delete("companion-saved-hover");
    };
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(frame);
      if (e.buttons || !window.getSelection()?.isCollapsed) {
        showHover(null);
        return;
      }
      const paragraph =
        e.target instanceof Element ? e.target.closest("[data-para]") : null;
      frame = requestAnimationFrame(() => {
        const candidates = paragraph ? (byParagraph.get(paragraph) ?? []) : [];
        showHover(
          candidates.find((p) =>
            rangeContainsPoint(p.range, e.clientX, e.clientY),
          ) ?? null,
        );
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(frame);
      showHover(null);
    };

    article.addEventListener("click", onClick);
    article.addEventListener("mousemove", onMove);
    article.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      article.removeEventListener("click", onClick);
      article.removeEventListener("mousemove", onMove);
      article.removeEventListener("mouseleave", onLeave);
      article.style.cursor = "";
      if (supportsHighlights()) CSS.highlights.delete("companion-saved-hover");
    };
  }, [containerRef, passages]);

  return passages;
}
