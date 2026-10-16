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
import { RATINGS } from "@/components/impression-panel";
import { UpNextShelf } from "@/components/up-next-shelf";
import { ReaderRequestError, streamFromConvex } from "@/lib/companion";
import { useShortcuts } from "@/lib/shortcuts";

const EASE = [0.22, 1, 0.36, 1] as const;

const SUGGESTIONS = [
  "Something about science",
  "What did I love recently?",
  "A short read for tonight",
  "What have I started and not finished?",
];

interface Turn {
  role: "user" | "assistant";
  content: string;
}

function RatingMarks({ rating }: { rating: number }) {
  return (
    <span
      className="flex gap-[3px]"
      role="img"
      aria-label={RATINGS[rating - 1]}
    >
      {RATINGS.map((label, i) => (
        <span
          key={label}
          className="w-[7px] h-[7px] rounded-[2px]"
          style={{
            background:
              i < rating ? "var(--pen)" : "var(--reader-border-strong)",
          }}
        />
      ))}
    </span>
  );
}

function Impressions() {
  const impressions = useQuery(api.impressions.listRecent, {});
  if (impressions === undefined) return null;

  const byMonth = new Map<string, typeof impressions>();
  for (const item of impressions) {
    const month = new Date(item.updatedAt).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    byMonth.set(month, [...(byMonth.get(month) ?? []), item]);
  }

  return (
    <section aria-label="Your impressions">
      <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--reader-muted)]">
        Your impressions
      </h2>
      {impressions.length === 0 ? (
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--reader-muted)]">
          Rate articles at the end of each read, or with the star at the top.
          Your ratings and what stayed with you gather here, and the librarian
          uses them.
        </p>
      ) : (
        [...byMonth.entries()].map(([month, items]) => (
          <div key={month} className="mt-5">
            <p className="font-serif text-[15px] text-[var(--reader-fg-soft)]">
              {month}
            </p>
            <ul className="mt-2 space-y-3">
              {items.map((item) => (
                <li
                  key={item._id}
                  className="pl-3 border-l-2 border-[var(--reader-border)]"
                >
                  <Link
                    href={`/read/${item.articleId}`}
                    className="font-serif text-[15.5px] leading-snug hover:underline hover:decoration-[var(--pencil-rule)] underline-offset-4 transition-colors"
                  >
                    {item.title}
                  </Link>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[var(--reader-muted)]">
                    {item.rating && <RatingMarks rating={item.rating} />}
                    {item.rating && <span>{RATINGS[item.rating - 1]}</span>}
                    {item.tags.length > 0 && (
                      <span>· {item.tags.join(", ")}</span>
                    )}
                  </p>
                  {item.note && (
                    <p className="mt-1 font-serif italic text-[14px] leading-snug text-[var(--reader-fg-soft)] line-clamp-2">
                      “{item.note}”
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
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
        Ask your library
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
        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => ask(suggestion)}
              className="min-h-11 md:min-h-8 px-3.5 py-1 rounded-full text-left text-[13px] text-[var(--reader-fg-soft)] ring-1 ring-[var(--reader-border)] hover:ring-[var(--reader-border-strong)] hover:text-[var(--reader-fg)] transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

export default function LibraryPage() {
  return (
    <main className="mx-auto w-full max-w-[1180px] px-5 md:px-10 pt-[clamp(0.75rem,4vh,3rem)] pb-10 grid gap-14 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-[72px]">
      {/* useSearchParams needs a Suspense boundary for static rendering */}
      <Suspense fallback={null}>
        <div className="min-w-0">
          <Librarian />
          <UpNextShelf />
        </div>
      </Suspense>
      <aside className="lg:pt-3">
        <Impressions />
      </aside>
    </main>
  );
}
