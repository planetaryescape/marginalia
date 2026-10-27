"use client";
import type { BibleSuggestion, ReadingScope } from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { InlineError, Skeleton, SkeletonBar } from "@/components/in-place";
import { isOnControl, useShortcuts } from "@/lib/shortcuts";
import { ReadingScopeControl } from "./reading-scope";

export function BibleDiscovery({
  preferences,
}: {
  preferences?: { enabled: boolean; scope: ReadingScope; translation: string };
}) {
  if (!preferences?.enabled) return null;
  return (
    <section aria-label="Bible discovery" className="space-y-4">
      <ReadingScopeControl scope={preferences.scope} />
    </section>
  );
}

/** Time-based Bible pick, rendered only in the desk's shared Your pick slot. */
export function BibleTimePick({ minutes }: { minutes: number }) {
  const suggest = useAction(api.actions.bible.suggest);
  const openReading = useAction(api.actions.bible.openReading);
  const router = useRouter();
  const [state, setState] = useState<
    | { status: "loading"; passages: BibleSuggestion[] }
    | { status: "ready"; passages: BibleSuggestion[] }
    | { status: "error"; passages: BibleSuggestion[] }
  >({ status: "loading", passages: [] });
  const [position, setPosition] = useState(0);
  const [opening, setOpening] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const passage = state.passages[position];

  useEffect(() => {
    const request = ++generation.current;
    setState({ status: "loading", passages: [] });
    setPosition(0);
    void suggest({ question: "", minutes }).then(
      (result) => {
        if (generation.current === request)
          setState({ status: "ready", passages: result.passages });
      },
      () => {
        if (generation.current === request)
          setState({ status: "error", passages: [] });
      },
    );
    return () => {
      generation.current++;
    };
  }, [minutes, retry, suggest]);

  const readNow = () => {
    if (!passage || opening) return;
    const request = generation.current;
    setOpening(true);
    void openReading({ reference: passage.reference })
      .then(
        (id) => {
          if (generation.current === request) router.push(`/read/${id}`);
        },
        () => {
          if (generation.current === request)
            setState({ status: "error", passages: state.passages });
        },
      )
      .finally(() => setOpening(false));
  };
  const another = () =>
    setPosition((index) => Math.min(index + 1, state.passages.length - 1));
  const previous = () => setPosition((index) => Math.max(index - 1, 0));

  useShortcuts(
    {
      Enter: (event) => (isOnControl(event) ? false : void readNow()),
      n: () => another(),
      ArrowRight: () => another(),
      ArrowLeft: () => (position === 0 ? false : void previous()),
    },
    state.status === "ready" && Boolean(passage),
    {
      help: {
        group: "Your pick",
        keys: [
          ["Enter", "Read this passage"],
          ["n  →", "Another passage"],
          ["←", "Previous passage"],
        ],
      },
    },
  );

  return (
    <div className="max-w-[620px]" aria-live="polite">
      <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">
        For {minutes} minutes · Bible
      </p>
      {state.status === "loading" && (
        <Skeleton label="Finding a passage for your time" className="mt-2">
          <SkeletonBar className="h-6 w-[60%]" />
          <SkeletonBar className="mt-3 h-3.5 w-[30%]" />
        </Skeleton>
      )}
      {state.status === "error" && (
        <InlineError
          message="Couldn't find a Bible passage for this time."
          onRetry={() => setRetry((value) => value + 1)}
        />
      )}
      {state.status === "ready" && !passage && (
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          No Bible passage fits {minutes} minutes. Choose another time.
        </p>
      )}
      {passage && state.status === "ready" && (
        <>
          <h2 className="mt-2 font-serif text-[24px] lg:text-[30px] leading-tight text-[var(--ink)]">
            {passage.title}
          </h2>
          <p className="mt-1.5 text-[13.5px] text-[var(--ink-muted)]">
            {passage.reference} · ~{passage.minutes} min
          </p>
          <p className="mt-3 text-[15px] text-[var(--pencil)]">
            {passage.reason}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              disabled={opening}
              onClick={readNow}
              className="rounded-md bg-[var(--ink)] px-[18px] py-[9px] text-[14.5px] text-[var(--reader-bg)]"
            >
              {opening ? "Opening…" : "Read now"}
            </button>
            {position > 0 && (
              <button
                type="button"
                onClick={previous}
                className="text-[14.5px] underline"
              >
                Previous
              </button>
            )}
            {position + 1 < state.passages.length && (
              <button
                type="button"
                onClick={another}
                className="rounded-md bg-[var(--reader-chip)] px-[18px] py-[9px] text-[14.5px] text-[var(--ink-soft)]"
              >
                Another
              </button>
            )}
            <span className="ml-auto text-[12.5px] text-[var(--ink-muted)]">
              {position + 1} of {state.passages.length}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
