"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { appendFitting, deckView, shouldLoadMore } from "@/lib/suggestion-deck";
import { formatDate, formatReadTime } from "@/lib/utils";

// Cards fetched per page once the first three are used up
const PAGE_SIZE = 10;
type Card = FunctionReturnType<typeof api.suggestions.forWindow>[number];

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  // SAFETY: session links come from stored IDs; Convex validates this route parameter with v.id("sessions").
  const sessionId = id as Id<"sessions">;
  const session = useQuery(api.sessions.getById, {
    sessionId,
  });

  // Home passes the window in the URL so suggestions load alongside the session
  const fromUrl = Number(useSearchParams().get("m"));
  const requestedMinutes =
    Number.isFinite(fromUrl) && fromUrl > 0 && fromUrl <= 180
      ? fromUrl
      : session?.requestedMinutes;

  if (session === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p>This session isn't here.</p>
        <Link href="/">Back to Home</Link>
      </div>
    );
  }
  // A different session or window starts a fresh head and deck, so nothing
  // from the previous browse leaks into this one
  return (
    <SessionDeck
      key={`${sessionId}:${requestedMinutes}`}
      sessionId={sessionId}
      requestedMinutes={requestedMinutes}
    />
  );
}

function SessionDeck({
  sessionId,
  requestedMinutes,
}: {
  sessionId: Id<"sessions">;
  requestedMinutes: number | undefined;
}) {
  const router = useRouter();
  const recordInteraction = useMutation(api.sessions.recordInteraction);
  const saveArticle = useMutation(api.savedArticles.save);
  const updateSession = useMutation(api.sessions.updateStatus);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(0);

  const live = useQuery(
    api.suggestions.forWindow,
    requestedMinutes === undefined ? "skip" : { requestedMinutes },
  );
  // Keep the first answer: a live update mustn't reshuffle cards mid-browse
  const [head, setHead] = useState<Card[] | undefined>();
  useEffect(() => {
    if (live && !head) setHead(live);
  }, [live, head]);
  const loading = head === undefined;

  // The rest of the window, one page at a time. The deck only ever grows, so
  // a live update can't move a card the reader has already been shown.
  const more = usePaginatedQuery(
    api.suggestions.moreForWindow,
    requestedMinutes === undefined ? "skip" : { requestedMinutes },
    { initialNumItems: PAGE_SIZE },
  );
  const { results, status, loadMore } = more;
  const [deck, setDeck] = useState<Card[]>([]);
  const canLoadMore = status === "CanLoadMore";
  const exhausted = status === "Exhausted";
  useEffect(() => {
    if (!head || requestedMinutes === undefined) return;
    const next = appendFitting(deck, [...head, ...results], requestedMinutes);
    if (next.length !== deck.length) setDeck(next);
    // Judged on the deck after this merge, so one page doesn't trigger a second fetch
    if (
      shouldLoadMore({ length: next.length, index: currentIndex, canLoadMore })
    ) {
      loadMore(PAGE_SIZE);
    }
  }, [
    head,
    results,
    deck,
    currentIndex,
    canLoadMore,
    loadMore,
    requestedMinutes,
  ]);

  const current = deck[currentIndex];
  const view = deckView({
    length: deck.length,
    index: currentIndex,
    exhausted,
  });
  // Only asked for once nothing in the window fits
  const shortest = useQuery(
    api.suggestions.shortestUnread,
    view === "empty" ? {} : "skip",
  );

  const handleRead = async () => {
    if (!current) return;
    await recordInteraction({
      articleId: current._id,
      sessionId,
      action: "opened",
    });
    await updateSession({
      sessionId,
      readingStatus: "reading",
      articleId: current._id,
    });
    router.push(`/read/${current._id}?session=${sessionId}`);
  };

  const handleSkip = async () => {
    if (!current) return;
    await recordInteraction({
      articleId: current._id,
      sessionId,
      action: "skipped",
    });
    setDirection(1);
    setCurrentIndex((i) => i + 1);
  };

  const handleSave = async () => {
    if (!current) return;
    await saveArticle({ articleId: current._id });
    await recordInteraction({
      articleId: current._id,
      sessionId,
      action: "saved",
    });
    // Move to next
    setDirection(1);
    setCurrentIndex((i) => i + 1);
  };

  if (loading || view === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6">
        <div className="animate-pulse text-center">
          <p className="text-ink-500 font-sans text-sm mb-2">
            Finding something
            {requestedMinutes ? ` for your ${requestedMinutes} minutes` : ""}
            ...
          </p>
          <div className="w-8 h-0.5 bg-annotation-crossref mx-auto" />
        </div>
      </div>
    );
  }

  if (view === "end") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
        <p className="text-ink-600 dark:text-ink-400 text-lg mb-4">
          That's everything that fits in {requestedMinutes} minutes.
        </p>
        <Link
          href="/"
          className="text-annotation-crossref hover:underline font-sans text-sm"
        >
          Try a different time
        </Link>
      </div>
    );
  }

  if (view === "empty" || !current) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
        <p className="text-ink-600 dark:text-ink-400 text-lg mb-4">
          Nothing fits in {requestedMinutes} minutes.
        </p>
        {shortest && (
          <p className="text-ink-500 font-sans text-sm mb-4">
            The shortest is {shortest.estimatedReadMinutes} min:{" "}
            <Link
              href={`/read/${shortest._id}`}
              className="text-annotation-crossref hover:underline"
            >
              {shortest.title}
            </Link>
          </p>
        )}
        <Link
          href="/"
          className="text-annotation-crossref hover:underline font-sans text-sm"
        >
          Try a different time
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 py-12">
      {/* Back */}
      <div className="fixed top-6 left-6">
        <Link
          href="/"
          className="text-ink-400 hover:text-ink-600 font-sans text-sm transition-colors"
        >
          &larr; Back
        </Link>
      </div>

      {/* Card counter */}
      <p className="text-ink-400 font-sans text-xs mb-8 tracking-wide">
        {currentIndex + 1} of {deck.length}
        {exhausted ? "" : "+"}
      </p>

      {/* Article card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={current._id}
          initial={{ opacity: 0, x: direction * 50 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -50 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          <div className="bg-white dark:bg-ink-900 rounded-2xl border border-ink-200 dark:border-ink-800 p-8 shadow-sm">
            {/* Source */}
            <p className="text-xs font-sans text-ink-400 dark:text-ink-500 uppercase tracking-wider mb-4">
              {current.author || "Unknown source"}
            </p>

            {/* Title */}
            <h2 className="text-2xl font-serif font-medium text-ink-950 dark:text-parchment-100 mb-4 leading-snug">
              {current.title}
            </h2>

            {/* Meta */}
            <div className="flex gap-3 text-sm font-sans text-ink-400 dark:text-ink-500 mb-6">
              <span>{formatReadTime(current.estimatedReadMinutes)}</span>
              {current.publishedAt && (
                <>
                  <span>&middot;</span>
                  <span>{formatDate(current.publishedAt)}</span>
                </>
              )}
            </div>

            {/* Why this article */}
            {current.reason && (
              <p className="text-sm font-sans text-annotation-crossref italic mb-6 pb-6 border-b border-ink-100 dark:border-ink-800">
                {current.reason}
              </p>
            )}

            {/* Excerpt */}
            {current.excerpt && (
              <p className="text-ink-600 dark:text-ink-400 text-sm leading-relaxed line-clamp-3">
                {current.excerpt}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-6 justify-center">
            <button
              onClick={handleRead}
              className="px-8 py-3 reader-float rounded-xl font-sans text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Read now
            </button>
            <button
              onClick={handleSkip}
              className="px-6 py-3 border border-ink-200 dark:border-ink-700 rounded-xl font-sans text-sm text-ink-600 dark:text-ink-400 hover:border-ink-400 transition-colors disabled:opacity-30"
            >
              Skip
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-3 border border-ink-200 dark:border-ink-700 rounded-xl font-sans text-sm text-ink-600 dark:text-ink-400 hover:border-annotation-crossref hover:text-annotation-crossref transition-colors"
              title="Save for later"
            >
              +
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
