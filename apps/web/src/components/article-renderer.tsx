"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { sanitizeHtml, useMounted } from "@/lib/sanitize";

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
  activeAnnotationId: string | null;
  /** Called with the clicked annotation, or null when the open one is clicked again. */
  onAnnotationSelect: (annotationId: string | null) => void;
}

const ANNOTATION_LABELS: Record<string, string> = {
  cross_reference: "Cross-reference",
  context: "Context",
  tension: "Tension",
  question: "Question",
};

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

      // Weight tier: resonant (high signal), standard, quiet
      let weight = "standard";
      if (ann.relevanceScore >= 0.85 || ann.type === "tension") {
        weight = "resonant";
      } else if (ann.relevanceScore < 0.7 || ann.type === "context") {
        weight = "quiet";
      }

      const before = result.slice(0, match.index);
      const after = result.slice(match.index + match[0].length);
      const marker =
        // Focusable so annotations can be opened from the keyboard (Tab, then Enter)
        `<mark class="annotation-mark" data-annotation-id="${ann._id}" data-type="${ann.type}" data-weight="${weight}" tabindex="0" role="button" aria-label="${ANNOTATION_LABELS[ann.type] ?? "Annotation"}: open note">` +
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
  activeAnnotationId,
  onAnnotationSelect,
}: ArticleRendererProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const markViewed = useMutation(api.annotations.markViewed);

  // Sanitize HTML then inject annotation markers
  // Sanitising needs the browser's DOM, so the article body renders after mount
  const mounted = useMounted();
  const annotatedHtml = useMemo(() => {
    if (!mounted) return "";
    const sanitized = sanitizeHtml(contentHtml || content, {
      ADD_TAGS: ["mark", "sup"],
      ADD_ATTR: ["data-annotation-id", "data-type", "style", "class", "target"],
    });
    return injectAnnotations(sanitized, content, annotations);
  }, [mounted, content, contentHtml, annotations]);

  // React 19 rewrites innerHTML whenever this object's identity changes, which
  // would wipe the reader's selection and paragraph tags on every re-render.
  const innerHtml = useMemo(() => ({ __html: annotatedHtml }), [annotatedHtml]);

  // Emphasise the annotation whose card is open
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-apply after the HTML is replaced
  useEffect(() => {
    if (!activeAnnotationId) return;
    const mark = bodyRef.current?.querySelector(
      `[data-annotation-id="${CSS.escape(activeAnnotationId)}"]`,
    );
    mark?.setAttribute("data-active", "");
    return () => mark?.removeAttribute("data-active");
  }, [activeAnnotationId, innerHtml]);

  const handleClick = useCallback(
    (element: EventTarget) => {
      const target =
        element instanceof HTMLElement
          ? element.closest(".annotation-mark")
          : null;
      const annId = target?.getAttribute("data-annotation-id");
      if (!annId) return;
      if (activeAnnotationId === annId) {
        onAnnotationSelect(null);
        return;
      }
      onAnnotationSelect(annId);
      markViewed({ annotationId: annId as any });
    },
    [activeAnnotationId, onAnnotationSelect, markViewed],
  );

  return (
    <div
      className="relative"
      onClick={(e) => handleClick(e.target)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (!(e.target as HTMLElement).closest(".annotation-mark")) return;
        e.preventDefault();
        handleClick(e.target);
      }}
    >
      {/* Article HTML with full prose styling */}
      <div
        ref={bodyRef}
        data-article-body
        className="reader-prose prose prose-lg md:prose-xl dark:prose-invert max-w-none
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
        dangerouslySetInnerHTML={innerHtml}
      />
    </div>
  );
}
