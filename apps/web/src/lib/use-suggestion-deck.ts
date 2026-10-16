"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import {
  appendFitting,
  type DeckView,
  deckView,
  shouldLoadMore,
} from "@/lib/suggestion-deck";

// Cards fetched per page once the first three are used up
export const PAGE_SIZE = 10;
export type Card = FunctionReturnType<typeof api.suggestions.forWindow>[number];

export type SuggestionDeck = {
  /** "loading" until the first answer arrives and whenever the next page is on its way. */
  view: DeckView;
  card: Card | undefined;
  index: number;
  size: number;
  exhausted: boolean;
  /** Only asked for once nothing in the window fits. */
  shortest:
    | FunctionReturnType<typeof api.suggestions.shortestUnread>
    | undefined;
  /** Moves past the card at `fromIndex`; a stale index can't skip a second card. */
  advance: (fromIndex: number) => void;
};

/**
 * The cards for one time window: the server's best few first, then the rest one
 * page at a time. The deck only grows, so a live update can't move a card the
 * reader has already been shown. The caller keys it by window, so nothing from
 * a previous browse leaks into the next.
 */
export function useSuggestionDeck(requestedMinutes: number): SuggestionDeck {
  const live = useQuery(api.suggestions.forWindow, { requestedMinutes });
  // Keep the first answer: a live update mustn't reshuffle cards mid-browse.
  // Seeded from the query's current value so a prefetched answer renders at once.
  const [head, setHead] = useState(live);
  useEffect(() => {
    if (live && !head) setHead(live);
  }, [live, head]);

  const { results, status, loadMore } = usePaginatedQuery(
    api.suggestions.moreForWindow,
    { requestedMinutes },
    { initialNumItems: PAGE_SIZE },
  );
  const [index, setIndex] = useState(0);
  const [deck, setDeck] = useState<Card[]>(() =>
    appendFitting([], live ?? [], requestedMinutes),
  );
  const canLoadMore = status === "CanLoadMore";
  const exhausted = status === "Exhausted";
  useEffect(() => {
    if (!head) return;
    const next = appendFitting(deck, [...head, ...results], requestedMinutes);
    if (next.length !== deck.length) setDeck(next);
    // Judged on the deck after this merge, so one page doesn't trigger a second fetch
    if (shouldLoadMore({ length: next.length, index, canLoadMore })) {
      loadMore(PAGE_SIZE);
    }
  }, [head, results, deck, index, canLoadMore, loadMore, requestedMinutes]);

  const view =
    head === undefined
      ? "loading"
      : deckView({ length: deck.length, index, exhausted });
  const shortest = useQuery(
    api.suggestions.shortestUnread,
    view === "empty" ? {} : "skip",
  );

  return {
    view,
    card: deck[index],
    index,
    size: deck.length,
    exhausted,
    shortest,
    advance: (fromIndex) => setIndex(fromIndex + 1),
  };
}
