"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import {
  MAX_ARTICLE_CHARS,
  sectionRanges,
  sectionToQueueFrom,
} from "@marginalia/backend/reading-sections";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef } from "react";

// The waiting line sits on the section's first line; a few words find it in the text
const ANCHOR_CHARS = 60;

/**
 * Reading alongside (rung 2f). As the reader gets about 40% through a section,
 * asks the server to look at the one after it. The server decides whether a
 * model call is worth making, and claims the section so a second tab or a
 * fast scroll doesn't repeat it; each section is asked for once per visit here.
 *
 * Returns where the section being written begins, for the waiting line, or
 * null when nothing is being written.
 */
export function useReadAlongside(input: {
  articleId: Id<"articles">;
  /** An annotated article of this library; a book's parts are written by the part. */
  enabled: boolean;
  content: string | undefined;
  /** How far through the article the reader is, 0 to 100. */
  progress: number;
}): string | null {
  const { articleId, enabled, content, progress } = input;
  const request = useMutation(api.alongside.requestAhead);
  const ranges = useMemo(
    () => sectionRanges((content ?? "").slice(0, MAX_ARTICLE_CHARS)),
    [content],
  );
  const asked = useRef<{ articleId: string; sections: Set<number> }>({
    articleId,
    sections: new Set(),
  });
  if (asked.current.articleId !== articleId)
    asked.current = { articleId, sections: new Set() };

  useEffect(() => {
    if (!enabled || !content) return;
    const current = sectionToQueueFrom(ranges, progress / 100, content.length);
    if (current === null || asked.current.sections.has(current)) return;
    asked.current.sections.add(current);
    request({ articleId, currentSection: current }).catch(() => {
      // Reading goes on; the next visit tries again
      asked.current.sections.delete(current);
    });
  }, [enabled, content, ranges, progress, articleId, request]);

  const working = useQuery(
    api.alongside.workingSections,
    enabled ? { articleId } : "skip",
  );
  const section = working?.length ? ranges[working[0]] : undefined;
  return section ? firstLine(section.text) : null;
}

function firstLine(text: string): string {
  return (text.split("\n").find((line) => line.trim()) ?? text)
    .trim()
    .slice(0, ANCHOR_CHARS);
}
