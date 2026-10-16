"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUp, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CompanionAnswer } from "@/components/companion-answer";
import {
  FinishedShelf,
  LovedShelf,
  SavedShelf,
  type ShelfId,
} from "@/components/library-shelves";
import { UpNextShelf } from "@/components/up-next-shelf";
import { ReaderRequestError, streamFromConvex } from "@/lib/companion";
import { useShortcuts } from "@/lib/shortcuts";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Two plain phrases, not buttons: they ask the question for you when clicked. */
const EXAMPLES = ["what did I love recently?", "a short read for tonight"];

interface Turn {
  role: "user" | "assistant";
  content: string;
}

function Librarian() {
  const searchParams = useSearchParams();
  const reduced = useReducedMotion();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const askedFromUrl = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useShortcuts({ "/": () => inputRef.current?.focus() });

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || streaming) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const history = turns;
      setTurns([
        ...history,
        { role: "user", content: q },
        { role: "assistant", content: "" },
      ]);
      setDraft("");
      setError(null);
      setStreaming(true);
      let answer = "";
      try {
        await streamFromConvex(
          "/api/library",
          { question: q, history },
          {
            signal: controller.signal,
            onModel: () => {},
            onText: (chunk) => {
              answer += chunk;
              setTurns((t) => [
                ...t.slice(0, -1),
                { role: "assistant", content: answer },
              ]);
            },
          },
        );
        if (!answer.trim()) setError("No answer came back. Try asking again.");
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof ReaderRequestError && e.code
              ? e.message
              : "Couldn't reach the librarian. Try again.",
          );
      } finally {
        setStreaming(false);
      }
    },
    [streaming, turns],
  );

  // Arriving from the home page's "ask your library" line. Deferred so React's
  // development double-run of effects cancels the first attempt instead of
  // aborting a request already in flight.
  const askRef = useRef(ask);
  useLayoutEffect(() => {
    askRef.current = ask;
  }, [ask]);
  useEffect(() => {
    const q = searchParams.get("q");
    if (!q || askedFromUrl.current) return;
    const timer = window.setTimeout(() => {
      askedFromUrl.current = true;
      askRef.current(q);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [searchParams]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const length = turns.reduce((n, t) => n + t.content.length, 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the answer as it streams in
  useEffect(() => {
    if (turns.length > 2)
      endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [length, turns.length]);

  return (
    <div className="min-w-0">
      <motion.h1
        initial={reduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: EASE }}
        className="font-serif font-light tracking-tight leading-[1.05] text-[clamp(2.25rem,5vw,3.75rem)]"
      >
        What are you looking for?
      </motion.h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--reader-fg-soft)]">
        Find something you half-remember, recall what you thought of it, or pick
        your next read from what you haven&apos;t opened yet.
      </p>

      {turns.length > 0 && (
        <div className="mt-10 space-y-8">
          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <p
                key={i}
                className="font-serif text-[21px] leading-snug text-[var(--reader-fg)]"
              >
                {turn.content}
              </p>
            ) : turn.content ? (
              <div
                key={i}
                className="pl-4 border-l-2 border-[var(--pencil-rule)] max-w-2xl"
              >
                <CompanionAnswer
                  text={turn.content}
                  lead
                  streaming={streaming && i === turns.length - 1}
                  onJump={() => {}}
                />
              </div>
            ) : (
              <div
                key={i}
                className="pl-4 border-l-2 border-[var(--pencil-rule)] max-w-2xl space-y-2 py-1"
                role="status"
                aria-label="Looking through your library"
              >
                <div className="companion-shimmer h-3 w-[86%] rounded" />
                <div className="companion-shimmer h-3 w-[70%] rounded" />
                <div className="companion-shimmer h-3 w-[48%] rounded" />
              </div>
            ),
          )}
          {error && (
            <p className="text-[13px] text-annotation-tension">{error}</p>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
        className="focus-frame mt-8 flex items-center gap-2 h-12 max-w-2xl rounded-full pl-5 pr-1.5 bg-[var(--reader-chip)] ring-1 ring-[var(--reader-border)] focus-within:ring-[var(--reader-focus)] transition-shadow"
      >
        <input
          ref={inputRef}
          value={draft}
          aria-keyshortcuts="/"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            turns.length
              ? "Ask a follow-up"
              : "That piece about cows last month… or something about science"
          }
          aria-label="Ask your library"
          className="flex-1 min-w-0 bg-transparent text-[15px] outline-none placeholder:text-[var(--reader-muted)]"
        />
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              setTurns([]);
              setError(null);
            }}
            title="Start over"
            aria-label="Start over"
            className="w-11 h-11 md:w-9 md:h-9 shrink-0 flex items-center justify-center rounded-full text-[var(--reader-muted)] hover:text-[var(--reader-fg)]"
          >
            <RotateCcw size={15} />
          </button>
        )}
        <button
          type="submit"
          disabled={!draft.trim() || streaming}
          aria-label="Ask"
          className="w-11 h-11 md:w-9 md:h-9 shrink-0 flex items-center justify-center rounded-full bg-[var(--ink)] text-[var(--reader-bg)] disabled:opacity-30 transition-opacity"
        >
          <ArrowUp size={16} strokeWidth={2.5} />
        </button>
      </form>

      {turns.length === 0 && (
        <p className="mt-3 text-[13px] text-[var(--reader-muted)]">
          Try{" "}
          <button
            type="button"
            onClick={() => ask(EXAMPLES[0])}
            className="py-2 text-[var(--reader-fg-soft)] underline decoration-[var(--reader-border-strong)] underline-offset-[3px] hover:text-[var(--reader-fg)]"
          >
            “{EXAMPLES[0]}”
          </button>{" "}
          or{" "}
          <button
            type="button"
            onClick={() => ask(EXAMPLES[1])}
            className="py-2 text-[var(--reader-fg-soft)] underline decoration-[var(--reader-border-strong)] underline-offset-[3px] hover:text-[var(--reader-fg)]"
          >
            “{EXAMPLES[1]}”
          </button>
        </p>
      )}
      <div ref={endRef} />
    </div>
  );
}

const SHELVES: ShelfId[] = ["saved", "loved", "finished"];

/** The shelf named in `?shelf=`; anything else is Up next. */
function shelfFromUrl(value: string | null): ShelfId | "up-next" {
  return SHELVES.find((shelf) => shelf === value) ?? "up-next";
}

function Shelves() {
  const shelf = shelfFromUrl(useSearchParams().get("shelf"));
  const overview = useQuery(api.home.overview, {});
  const saved = useQuery(api.savedArticles.count, {});
  const loved = useQuery(api.lovedArticles.listAll, {});
  const finished = useQuery(api.impressions.listRecent, {});
  const tabs: {
    id: ShelfId | "up-next";
    label: string;
    href: string;
    count: number | null;
  }[] = [
    {
      id: "up-next",
      label: "Up next",
      href: "/library",
      count: overview?.waiting ?? null,
    },
    {
      id: "saved",
      label: "Saved",
      href: "/library?shelf=saved",
      count: saved ?? null,
    },
    {
      id: "loved",
      label: "Loved",
      href: "/library?shelf=loved",
      count: loved?.length ?? null,
    },
    {
      id: "finished",
      label: "Finished",
      href: "/library?shelf=finished",
      count: finished?.length ?? null,
    },
  ];

  return (
    <>
      <nav
        aria-label="Shelves"
        className="mt-10 flex flex-wrap gap-x-6 gap-y-1 border-b border-[var(--reader-border)] pb-2.5 text-[14.5px] text-[var(--reader-muted)]"
      >
        {tabs.map((tab) => {
          const current = tab.id === shelf;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              scroll={false}
              aria-current={current ? "page" : undefined}
              className="py-1 hover:text-[var(--reader-fg)] aria-[current=page]:font-medium aria-[current=page]:text-[var(--reader-fg)]"
            >
              {tab.label}
              {tab.count !== null && (
                <small className="ml-1.5 text-[12px] font-normal tabular-nums text-[var(--reader-muted)]">
                  {tab.count}
                </small>
              )}
            </Link>
          );
        })}
      </nav>
      {shelf === "up-next" && <UpNextShelf />}
      {shelf === "saved" && <SavedShelf />}
      {shelf === "loved" && <LovedShelf />}
      {shelf === "finished" && <FinishedShelf />}
    </>
  );
}

export default function LibraryPage() {
  return (
    <main className="mx-auto w-full max-w-[1180px] px-5 md:px-10 pt-[clamp(0.75rem,4vh,3rem)] pb-10">
      {/* useSearchParams needs a Suspense boundary for static rendering */}
      <Suspense fallback={null}>
        <div className="min-w-0">
          <Librarian />
          <Shelves />
        </div>
      </Suspense>
    </main>
  );
}
