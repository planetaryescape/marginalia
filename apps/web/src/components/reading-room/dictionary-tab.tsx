"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Doc } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Skeleton, SkeletonBar } from "@/components/in-place";
import { Keycap } from "@/components/keycap";
import {
  type Entry,
  groupLookups,
  guideWords,
  searchEntries,
  splitColumns,
  splitSense,
} from "@/lib/dictionary";
import { stepNav, useListKeys } from "@/lib/list-nav";
import { useShortcuts } from "@/lib/shortcuts";
import { useLocalToday } from "./use-local-today";

const longDateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const shortDateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
function dateLabel(at: number) {
  return (
    new Date(at).getFullYear() === new Date().getFullYear()
      ? shortDateFormat
      : longDateFormat
  ).format(at);
}

function jumpToLetter(letter: string) {
  const entry = document.getElementById(`letter-${letter}`);
  if (!entry) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  entry.scrollIntoView({
    block: "nearest",
    behavior: reduced ? "auto" : "smooth",
  });
  entry.focus({ preventScroll: true });
  entry.removeAttribute("data-washing");
  void entry.offsetWidth;
  entry.setAttribute("data-washing", "");
  window.setTimeout(() => entry.removeAttribute("data-washing"), 800);
}

function Loading() {
  return (
    <Skeleton label="Loading your dictionary">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="border-b border-[var(--reader-border)] py-4">
          <SkeletonBar className="h-5 w-[20%]" />
          <SkeletonBar className="mt-2 h-4 w-[65%]" />
        </div>
      ))}
    </Skeleton>
  );
}

function SenseLines({ entry, offset = 0 }: { entry: Entry; offset?: number }) {
  return entry.senses.map((sense, i) => (
    <p key={sense.id} className="mt-1">
      <span className="mr-1 font-sans text-[11px] text-[var(--reader-muted)]">
        {offset + i + 1}
      </span>
      {sense.partOfSpeech && (
        <span className="mr-1 italic text-[var(--reader-muted)]">
          {sense.partOfSpeech}
        </span>
      )}
      {sense.text}
      <span className="mt-0.5 block text-sm italic text-[var(--reader-muted)]">
        “{sense.sentence}”
        <span className="font-sans text-xs not-italic text-[var(--reader-fg-soft)]">
          {" · "}
          {sense.href ? (
            <Link
              href={sense.href}
              data-nav-item
              className="underline decoration-[var(--pencil-rule)] underline-offset-[3px]"
            >
              {sense.articleTitle ?? "Open article"}
            </Link>
          ) : (
            <span>Article no longer in your library</span>
          )}
          {" · "}
          {dateLabel(sense.createdAt)}
        </span>
      </span>
    </p>
  ));
}

/** Page replacement, not accumulation: even a headword with thousands of
 * occurrences only mounts four at once. Closing it drops the subscription. */
function SensePages({ wordKey }: { wordKey: string }) {
  const [cursors, setCursors] = useState<
    { cursor: string | null; offset: number }[]
  >([{ cursor: null, offset: 0 }]);
  const current = cursors[cursors.length - 1];
  const result = useQuery(api.dictionary.senses, {
    wordKey,
    paginationOpts: { numItems: 4, cursor: current.cursor },
  });
  const entry = useMemo(
    () => (result ? groupLookups(result.page)[0] : undefined),
    [result],
  );
  return (
    <div>
      {!result ? (
        <p role="status">Loading senses…</p>
      ) : entry ? (
        <SenseLines entry={entry} offset={current.offset} />
      ) : (
        <p>No senses remain.</p>
      )}
      <div className="mt-2 flex gap-4 font-sans text-xs">
        {cursors.length > 1 && (
          <button
            type="button"
            onClick={() => setCursors((c) => c.slice(0, -1))}
          >
            Previous senses
          </button>
        )}
        {result && !result.isDone && (
          <button
            type="button"
            onClick={() =>
              setCursors((c) => [
                ...c,
                {
                  cursor: result.continueCursor,
                  offset: current.offset + result.page.length,
                },
              ])
            }
          >
            Next senses
          </button>
        )}
      </div>
    </div>
  );
}

function Headword({
  head,
  anchor,
  open,
  onOpen,
}: {
  head: Doc<"dictionaryHeadwords">;
  anchor: boolean;
  open: boolean;
  onOpen: () => void;
}) {
  const preview = splitSense(head.preview);
  return (
    <article
      id={anchor ? `letter-${head.letter}` : undefined}
      tabIndex={anchor ? -1 : undefined}
      className="letter-jump -mx-2 mb-5 scroll-mt-16 rounded px-2 font-serif text-[15px] leading-normal text-[var(--reader-fg-soft)] outline-none"
    >
      <h3 className="text-[17px] font-semibold text-[var(--reader-fg)]">
        {head.wordKey}
      </h3>
      {!open && (
        <p className="mt-1">
          {preview.partOfSpeech && (
            <span className="mr-1 italic text-[var(--reader-muted)]">
              {preview.partOfSpeech}
            </span>
          )}
          {preview.text}
        </p>
      )}
      <button
        type="button"
        data-nav-item
        aria-expanded={open}
        onClick={onOpen}
        className="mt-1 font-sans text-xs text-[var(--reader-muted)] underline underline-offset-2"
      >
        {open
          ? "Close senses"
          : `Open ${head.occurrences === 1 ? "sense" : `${head.occurrences} senses`}`}
      </button>
      {open && <SensePages key={head.wordKey} wordKey={head.wordKey} />}
    </article>
  );
}

function Guide({ entries }: { entries: Entry[] }) {
  const guide = guideWords(entries);
  return guide ? (
    <h2 className="mb-3 flex items-baseline justify-between gap-4 border-b border-[var(--reader-border-strong)] pb-1 font-serif text-[13px] font-semibold uppercase tracking-[0.2em] text-[var(--reader-muted)]">
      <span className="shrink-0">{guide[0].slice(0, 2)}</span>
      <span className="min-w-0 truncate">
        {guide[0] === guide[1] ? guide[0] : `${guide[0]} — ${guide[1]}`}
      </span>
    </h2>
  ) : null;
}

/** Keying this view by filter resets page cursors and ignores stale results. */
function HeadwordPages({
  query,
  letter,
  onLetter,
}: {
  query: string;
  letter?: string;
  onLetter: (letter: string) => void;
}) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [opened, setOpened] = useState<string | null>(null);
  const result = useQuery(api.dictionary.headwords, {
    query,
    letter,
    after: cursors[cursors.length - 1],
  });
  const pendingJump = useRef(letter);
  useEffect(() => {
    if (result && pendingJump.current) {
      jumpToLetter(pendingJump.current);
      pendingJump.current = undefined;
    }
  }, [result]);
  if (!result) return <Loading />;
  const entries: Entry[] = result.page.map((h) => ({
    key: h.wordKey,
    headword: h.wordKey,
    letter: h.letter,
    senses: [],
  }));
  const [left, right] = splitColumns(entries);
  const heads = new Map(result.page.map((h) => [h.wordKey, h]));
  const first = new Map<string, string>();
  for (const entry of entries)
    if (!first.has(entry.letter)) first.set(entry.letter, entry.key);
  return (
    <div>
      {result.page.length === 0 ? (
        <p className="py-6 text-sm text-[var(--reader-muted)]">
          {result.done
            ? query.trim()
              ? cursors.length > 1
                ? "No more matches."
                : `No word or sense${letter ? ` under ${letter}` : ""} contains “${query.trim()}”.`
              : "No words here yet."
            : "No matches in this part of your dictionary. Keep searching to check the rest."}
        </p>
      ) : (
        <div className="grid gap-x-7 md:grid-cols-2">
          {[left, right].map((column, i) => (
            <div key={i === 0 ? "left" : "right"}>
              <Guide entries={column} />
              {column.map((entry) => {
                const head = heads.get(entry.key);
                return head ? (
                  <Headword
                    key={entry.key}
                    head={head}
                    anchor={first.get(entry.letter) === entry.key}
                    open={opened === entry.key}
                    onOpen={() =>
                      setOpened(opened === entry.key ? null : entry.key)
                    }
                  />
                ) : null;
              })}
            </div>
          ))}
        </div>
      )}
      <div className="mt-5 flex gap-5 text-sm text-[var(--reader-muted)]">
        {cursors.length > 1 && (
          <button
            type="button"
            onClick={() => {
              setOpened(null);
              setCursors((c) => c.slice(0, -1));
            }}
          >
            Previous page
          </button>
        )}
        {!result.done && (
          <button
            type="button"
            onClick={() => {
              setOpened(null);
              setCursors((c) => [...c, result.after]);
            }}
          >
            {query.trim() ? "Keep searching" : "Next words"}
          </button>
        )}
        {letter && (
          <button type="button" onClick={() => onLetter("")}>
            All letters
          </button>
        )}
      </div>
      {query.trim() && !result.done && (
        <p className="mt-2 text-xs text-[var(--reader-muted)]">
          Search is not complete. Each step checks up to 100 indexed sense
          chunks.
        </p>
      )}
    </div>
  );
}

/** Backend-first migration fallback: initial content remains available without
 * draining history. Preparation is always an explicit user/admin operation. */
function LegacyPage({ query }: { query: string }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const result = useQuery(api.dictionary.page, {
    paginationOpts: { numItems: 40, cursor: cursors[cursors.length - 1] },
  });
  const entries = useMemo(
    () => (result ? searchEntries(groupLookups(result.page), query) : []),
    [result, query],
  );
  if (!result) return <Loading />;
  return (
    <div>
      <p className="mb-4 text-xs text-[var(--reader-muted)]">
        Preparing your alphabetic dictionary. These are recent lookups; this
        filter only checks the current page.
      </p>
      {entries.map((entry) => (
        <article key={entry.key} className="mb-5 font-serif">
          <h3 className="font-semibold">{entry.headword}</h3>
          <SenseLines entry={entry} />
        </article>
      ))}
      <div className="flex gap-5 text-sm">
        {cursors.length > 1 && (
          <button
            type="button"
            onClick={() => setCursors((c) => c.slice(0, -1))}
          >
            Newer lookups
          </button>
        )}
        {!result.isDone && (
          <button
            type="button"
            onClick={() => setCursors((c) => [...c, result.continueCursor])}
          >
            Older lookups
          </button>
        )}
      </div>
    </div>
  );
}

function MonthCount({
  monthStart,
  monthEnd,
  count,
  complete,
  cursor,
  ready,
}: {
  monthStart: number;
  monthEnd: number;
  count: number;
  complete: boolean;
  cursor: string | null;
  ready: boolean;
}) {
  const [requested, setRequested] = useState<{
    cursor: string;
    before: number;
  } | null>(null);
  const result = useQuery(
    api.dictionary.monthCount,
    requested
      ? {
          monthStart,
          monthEnd,
          paginationOpts: { cursor: requested.cursor, numItems: 256 },
        }
      : "skip",
  );
  const total = requested ? requested.before + (result?.count ?? 0) : count;
  const done = requested ? result?.done === true : complete;
  const next = requested ? result?.cursor : cursor;
  return (
    <span>
      {done ? "" : "at least "}
      {total} this month
      {ready && !done && (
        <button
          type="button"
          className="ml-2 underline underline-offset-2"
          disabled={!!requested && !result}
          onClick={() => {
            if (next) setRequested({ cursor: next, before: total });
          }}
        >
          {requested && !result ? "Counting…" : "Count more"}
        </button>
      )}
    </span>
  );
}

export function DictionaryTab() {
  const [query, setQuery] = useState("");
  const [letter, setLetter] = useState("");
  const [letterJump, setLetterJump] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const prepare = useMutation(api.dictionary.preparePage);
  const searchRef = useRef<HTMLInputElement>(null);
  useShortcuts({ "/": () => searchRef.current?.focus() }, true, {
    help: { group: "Dictionary", keys: [["/", "Find a word"]] },
  });
  useListKeys();
  const today = useLocalToday();
  const [year, month] = today.split("-").map(Number);
  const monthStart = new Date(year, month - 1, 1).getTime();
  const monthEnd = new Date(year, month, 1).getTime();
  const summary = useQuery(api.dictionary.summary, {
    monthStart,
    monthEnd,
  });
  const validSearch = new TextEncoder().encode(query).length <= 256;
  if (!summary) return <Loading />;
  if (summary.complete && summary.total === 0)
    return (
      <p className="py-10 text-sm text-[var(--reader-muted)]">
        No words yet. Define a word while reading and it will be kept here, with
        the sentence you met it in.
      </p>
    );
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="relative max-w-[420px] flex-1">
          <input
            ref={searchRef}
            type="search"
            aria-keyshortcuts="/"
            aria-label="Find a word"
            placeholder="Find a word"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLetter("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") e.currentTarget.blur();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                e.currentTarget.blur();
                stepNav(1);
              }
            }}
            className="app-input w-full"
          />
          <Keycap className="absolute right-3 top-1/2 -translate-y-1/2">
            /
          </Keycap>
        </div>
        <p className="text-[13px] text-[var(--reader-muted)]">
          {summary.complete ? "" : "At least "}
          {summary.total} {summary.total === 1 ? "word" : "words"} ·{" "}
          <MonthCount
            key={`${today.slice(0, 7)}-${summary.total}-${summary.complete}-${summary.month}`}
            monthStart={monthStart}
            monthEnd={monthEnd}
            count={summary.month}
            complete={summary.monthComplete}
            cursor={summary.monthCursor}
            ready={summary.complete}
          />
        </p>
      </div>
      {!summary.complete && (
        <div className="mb-4 text-sm text-[var(--reader-muted)]">
          <button
            type="button"
            disabled={preparing}
            onClick={async () => {
              setPreparing(true);
              setError("");
              try {
                await prepare({});
              } catch {
                setError("Couldn't prepare the next page. Please try again.");
              } finally {
                setPreparing(false);
              }
            }}
          >
            {preparing ? "Preparing…" : "Prepare next 16 lookups"}
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
      {!validSearch ? (
        <p role="alert">Use a search of at most 256 UTF-8 bytes.</p>
      ) : !summary.complete ? (
        <LegacyPage key={query} query={query} />
      ) : (
        <div className="grid gap-x-7 md:grid-cols-[2.25rem_1fr]">
          <nav
            aria-label="Jump to a letter"
            className="sticky top-0 z-10 mb-4 flex gap-0.5 overflow-x-auto bg-[var(--reader-bg)] py-1 font-serif text-xs font-semibold md:top-4 md:mb-0 md:flex-col md:self-start md:overflow-visible md:bg-transparent md:py-0"
          >
            {summary.letters
              .filter((l) => l.letter !== "#" || l.hasWords)
              .map(({ letter: value, hasWords }) => (
                <button
                  key={value}
                  type="button"
                  disabled={!hasWords}
                  aria-pressed={letter === value}
                  onClick={() => {
                    setLetter(value);
                    setLetterJump((n) => n + 1);
                  }}
                  className="flex h-[22px] w-7 shrink-0 items-center justify-center rounded-l border border-r-0 border-[var(--reader-border-strong)] text-[var(--reader-fg)] disabled:opacity-35 md:w-[26px]"
                >
                  {value}
                </button>
              ))}
          </nav>
          <HeadwordPages
            key={`${query}\0${letter}\0${letterJump}`}
            query={query}
            letter={letter || undefined}
            onLetter={setLetter}
          />
        </div>
      )}
    </div>
  );
}
