"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import {
  libraryFindResponseSchema,
  librarySearchResponseSchema,
} from "@marginalia/backend/library-search";
import { useConvex } from "convex/react";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { ReaderRequestError, readerRequestError } from "@/lib/companion";
import { discoveryInvalidation } from "@/lib/discovery-invalidation";
import {
  strongTitleMatch,
  type TopicMatch,
  titleFirst,
} from "@/lib/topic-card";
import {
  TOPIC_CACHE_TTL_MS as CACHE_TTL_MS,
  type TopicCacheEntry as CacheEntry,
  topicSearchCache as cache,
  listenForTopicCacheInvalidation,
} from "@/lib/topic-search-cache";
import { postTopicSearch as post } from "@/lib/topic-search-request";
import { useDiscoveryRevision } from "@/lib/use-discovery-revision";

export { invalidateTopicSearchCache } from "@/lib/topic-search-cache";

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

function settleInvalidated(current: TopicSearch): TopicSearch {
  return current.status === "loading"
    ? { ...current, status: "error", explained: true }
    : current.explained
      ? current
      : { ...current, explained: true };
}

/**
 * A title query runs beside the first request and may show one card at once.
 * Two requests per query. `library/find` (embedding and vector search, no
 * model) gives the cards; `library/search` (the model's ranking) then gives
 * the reason lines. A backend without `find` answers 404, and the explained
 * search alone supplies the cards, as before.
 */
export function useTopicSearch(
  text: string,
  enabled: boolean,
  retry: number,
  mode: "typing" | "list" = "typing",
) {
  const [state, setState] = useState<TopicSearch>(idle);
  const [stateScope, setStateScope] = useState<string | null>(null);
  const convex = useConvex();
  const { data: session } = authClient.useSession();
  const sessionId = session?.session.id;
  const scope = sessionId ?? null;
  cache.forScope(scope);
  const revision = useDiscoveryRevision(scope, (token) =>
    cache.observeRevision(token),
  );

  useEffect(() => {
    if (revision.token === undefined) return;
    // Retire a fenced request without replacing its cards or starting another.
    setState(settleInvalidated);
  }, [revision.token]);

  useEffect(() => {
    listenForTopicCacheInvalidation();
    return discoveryInvalidation.subscribe(() => {
      // A discarded in-flight answer must not leave an endless loading state.
      // Keep existing cards/input; the existing Retry action is explicit work.
      setState(settleInvalidated);
    });
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId || !revision.settled) return;
    // Bind the committed request too: an abandoned concurrent render must not
    // leave the singleton cache scoped to another session at reservation time.
    cache.forScope(scope);
    setStateScope(scope);
    const generation = cache.generation;
    const key = text.trim().toLowerCase();
    const remember = (entry: Omit<CacheEntry, "foundAt">) => {
      if (scope && cache.revisionSupported && !signal.aborted)
        cache.set(key, { ...entry, foundAt }, generation);
    };
    const controller = new AbortController();
    const { signal } = controller;
    const current = () => !signal.aborted && generation === cache.generation;
    const entry =
      retry === 0 && scope && cache.revisionSupported
        ? cache.get(key)
        : undefined;
    const cached =
      entry && Date.now() - entry.foundAt < CACHE_TTL_MS ? entry : undefined;
    // Completing/retrying reasons must not renew the lifetime of old cards.
    const foundAt = cached?.foundAt ?? Date.now();
    if (cached) {
      setState({
        query: text,
        status: "ready",
        ...cached.find,
        reasons: cached.reasons,
        explained: cached.explained || mode === "list",
      });
      if (cached.explained || mode === "list") return;
    }
    if (!cached)
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
        if (!strong || !current() || findLanded) return;
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

    const timer = window.setTimeout(
      async () => {
        if (!current()) return;
        if (!cached) void showTitle();
        try {
          let find: CacheEntry["find"];
          try {
            if (cached) find = cached.find;
            else {
              const body = libraryFindResponseSchema.parse(
                await post(
                  "find",
                  text,
                  AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
                ),
              );
              find = { matches: land(body.matches), more: body.more };
            }
          } catch (thrown) {
            if (!(thrown instanceof Response && thrown.status === 404))
              throw thrown;
            if (!current()) return;
            // A backend without the fast path: the explained search gives the cards.
            const ranked = await search();
            if (!current()) return;
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
            remember({ find, reasons, explained: true });
            setState({
              query: text,
              status: "ready",
              ...find,
              reasons,
              explained: true,
            });
            return;
          }
          if (!current()) return;
          remember({
            find,
            reasons: cached?.reasons ?? {},
            explained: cached?.explained ?? !find.matches.length,
          });
          // Nothing to explain when the library has no match.
          setState({
            query: text,
            status: "ready",
            ...find,
            reasons: cached?.reasons ?? {},
            explained: mode === "list" || !find.matches.length,
          });
          if (!find.matches.length || mode === "list") return;
          let reasons: Record<string, string> | null = null;
          try {
            reasons = reasonsFor(await search(), find.matches);
          } catch {
            // The cards stand without a reason; a failed explanation isn't an error to show.
          }
          if (!current()) return;
          if (reasons) remember({ find, reasons, explained: true });
          setState((current) =>
            current.query === text
              ? { ...current, reasons: reasons ?? {}, explained: true }
              : current,
          );
        } catch (thrown) {
          if (!current()) return;
          const error = await failure(thrown);
          // Reading the error body takes time; a newer query may have started meanwhile
          if (!current()) return;
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
      },
      mode === "list" || cached ? 0 : DEBOUNCE_MS,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // A changed epoch is deliberately NOT an effect dependency. Only initial
    // registration waits for the first signal; receipt never restarts providers.
  }, [enabled, text, retry, convex, mode, scope, sessionId, revision.settled]);

  return enabled && sessionId && stateScope === scope ? state : idle;
}
