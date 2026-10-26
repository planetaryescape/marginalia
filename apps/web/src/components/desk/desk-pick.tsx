"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useConvex, useMutation } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { InlineError, SavedMark } from "@/components/in-place";
import { OPEN_ARTICLE, ViewTransition } from "@/components/view-transition";
import { pickTransition } from "@/lib/pick-motion";
import { isOnControl, useShortcuts } from "@/lib/shortcuts";
import { createSingleFlight } from "@/lib/suggestion-deck";
import { articleTitleName, rememberTitle } from "@/lib/title-handoff";
import { usePresented } from "@/lib/use-presented";
import { useSessionRecorder } from "@/lib/use-session-recorder";
import { type Card, useSuggestionDeck } from "@/lib/use-suggestion-deck";
import { SAVED_MS, useTimedFlag } from "@/lib/use-timed-flag";
import { invalidateTopicSearchCache } from "@/lib/use-topic-search";

/** A pick that hasn't arrived by now gets a skeleton in its place. */
export const SKELETON_DELAY_MS = 150;

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

function Cap({ show, children }: { show: boolean; children: string }) {
  return show ? (
    <kbd aria-hidden className="reader-kbd ml-2 text-[11px]">
      {children}
    </kbd>
  ) : null;
}

function Quiet({
  children,
  onClick,
  hidden,
  cap,
}: {
  children: string;
  onClick: () => void;
  hidden?: boolean;
  cap?: ReactNode;
}) {
  return (
    <button
      type="button"
      hidden={hidden}
      onClick={onClick}
      className="text-[14.5px] text-[var(--ink-soft)] underline decoration-[color-mix(in_srgb,var(--ink)_20%,transparent)] underline-offset-[3px] hover:text-[var(--ink)]"
    >
      {children}
      {cap}
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
  showKeys = false,
}: {
  showKeys?: boolean;
  minutes: number;
  sessionId?: Id<"sessions">;
  /** Back to the slot's resting state. */
  onClose: () => void;
}) {
  const router = useRouter();
  const convex = useConvex();
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
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const showSkeleton = useAfter(deck.view === "loading", SKELETON_DELAY_MS);

  // One action at a time: a second click while one is running is dropped, and
  // each action advances from the index it was clicked on.
  const [runCardAction] = useState(() => createSingleFlight());
  const visibleCard = useRef<string | null>(null);
  const { card, index } = deck;
  const articleId = card?._id;
  useEffect(() => {
    if (!articleId) return;
    // Warm only the visible pick, through the same authorized query the reader
    // subscribes to. No marks, optional AI output or licensed text are prefetched.
    convex.prewarmQuery({
      query: api.readerBootstrap.get,
      args: { articleId },
      extendSubscriptionFor: 15_000,
    });
    router.prefetch(`/read/${articleId}`);
  }, [articleId, convex, router]);
  const identity = card ? `${index}:${card._id}` : null;
  // The first card is usable immediately. Subsequent cards become actionable
  // when their entry completes, not while the previous title is still exiting.
  useEffect(() => {
    if (visibleCard.current === null && identity)
      visibleCard.current = identity;
  }, [identity]);
  const act = (task: () => Promise<void>) => {
    if (!identity || visibleCard.current !== identity) return;
    return runCardAction(task);
  };
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
      visibleCard.current = "transition";
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
      invalidateTopicSearchCache();
      recorder.record({ articleId: card._id, action: "saved" });
      setDirection(1);
      visibleCard.current = "transition";
      deck.advance(index);
    });
  };
  const readNow = () => {
    if (!card) return;
    return act(async () => {
      // The reader draws this title in the same commit, so the morph has a destination
      rememberTitle(card._id, card.title);
      const sessionQuery = recorder.open(card._id);
      if (!mounted.current || visibleCard.current !== identity) return;
      router.push(`/read/${card._id}?${sessionQuery}`, {
        transitionTypes: [OPEN_ARTICLE],
      });
    });
  };

  const previous = () => {
    if (!card || index === 0) return;
    return act(async () => {
      setSaveFailed(false);
      clearSaved();
      setDirection(-1);
      visibleCard.current = "transition";
      deck.back(index);
    });
  };

  useShortcuts(
    {
      Enter: (event) => {
        if (isOnControl(event)) return false;
        void readNow();
      },
      o: () => void readNow(),
      n: () => void another(),
      ArrowRight: () => void another(),
      ArrowLeft: () => (index === 0 ? false : void previous()),
      s: () => void saveForLater(),
    },
    deck.view === "card" && Boolean(card),
    {
      help: {
        group: "Your pick",
        keys: [
          ["Enter  o", "Read it"],
          ["n  →", "Show another"],
          ["←", "Back to the previous pick"],
          ["s", "Save it for later"],
        ],
      },
    },
  );

  const label = <p className={LABEL}>For {minutes} minutes</p>;

  if (deck.view === "loading") {
    return (
      <div role="status" aria-busy="true" className="max-w-[620px]">
        {label}
        {showSkeleton && (
          <div data-testid="pick-skeleton" aria-hidden="true">
            <div className="mt-2 text-[24px] lg:text-[30px] leading-tight">
              <div className="h-[1.25em] w-[70%] rounded bg-[var(--reader-chip)]" />
            </div>
            <div className="mt-1.5 flex h-[20.25px] items-center">
              <div className="h-3 w-[30%] rounded bg-[var(--reader-chip)]" />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
              {["Read now", "Another", "Save for later"].map((text) => (
                <div
                  key={text}
                  className="rounded-md bg-[var(--reader-chip)] px-[18px] py-[9px] text-[14.5px] text-transparent"
                >
                  {text}
                </div>
              ))}
            </div>
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
      {/* The first pick fades in; with nothing before it, it has nowhere to slide from */}
      <AnimatePresence mode="wait">
        <motion.div
          key={card._id}
          initial={{ opacity: 0, x: reduced ? 0 : direction * 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduced ? 0 : -24 }}
          transition={pickTransition(direction, reduced)}
          onAnimationComplete={() => {
            visibleCard.current = identity;
          }}
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
          <Cap show={showKeys}>o</Cap>
        </button>
        <button
          type="button"
          onClick={another}
          className="rounded-md bg-[var(--reader-chip)] px-[18px] py-[9px] text-[14.5px] text-[var(--ink-soft)] hover:text-[var(--ink)]"
        >
          Another
          <Cap show={showKeys}>n</Cap>
        </button>
        <Quiet
          onClick={saveForLater}
          hidden={saved}
          cap={<Cap show={showKeys}>s</Cap>}
        >
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
