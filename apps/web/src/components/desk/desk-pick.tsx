"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { InlineError, SavedMark } from "@/components/in-place";
import { OPEN_ARTICLE, ViewTransition } from "@/components/view-transition";
import { createSingleFlight } from "@/lib/suggestion-deck";
import { articleTitleName, rememberTitle } from "@/lib/title-handoff";
import { usePresented } from "@/lib/use-presented";
import { useSessionRecorder } from "@/lib/use-session-recorder";
import { type Card, useSuggestionDeck } from "@/lib/use-suggestion-deck";
import { SAVED_MS, useTimedFlag } from "@/lib/use-timed-flag";

/** A pick that hasn't arrived by now gets a skeleton in its place. */
export const SKELETON_DELAY_MS = 150;
/** Long enough for the card to finish sliding, so a double click moves one card. */
export const SETTLE_MS = 300;

const MOVE = { duration: 0.24, ease: [0.2, 0.8, 0.2, 1] } as const;
const LABEL =
  "text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]";

function sourceOf(card: Card) {
  try {
    // An uploaded PDF's address has no host
    return new URL(card.url).hostname.replace(/^www\./, "") || "PDF";
  } catch {
    return card.author ?? "Unknown source";
  }
}

function useAfter(active: boolean, ms: number) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) return setElapsed(false);
    const timer = window.setTimeout(() => setElapsed(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return active && elapsed;
}

function Quiet({
  children,
  onClick,
  hidden,
}: {
  children: string;
  onClick: () => void;
  hidden?: boolean;
}) {
  return (
    <button
      type="button"
      hidden={hidden}
      onClick={onClick}
      className="text-[14.5px] text-[var(--ink-soft)] underline decoration-[color-mix(in_srgb,var(--ink)_20%,transparent)] underline-offset-[3px] hover:text-[var(--ink)]"
    >
      {children}
    </button>
  );
}

/**
 * The pick for one time window, in the desk's main slot. The caller keys it by
 * choice, so a different time or a second visit starts a fresh deck and a
 * fresh session.
 */
export function DeskPick({
  minutes,
  sessionId,
  onClose,
}: {
  minutes: number;
  sessionId?: Id<"sessions">;
  /** Back to the slot's resting state. */
  onClose: () => void;
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const deck = useSuggestionDeck(minutes);
  const recorder = useSessionRecorder({
    requestedMinutes: minutes,
    existingId: sessionId,
  });
  const saveArticle = useMutation(api.savedArticles.save);
  const [direction, setDirection] = useState(0);
  const [saved, flashSaved, clearSaved] = useTimedFlag(SAVED_MS);
  const [saveFailed, setSaveFailed] = useState(false);
  const showSkeleton = useAfter(deck.view === "loading", SKELETON_DELAY_MS);

  // One action at a time: a second click while one is running is dropped, and
  // each action advances from the index it was clicked on.
  const [runCardAction] = useState(() => createSingleFlight());
  const act = (task: () => Promise<void>) =>
    runCardAction(async () => {
      await task();
      await new Promise((resolve) => window.setTimeout(resolve, SETTLE_MS));
    });

  const { card, index } = deck;
  // The offer is counted when the card is on screen, in this time's session
  usePresented(card?._id, (articleId) =>
    recorder.record({
      articleId,
      action: "presented",
    }),
  );
  const another = () => {
    if (!card) return;
    return act(async () => {
      setSaveFailed(false);
      clearSaved();
      recorder.record({ articleId: card._id, action: "skipped" });
      setDirection(1);
      deck.advance(index);
    });
  };
  const saveForLater = () => {
    if (!card) return;
    return act(async () => {
      try {
        await saveArticle({ articleId: card._id });
      } catch {
        setSaveFailed(true);
        return;
      }
      setSaveFailed(false);
      flashSaved();
      recorder.record({ articleId: card._id, action: "saved" });
      setDirection(1);
      deck.advance(index);
    });
  };
  const readNow = () => {
    if (!card) return;
    return act(async () => {
      // The reader draws this title in the same commit, so the morph has a destination
      rememberTitle(card._id, card.title);
      const id = await recorder.open(card._id);
      router.push(`/read/${card._id}${id ? `?session=${id}` : ""}`, {
        transitionTypes: [OPEN_ARTICLE],
      });
    });
  };

  const label = <p className={LABEL}>For {minutes} minutes</p>;

  if (deck.view === "loading") {
    return (
      <div role="status" aria-busy="true">
        {label}
        {showSkeleton && (
          <div className="mt-3 max-w-[620px]" data-testid="pick-skeleton">
            <div className="h-7 w-[70%] rounded bg-[var(--reader-chip)]" />
            <div className="mt-3 h-3.5 w-[30%] rounded bg-[var(--reader-chip)]" />
          </div>
        )}
      </div>
    );
  }

  if (deck.view === "end") {
    return (
      <div className="max-w-[620px]">
        {label}
        <p className="mt-2 text-[15px] text-[var(--ink-soft)]">
          That's everything that fits in {minutes} minutes.
        </p>
        <div className="mt-5">
          <Quiet onClick={onClose}>Back</Quiet>
        </div>
      </div>
    );
  }

  if (deck.view === "empty" || !card) {
    return (
      <div className="max-w-[620px]">
        {label}
        <p className="mt-2 font-serif text-[24px] leading-tight">
          Nothing fits in {minutes} minutes.
        </p>
        {deck.shortest && (
          <p className="mt-2 text-[15px] text-[var(--pencil)]">
            The shortest unread article is {deck.shortest.estimatedReadMinutes}{" "}
            min: “{deck.shortest.title}”.
          </p>
        )}
        <div className="mt-5 flex items-center gap-5">
          {deck.shortest && (
            <Link
              href={`/read/${deck.shortest._id}`}
              className="rounded-md bg-[var(--reader-chip)] px-[18px] py-[9px] text-[14.5px] text-[var(--ink-soft)] hover:text-[var(--ink)]"
            >
              Read it anyway
            </Link>
          )}
          <Quiet onClick={onClose}>Try a different time</Quiet>
        </div>
      </div>
    );
  }

  // A book is offered by its next part, named for what the reader will read
  const meta = (
    card.book
      ? [
          `“${card.book.unitTitle}”`,
          `${card.estimatedReadMinutes} min`,
          card.book.started ? "the next part after where you stopped" : null,
        ]
      : [
          sourceOf(card),
          card.estimatedReadMinutes ? `${card.estimatedReadMinutes} min` : null,
        ]
  )
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="max-w-[620px]">
      {label}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={card._id}
          initial={{ opacity: 0, x: reduced ? 0 : direction * 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduced ? 0 : -24 }}
          transition={MOVE}
        >
          <ViewTransition
            name={articleTitleName(card._id)}
            share="article-title"
            default="none"
          >
            <h2 className="mt-2 font-serif text-[24px] lg:text-[30px] leading-tight text-[var(--ink)]">
              {card.title}
            </h2>
          </ViewTransition>
          <p className="mt-1.5 text-[13.5px] text-[var(--ink-muted)]">{meta}</p>
          {card.reason && (
            <p className="mt-3 text-[15px] text-[var(--pencil)]">
              {card.reason}
            </p>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={readNow}
          className="rounded-md bg-[var(--ink)] px-[18px] py-[9px] text-[14.5px] text-[var(--reader-bg)] hover:opacity-90"
        >
          Read now
        </button>
        <button
          type="button"
          onClick={another}
          className="rounded-md bg-[var(--reader-chip)] px-[18px] py-[9px] text-[14.5px] text-[var(--ink-soft)] hover:text-[var(--ink)]"
        >
          Another
        </button>
        <Quiet onClick={saveForLater} hidden={saved}>
          Save for later
        </Quiet>
        <SavedMark visible={saved} />
        {/* Never a total while more can still load */}
        <span className="ml-auto hidden text-[12.5px] text-[var(--ink-muted)] sm:inline">
          {index + 1} of {deck.size}
          {deck.exhausted ? "" : "+"}
        </span>
      </div>
      {saveFailed && (
        <div className="mt-3">
          <InlineError
            message="Couldn't save that article."
            onRetry={() => void saveForLater()}
          />
        </div>
      )}
    </div>
  );
}
