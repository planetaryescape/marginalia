"use client";
import { useEffect, useRef, useState } from "react";
import { getArticleBody, getParagraphs } from "./paragraphs";
import { findOccurrenceRange, rangeContainsPoint } from "./text-range";

/** An answer with a passage in the article, kept or not. */
export interface PassageSource {
  _id: string;
  selection: string;
  paragraphIndex?: number;
  /** Which match of `selection` in its paragraph was selected. */
  occurrence?: number;
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
  isOpen = (id) => id === activeId,
  onOpen,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  threads: PassageSource[] | undefined;
  /** Paragraph tagging version: bumps whenever the article DOM changes. */
  version: number;
  activeId: string | undefined;
  /** Whether the answer with this passage id is the one open; defaults to `activeId`. */
  isOpen?: (id: string) => boolean;
  onOpen: (passage: SavedPassage) => void;
}): SavedPassage[] {
  const [passages, setPassages] = useState<SavedPassage[]>([]);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

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
        const range = findOccurrenceRange(
          body,
          doc.selection,
          preferred,
          doc.occurrence,
        );
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

    // Several answers can share a passage. Where the passage is the only
    // handle (phone and sheet layouts), each tap opens the next one, and the
    // tap after the last closes it, as one answer's second tap does
    const hitTest = (e: MouseEvent) => {
      const hits = passages.filter(
        (p) =>
          p.doc.marked && rangeContainsPoint(p.range, e.clientX, e.clientY),
      );
      const open = hits.findIndex((p) => isOpenRef.current(p.doc._id));
      return (
        hits[open === -1 ? 0 : Math.min(open + 1, hits.length - 1)] ?? null
      );
    };

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
