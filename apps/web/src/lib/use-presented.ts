"use client";
import { useEffect, useRef } from "react";

/**
 * Calls `record` once for each article the first time it is on screen as a
 * card. Re-renders and a card coming back into view are not new offers; a
 * new mount (a new deck or a reopened finder) starts a fresh count. Pass
 * nothing while no card is showing, such as a prefetched or loading deck.
 */
export function usePresented<Id extends string>(
  articleId: Id | undefined,
  record: (articleId: Id) => void,
) {
  const seen = useRef(new Set<Id>());
  const latest = useRef(record);
  latest.current = record;
  useEffect(() => {
    if (!articleId || seen.current.has(articleId)) return;
    seen.current.add(articleId);
    latest.current(articleId);
  }, [articleId]);
}
