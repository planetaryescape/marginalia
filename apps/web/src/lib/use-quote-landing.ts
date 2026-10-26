"use client";
import { type RefObject, useEffect, useRef, useState } from "react";
import { getArticleBody } from "@/lib/paragraphs";
import { findTextRange } from "@/lib/text-range";

/**
 * Scrolls the article to the passage a `?quote=` link names, once per quote.
 * `version` bumps whenever the article is re-tagged, so a quote that is not
 * rendered yet is looked for again on the next pass. Later re-tags never
 * scroll the reader back, because the quote has already landed.
 *
 * Returns whether the current quote has landed, so the caller can open the
 * note the link was for once the line is on screen.
 */
export function useQuoteLanding(
  containerRef: RefObject<HTMLElement | null>,
  quote: string | null,
  version: number,
  paragraphIndex: number | null = null,
) {
  const landed = useRef<string | null>(null);
  const [landedQuote, setLandedQuote] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` signals the article was re-tagged
  useEffect(() => {
    if (!quote) {
      landed.current = null;
      setLandedQuote(null);
      return;
    }
    if (landed.current === quote) return;
    const body = getArticleBody(containerRef.current);
    if (!body) return;
    // Prefer the saved paragraph (0-based, `data-para` is 1-based) when the quote repeats
    const preferred =
      paragraphIndex === null
        ? null
        : body.querySelector<HTMLElement>(
            `[data-para="${paragraphIndex + 1}"]`,
          );
    const range = findTextRange(body, quote, preferred);
    if (!range) return;
    landed.current = quote;
    setLandedQuote(quote);
    const node = range.startContainer;
    const el = node instanceof Element ? node : node.parentElement;
    // A deep link lands where the reader is starting, so there is no smooth scroll to follow.
    el?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [containerRef, quote, version, paragraphIndex]);
  return quote !== null && landedQuote === quote;
}

/**
 * What a link from Notes asks the reader to open once its line is on screen:
 * the Notes panel for a note, the margin card for a kept answer. An answer
 * waits until the reader has loaded it, since opening one it does not know
 * would start a new conversation.
 */
export function openAfterLanding(input: {
  landed: boolean;
  note: string | null;
  answer: string | null;
  loadedAnswerIds: readonly string[] | undefined;
}): { open: "notes" } | { open: "answer"; id: string } | null {
  if (!input.landed) return null;
  if (input.answer) {
    return input.loadedAnswerIds?.includes(input.answer)
      ? { open: "answer", id: input.answer }
      : null;
  }
  if (input.note) return { open: "notes" };
  return null;
}
