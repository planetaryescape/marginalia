"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

/** `?unit=` as a part number counted from 0, or null when absent or not a number. */
export function parseUnit(value: string | null): number | null {
  return value !== null && /^\d{1,5}$/.test(value) ? Number(value) : null;
}

/**
 * The article the reader shows. An ordinary article is returned as it is. A
 * book's row holds no text, so it is returned with the text, length and
 * annotation status of the one part being read; `unitIndex` says which.
 *
 * The part opened by default is the one the desk would offer next, read once:
 * finishing a part moves "next" on, and the page must not jump with it.
 */
export function useReadable(
  articleId: Id<"articles">,
  unitParam: string | null,
) {
  const doc = useQuery(api.articles.getById, { articleId });
  const isBook = doc?.bookUnitCount !== undefined && doc !== null;
  const book = useQuery(api.books.get, isBook ? { articleId } : "skip");
  const [first, setFirst] = useState<{ id: string; unit: number } | null>(null);
  useEffect(() => {
    if (book && first?.id !== articleId)
      setFirst({ id: articleId, unit: book.nextUnit });
  }, [book, first, articleId]);

  const requested = parseUnit(unitParam);
  const unitIndex = !isBook
    ? null
    : (requested ?? (first?.id === articleId ? first.unit : null));
  const unit = useQuery(
    api.books.unit,
    isBook && unitIndex !== null ? { articleId, index: unitIndex } : "skip",
  );

  const article = useMemo(() => {
    if (!doc || !isBook) return doc;
    if (!unit) return undefined;
    return {
      ...doc,
      content: unit.content,
      contentHtml: unit.contentHtml,
      wordCount: unit.wordCount,
      estimatedReadMinutes: unit.estimatedReadMinutes,
      annotationStatus: unit.annotationStatus,
    };
  }, [doc, isBook, unit]);

  return {
    article,
    isBook,
    unitIndex,
    unitTitle: unit?.title,
    /** Identity of the part whose text is on screen */
    unitKey: unit && article ? unit._id : undefined,
    outline: book?.outline,
    /** A part that doesn't exist (a stale link): the reader falls back to the first. */
    missingUnit: isBook && unitIndex !== null && unit === null,
  };
}

/**
 * Tells the server where the reader is in a part: on opening it (which starts
 * the part's margin) and as they get further, in steps of five percent so a
 * scroll doesn't become a write per frame.
 *
 * The position is measured here, from the part's own text, and keyed by the
 * part: after Next the old part's 95% is never recorded against the new one.
 * `unitKey` is the stored unit's identity, set only once its text is the text
 * on screen, and `measure` reads the percentage scrolled from the page.
 */
export function useBookProgress(
  articleId: Id<"articles">,
  unitIndex: number | null,
  unitKey: string | undefined,
  measure: () => number | null,
) {
  const record = useMutation(api.books.recordProgress);
  const measureRef = useRef(measure);
  measureRef.current = measure;
  useEffect(() => {
    if (unitIndex === null || !unitKey) return;
    let last = -1;
    let cancelled = false;
    const send = () => {
      if (cancelled) return;
      const percent = measureRef.current();
      // Nothing is recorded until the part's text has been measured
      if (percent === null) return;
      const step = Math.min(100, Math.floor(percent / 5) * 5);
      if (step === last) return;
      const sent = last;
      last = step;
      record({ articleId, unitIndex, scrollPercent: step }).catch(() => {
        // Reading goes on; the next step tries again
        if (last === step) last = sent;
      });
    };
    // After the part's text has been laid out
    const frame = requestAnimationFrame(send);
    window.addEventListener("scroll", send, { passive: true });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", send);
    };
  }, [articleId, unitIndex, unitKey, record]);
}
