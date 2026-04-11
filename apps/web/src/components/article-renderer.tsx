"use client";
import DOMPurify from "isomorphic-dompurify";
import { useMutation } from "convex/react";
import { useMemo, useState, useCallback } from "react";
import { api } from "@marginalia/backend/convex/_generated/api";
import { AnnotationPopover } from "./annotation-popover";

interface Annotation {
  _id: string;
  type: "cross_reference" | "context" | "tension" | "question";
  anchorText: string;
  anchorStartOffset: number;
  anchorEndOffset: number;
  content: string;
  notePath?: string;
  noteExcerpt?: string;
  relevanceScore: number;
}

interface ArticleRendererProps {
  content: string;
  contentHtml: string;
  annotations: Annotation[];
  onAnnotationOpen?: (annotationId: string) => void;
}

const ANNOTATION_COLORS: Record<string, string> = {
  cross_reference: "#5b7f95",
  context: "#7a8f6f",
  tension: "#b07050",
  question: "#8b7bb0",
};

/**
 * Inject annotation markers into sanitized HTML content.
 * Finds anchorText in the HTML, wraps matches with <mark> elements.
 */
function injectAnnotations(
  html: string,
  plainText: string,
  annotations: Annotation[],
): string {
  if (annotations.length === 0) return html;

  // Sort by start offset descending so injecting from end to start
  // doesn't mess up earlier offsets
  const sorted = [...annotations]
    .filter((a) => plainText.includes(a.anchorText))
    .sort((a, b) => b.anchorStartOffset - a.anchorStartOffset);

  let result = html;

  for (const ann of sorted) {
    const escaped = ann.anchorText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Allow HTML tags interleaved in the text
    const flexiblePattern = escaped.replace(/\s+/g, "(?:\\s|<[^>]*>)*");

    const regex = new RegExp(flexiblePattern, "i");
    const match = result.match(regex);

    if (match && match.index !== undefined) {
      const color = ANNOTATION_COLORS[ann.type] || "#5b7f95";
      const idx = annotations.indexOf(ann) + 1;
      const before = result.slice(0, match.index);
      const after = result.slice(match.index + match[0].length);
      const marker =
        `<mark class="annotation-mark" data-annotation-id="${ann._id}" data-type="${ann.type}">` +
        `${match[0]}<sup style="font-size: 0.6em; font-family: system-ui, sans-serif; font-weight: 700; color: ${color}; margin-left: 3px; user-select: none;">${idx}</sup></mark>`;
      result = before + marker + after;
    }
  }

  return result;
}

export function ArticleRenderer({
  content,
  contentHtml,
  annotations,
  onAnnotationOpen,
}: ArticleRendererProps) {
  const [activeAnnotation, setActiveAnnotation] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const markViewed = useMutation(api.annotations.markViewed);

  // Sanitize HTML then inject annotation markers
  const annotatedHtml = useMemo(() => {
    const sanitized = DOMPurify.sanitize(contentHtml || content, {
      ADD_TAGS: ["mark", "sup"],
      ADD_ATTR: [
        "data-annotation-id",
        "data-type",
        "style",
        "class",
        "target",
      ],
    });
    return injectAnnotations(sanitized, content, annotations);
  }, [content, contentHtml, annotations]);

  const activeAnn = annotations.find((a) => a._id === activeAnnotation);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest(".annotation-mark");
      if (!target) {
        setActiveAnnotation(null);
        return;
      }

      const annId = target.getAttribute("data-annotation-id");
      if (!annId) return;

      if (activeAnnotation === annId) {
        setActiveAnnotation(null);
        return;
      }

      const rect = target.getBoundingClientRect();
      // Use viewport-relative coords for fixed positioning
      setPopoverPos({
        top: rect.bottom + 8,
        left: Math.max(16, Math.min(rect.left, window.innerWidth - 380)),
      });
      setActiveAnnotation(annId);
      onAnnotationOpen?.(annId);
      await markViewed({ annotationId: annId as any });
    },
    [activeAnnotation, markViewed],
  );

  return (
    <div className="relative" onClick={handleClick}>
      {/* Article HTML with full prose styling */}
      <div
        className="prose prose-lg md:prose-xl dark:prose-invert max-w-none
          prose-headings:font-serif prose-headings:font-medium prose-headings:tracking-tight
          prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4
          prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3
          prose-p:leading-[1.8] prose-p:mb-6
          prose-a:text-annotation-crossref prose-a:underline prose-a:underline-offset-2
          prose-strong:text-ink-950 dark:prose-strong:text-parchment-100
          prose-blockquote:border-l-[3px] prose-blockquote:border-ink-300 dark:prose-blockquote:border-ink-600
          prose-blockquote:italic prose-blockquote:pl-4
          prose-code:text-sm prose-code:bg-ink-100 dark:prose-code:bg-ink-800
          prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
          prose-code:before:content-none prose-code:after:content-none
          prose-pre:bg-ink-900 dark:prose-pre:bg-ink-950 prose-pre:rounded-xl prose-pre:overflow-x-auto
          prose-pre:border prose-pre:border-ink-800
          prose-img:rounded-lg prose-img:my-8
          prose-li:leading-[1.7]"
        dangerouslySetInnerHTML={{ __html: annotatedHtml }}
      />

      {/* Floating annotation popover */}
      {activeAnn && popoverPos && (
        <div
          className="fixed z-50 w-[360px] max-w-[calc(100vw-32px)]"
          style={{ top: popoverPos.top, left: popoverPos.left }}
        >
          <AnnotationPopover
            annotation={activeAnn}
            onClose={() => setActiveAnnotation(null)}
          />
        </div>
      )}
    </div>
  );
}
