"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { usePaginatedQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  DICTIONARY_CAP,
  type Entry,
  groupLookups,
  guideWords,
  type LookupRow,
  searchEntries,
  splitColumns,
  thumbIndex,
  wordsThisMonth,
} from "@/lib/dictionary";

const PAGE = 40;

function dateLabel(at: number) {
  const d = new Date(at);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(d);
}

function EntryView({ entry, anchor }: { entry: Entry; anchor: boolean }) {
  const numbered = entry.senses.length > 1;
  return (
    <article
      id={anchor ? `letter-${entry.letter}` : undefined}
      className="mb-5 scroll-mt-16 font-serif text-[15px] leading-normal text-[var(--reader-fg-soft)]"
    >
      <h3 className="text-[17px] font-semibold text-[var(--reader-fg)]">
        {entry.headword}
      </h3>
      {entry.senses.map((sense, i) => (
        <p key={sense.id} className="mt-1">
          {numbered && (
            <span className="mr-1 font-sans text-[11px] font-medium text-[var(--reader-muted)]">
              {i + 1}
            </span>
          )}
          {sense.partOfSpeech && (
            <span className="mr-1 italic text-[var(--reader-muted)]">
              {sense.partOfSpeech}
            </span>
          )}
          {sense.text}
          <span className="mt-0.5 block text-sm italic text-[var(--reader-muted)]">
            “{sense.sentence}”
            <span className="not-italic font-sans text-xs text-[var(--reader-fg-soft)]">
              {" · "}
              {sense.href && sense.articleTitle ? (
                <Link
                  href={sense.href}
                  className="underline decoration-[var(--pencil-rule)] underline-offset-[3px] hover:decoration-[var(--reader-fg)]"
                >
                  {sense.articleTitle}
                </Link>
              ) : (
                <span>Article no longer in your library</span>
              )}
              {" · "}
              {dateLabel(sense.createdAt)}
            </span>
          </span>
        </p>
      ))}
    </article>
  );
}

function Column({
  entries,
  firstOfLetter,
}: {
  entries: Entry[];
  firstOfLetter: Map<string, string>;
}) {
  const guide = guideWords(entries);
  if (!guide) return <div />;
  return (
    <div>
      <h2 className="mb-3 flex justify-between border-b border-[var(--reader-border-strong)] pb-1 font-serif text-[13px] font-semibold uppercase tracking-[0.2em] text-[var(--reader-muted)]">
        <span>{guide[0].slice(0, 2)}</span>
        <span>
          {guide[0]} — {guide[1]}
        </span>
      </h2>
      {entries.map((entry) => (
        <EntryView
          key={entry.key}
          entry={entry}
          anchor={firstOfLetter.get(entry.letter) === entry.key}
        />
      ))}
    </div>
  );
}

/** Every word the reader looked up, laid out like a printed dictionary. */
export function DictionaryTab() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.dictionary.page,
    {},
    { initialNumItems: PAGE },
  );
  // Sorting needs every lookup, so older pages load behind the first one, up to the cap
  useEffect(() => {
    if (status === "CanLoadMore" && results.length < DICTIONARY_CAP)
      loadMore(PAGE);
  }, [status, results.length, loadMore]);

  const [query, setQuery] = useState("");
  const rows: LookupRow[] = results;
  const all = useMemo(() => groupLookups(rows), [rows]);
  const shown = useMemo(() => searchEntries(all, query), [all, query]);
  const [left, right] = useMemo(() => splitColumns(shown), [shown]);
  const thumb = useMemo(() => thumbIndex(shown), [shown]);
  const firstOfLetter = useMemo(() => {
    const first = new Map<string, string>();
    for (const e of shown) if (!first.has(e.letter)) first.set(e.letter, e.key);
    return first;
  }, [shown]);
  const month = useMemo(() => wordsThisMonth(rows, new Date()), [rows]);

  if (status === "LoadingFirstPage")
    return (
      <p role="status" className="text-sm text-[var(--reader-muted)]">
        Loading your dictionary…
      </p>
    );
  if (all.length === 0)
    return (
      <p className="py-10 text-sm text-[var(--reader-muted)]">
        No words yet. Define a word while reading and it will be kept here, with
        the sentence you met it in.
      </p>
    );

  const capped = status === "CanLoadMore" && results.length >= DICTIONARY_CAP;
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <input
          type="search"
          aria-label="Find a word"
          placeholder="Find a word"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="app-input max-w-[420px] flex-1"
        />
        <p className="text-[13px] text-[var(--reader-muted)]">
          {all.length} {all.length === 1 ? "word" : "words"} · {month} this
          month
          {status !== "Exhausted" && !capped && " · loading older words…"}
        </p>
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-sm text-[var(--reader-muted)]">
          No word contains “{query.trim()}”.
        </p>
      ) : (
        <div className="grid gap-x-7 md:grid-cols-[2.25rem_1fr_1fr]">
          <nav
            aria-label="Jump to a letter"
            className="sticky top-0 z-10 mb-4 flex gap-0.5 overflow-x-auto bg-[var(--reader-bg)] py-1 font-serif text-xs font-semibold md:top-4 md:mb-0 md:flex-col md:self-start md:overflow-visible md:bg-transparent md:py-0"
          >
            {thumb.map(({ letter, hasWords }) =>
              hasWords ? (
                <button
                  key={letter}
                  type="button"
                  onClick={() =>
                    document
                      .getElementById(`letter-${letter}`)
                      ?.scrollIntoView({ block: "start" })
                  }
                  className="flex h-[22px] w-7 shrink-0 items-center justify-center rounded-l border border-r-0 border-[var(--reader-border-strong)] text-[var(--reader-fg)] hover:bg-[var(--reader-chip)] md:w-[26px]"
                >
                  {letter}
                </button>
              ) : (
                <span
                  key={letter}
                  aria-disabled="true"
                  className="flex h-[22px] w-7 shrink-0 items-center justify-center rounded-l border border-r-0 border-[var(--reader-border)] text-[var(--reader-muted)] opacity-35 md:w-[26px]"
                >
                  {letter}
                </span>
              ),
            )}
          </nav>
          <Column entries={left} firstOfLetter={firstOfLetter} />
          <Column entries={right} firstOfLetter={firstOfLetter} />
        </div>
      )}
      {capped && (
        <p className="mt-6 text-xs text-[var(--reader-muted)]">
          Showing your {DICTIONARY_CAP.toLocaleString()} most recent lookups.
        </p>
      )}
    </div>
  );
}
