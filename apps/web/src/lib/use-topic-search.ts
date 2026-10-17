"use client";
import {
  libraryFindResponseSchema,
  librarySearchResponseSchema,
} from "@marginalia/backend/library-search";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useConvex } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { ReaderRequestError, readerRequestError } from "@/lib/companion";
import {
  strongTitleMatch,
  type TopicMatch,
  titleFirst,
} from "@/lib/topic-card";
import { postTopicSearch as post } from "@/lib/topic-search-request";

const CACHE_TTL_MS = 5 * 60_000;
/** Short, because the fast path only embeds and searches. */
const DEBOUNCE_MS = 250;

export interface TopicSearch {
  /** The trimmed query this result answers. */
  query: string;
  status: "loading" | "ready" | "error";
  matches: TopicMatch[];
  /** The search hit its cap, so more could exist than were returned. */
  more: boolean;
  /** Why one article fits, by article id; fills in after the cards. */
  reasons: Record<string, string>;
  /** The explanation request has finished, with or without a reason per card. */
  explained: boolean;
  /** Why search can't run yet, such as a missing provider key. */
  error?: string;
}

interface CacheEntry {
  time: number;
  find: Pick<TopicSearch, "matches" | "more">;
  reasons: Record<string, string>;
}

const idle: TopicSearch = {
  query: "",
  status: "ready",
  matches: [],
  more: false,
  reasons: {},
  explained: true,
};

async function failure(thrown: unknown) {
  return thrown instanceof Response ? readerRequestError(thrown) : thrown;
}

/**
 * A title query runs beside the first request and may show one card at once.
 * Two requests per query. `library/find` (embedding and vector search, no
 * model) gives the cards; `library/search` (the model's ranking) then gives
 * the reason lines. A backend without `find` answers 404, and the explained
 * search alone supplies the cards, as before.
 */
export function useTopicSearch(text: string, enabled: boolean, retry: number) {
  const [state, setState] = useState<TopicSearch>(idle);
  const cache = useRef(new Map<string, CacheEntry>());
  const convex = useConvex();

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly reruns a failed request
  useEffect(() => {
    if (!enabled) return;
    const key = text.toLowerCase();
    const remember = (entry: CacheEntry) => {
      const entries = cache.current;
      entries.delete(key);
      if (entries.size >= 20) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, entry);
    };
    const controller = new AbortController();
    const { signal } = controller;
    const cached = cache.current.get(key);
    if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
      setState({
        query: text,
        status: "ready",
        ...cached.find,
        reasons: cached.reasons,
        explained: true,
      });
      return;
    }
    setState({ ...idle, query: text, status: "loading", explained: false });

    // Reasons attach by id, so a different ranking can't move one onto another card.
    const reasonsFor = (
      ranked: { articleId: string; reason: string }[],
      shown: TopicMatch[],
    ) => {
      const ids = new Set(shown.map((match) => match.articleId));
      return Object.fromEntries(
        ranked
          .filter((match) => ids.has(match.articleId) && match.reason)
          .map((match) => [match.articleId, match.reason]),
      );
    };
    const search = async () =>
      librarySearchResponseSchema.parse(
        await post(
          "search",
          text,
          AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        ),
      ).matches;

    // A strong title match is the first card without waiting for the query to
    // be embedded. Once `find` has answered the first card is already on
    // screen, so a late title result is dropped rather than put in front.
    let titleCard: TopicMatch | null = null;
    let findLanded = false;
    const land = (ranked: TopicMatch[]) => {
      findLanded = true;
      return titleFirst(titleCard, ranked);
    };
    const showTitle = async () => {
      try {
        const hits = await convex.query(api.titleSearch.matchTitles, {
          query: text,
        });
        const strong = strongTitleMatch(text, hits);
        if (!strong || signal.aborted || findLanded) return;
        titleCard = strong;
        setState((current) =>
          current.query === text && current.status === "loading"
            ? {
                query: text,
                status: "ready",
                matches: [strong],
                more: false,
                reasons: {},
                explained: false,
              }
            : current,
        );
      } catch {
        // The title match is a shortcut; the library search still answers.
      }
    };

    const timer = window.setTimeout(async () => {
      void showTitle();
      try {
        let find: CacheEntry["find"];
        try {
          const body = libraryFindResponseSchema.parse(
            await post(
              "find",
              text,
              AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
            ),
          );
          find = { matches: land(body.matches), more: body.more };
        } catch (thrown) {
          if (!(thrown instanceof Response && thrown.status === 404))
            throw thrown;
          // A backend without the fast path: the explained search gives the cards.
          const ranked = await search();
          if (signal.aborted) return;
          find = {
            matches: land(
              ranked.map(({ reason, ...match }) => ({
                ...match,
                source: null,
              })),
            ),
            more: false,
          };
          const reasons = reasonsFor(ranked, find.matches);
          remember({ time: Date.now(), find, reasons });
          setState({
            query: text,
            status: "ready",
            ...find,
            reasons,
            explained: true,
          });
          return;
        }
        if (signal.aborted) return;
        // Nothing to explain when the library has no match.
        setState({
          query: text,
          status: "ready",
          ...find,
          reasons: {},
          explained: !find.matches.length,
        });
        if (!find.matches.length) return;
        let reasons: Record<string, string> | null = null;
        try {
          reasons = reasonsFor(await search(), find.matches);
        } catch {
          // The cards stand without a reason; a failed explanation isn't an error to show.
        }
        if (signal.aborted) return;
        if (reasons) remember({ time: Date.now(), find, reasons });
        setState((current) =>
          current.query === text
            ? { ...current, reasons: reasons ?? {}, explained: true }
            : current,
        );
      } catch (thrown) {
        if (signal.aborted) return;
        const error = await failure(thrown);
        setState({
          ...idle,
          query: text,
          status: "error",
          error:
            error instanceof ReaderRequestError && error.code
              ? error.message
              : undefined,
        });
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, text, retry, convex]);

  return state;
}
