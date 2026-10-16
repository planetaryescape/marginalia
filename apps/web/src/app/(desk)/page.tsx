"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useConvex, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { ArticleFinder } from "@/components/article-finder";
import { DeskPick } from "@/components/desk/desk-pick";
import { ContinueShortcut, DeskRest } from "@/components/desk/desk-rest";
import { QueryBoundary } from "@/components/desk/query-boundary";
import { type Fits, TimeChoices } from "@/components/desk/time-choices";
import { parseDeskLink } from "@/lib/desk-link";
import { useShortcuts } from "@/lib/shortcuts";
import { useAltHint } from "@/lib/use-alt-hint";

// A repeat of the same choice this soon is a double click, not a toggle off
export const DOUBLE_CHOICE_MS = 400;
// How long a prefetched answer stays subscribed after hover or focus
const PREFETCH_FOR_MS = 15_000;

type Chosen = {
  minutes: number;
  /** A new choice is a new deck and a new session, even for the same time. */
  key: number;
  /** Set when a deep link brought a session that already exists. */
  sessionId?: Id<"sessions">;
};

const TIME_KEYS = { "1": 5, "2": 10, "3": 20, "4": 30 } as const;

/** Counts of what fits each window, for the tooltips only. */
function TimesWithFits(props: Omit<Parameters<typeof TimeChoices>[0], "fits">) {
  const overview = useQuery(api.home.overview, {});
  const fits: Fits | undefined = overview?.fits;
  return <TimeChoices {...props} fits={fits} />;
}

function Desk() {
  const convex = useConvex();
  const params = useSearchParams();
  const showKeys = useAltHint();
  const link = parseDeskLink(params);
  const keyCounter = useRef(0);
  const lastChoice = useRef<{ minutes: number; at: number } | null>(null);

  const fromLink = (): Chosen | null =>
    link ? { ...link, key: ++keyCounter.current } : null;
  const [chosen, setChosen] = useState<Chosen | null>(fromLink);
  // A new deep link (such as the wordmark back to `/`) replaces what was chosen
  const [seenUrl, setSeenUrl] = useState(params.toString());
  if (seenUrl !== params.toString()) {
    setSeenUrl(params.toString());
    setChosen(fromLink());
  }

  const choose = (minutes: number) => {
    const now = Date.now();
    const last = lastChoice.current;
    if (last?.minutes === minutes && now - last.at < DOUBLE_CHOICE_MS) return;
    lastChoice.current = { minutes, at: now };
    setChosen(
      chosen?.minutes === minutes
        ? null
        : { minutes, key: ++keyCounter.current },
    );
  };

  // prewarmQuery holds a live subscription, which is what the pick's own
  // useQuery reads from; a one-off client.query would not fill that cache
  const prefetch = (requestedMinutes: number) =>
    convex.prewarmQuery({
      query: api.suggestions.forWindow,
      args: { requestedMinutes },
      extendSubscriptionFor: PREFETCH_FOR_MS,
    });

  useShortcuts({
    "1": () => choose(TIME_KEYS["1"]),
    "2": () => choose(TIME_KEYS["2"]),
    "3": () => choose(TIME_KEYS["3"]),
    "4": () => choose(TIME_KEYS["4"]),
    Escape: () => setChosen(null),
  });

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const timeProps = {
    chosen: chosen?.minutes ?? null,
    showKeys,
    onChoose: choose,
    onIntent: prefetch,
  };

  return (
    <main className="mx-auto w-full max-w-[1180px] px-5 md:px-10 pt-[clamp(0.75rem,4vh,3.5rem)] pb-[clamp(1rem,3vh,2rem)] grid gap-y-[clamp(1rem,3vh,1.75rem)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-[60px]">
      <div className="lg:col-start-1 lg:row-start-1">
        <p className="text-[13px] text-[var(--ink-muted)] [@media(max-height:699px)]:hidden">
          {today}
        </p>
        <h1 className="mt-3 font-serif font-light tracking-tight leading-[1.02] text-[clamp(2.5rem,6vw,4.5rem)]">
          How much time
          <br className="hidden sm:block" /> do you have?
        </h1>
      </div>

      <div className="flex flex-col gap-5 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:pt-[clamp(4rem,16vh,9rem)]">
        <QueryBoundary fallback={() => <TimeChoices {...timeProps} />}>
          <TimesWithFits {...timeProps} />
        </QueryBoundary>
        <ArticleFinder showKey={showKeys} />
      </div>

      <section
        aria-label="Your pick"
        className="min-h-[7rem] border-t border-[var(--reader-border)] pt-[22px] lg:col-start-1 lg:row-start-2"
      >
        <QueryBoundary fallback={() => null}>
          <ContinueShortcut />
        </QueryBoundary>
        {chosen ? (
          <DeskPick
            key={chosen.key}
            minutes={chosen.minutes}
            sessionId={chosen.sessionId}
            onClose={() => setChosen(null)}
          />
        ) : (
          <QueryBoundary fallback={(retry) => <SlotFailure retry={retry} />}>
            <DeskRest showKeys={showKeys} />
          </QueryBoundary>
        )}
      </section>
    </main>
  );
}

function SlotFailure({ retry }: { retry: () => void }) {
  return (
    <p className="text-[15px] text-[var(--ink-soft)]">
      Couldn't load your desk.{" "}
      <button
        type="button"
        onClick={retry}
        className="underline decoration-[var(--pencil-rule)] underline-offset-[3px] hover:text-[var(--ink)]"
      >
        Retry
      </button>
    </p>
  );
}

export default function DeskRoute() {
  // useSearchParams needs a Suspense boundary for static rendering
  return (
    <Suspense fallback={null}>
      <Desk />
    </Suspense>
  );
}
