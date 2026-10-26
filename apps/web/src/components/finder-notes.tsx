"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { readLink } from "@/lib/notes-groups";

/** Typing pauses this long before the reader's notes are searched. */
const DEBOUNCE_MS = 150;

export type NoteHit = NonNullable<
  ReturnType<typeof useQuery<typeof api.notesSearch.find>>
>[number];

/**
 * The reader's own notes and highlights that match the query. This is its own
 * live query, so it never waits on, or slows, the article search.
 */
export function useNoteHits(text: string, enabled: boolean): NoteHit[] {
  const [settled, setSettled] = useState("");
  useEffect(() => {
    if (!enabled) {
      setSettled("");
      return;
    }
    const timer = window.setTimeout(() => setSettled(text), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, text]);
  const hits = useQuery(
    api.notesSearch.find,
    enabled && settled === text ? { query: text } : "skip",
  );
  return enabled && settled === text ? (hits ?? []) : [];
}

/** Where a hit opens: the article at the line, with the note open for a note. */
export function noteHitLink(hit: NoteHit) {
  return readLink(
    hit.articleId,
    hit.quote || undefined,
    hit.paragraphIndex,
    hit.unitIndex,
    hit.kind === "note" ? { note: hit.id } : undefined,
  );
}

export function noteOptionId(prefix: string, index: number) {
  return `${prefix}-note-${index}`;
}

/** A small "In your notes" group after the article card; its rows join the arrow keys. */
export function FinderNotes({
  hits,
  selected,
  idPrefix,
  labelClass,
  onOpen,
}: {
  hits: NoteHit[];
  /** The row the arrow keys are on, if any. */
  selected: number | null;
  idPrefix: string;
  labelClass: string;
  onOpen: () => void;
}) {
  const row = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (selected !== null) row.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  if (!hits.length) return null;
  return (
    <div className="border-t border-[var(--reader-border)] px-[18px] pb-3 pt-3.5">
      <p className={labelClass}>In your notes</p>
      <div
        id={`${idPrefix}-notes`}
        role="listbox"
        aria-label="In your notes"
        className="-mx-2"
      >
        {hits.map((hit, index) => (
          <Link
            key={`${hit.kind}-${hit.id}`}
            ref={selected === index ? row : undefined}
            id={noteOptionId(idPrefix, index)}
            role="option"
            aria-selected={selected === index}
            href={noteHitLink(hit)}
            onClick={onOpen}
            className={`block rounded-md px-2 py-1.5 ${selected === index ? "bg-[var(--reader-chip)]" : "hover:bg-[var(--reader-chip)]"}`}
          >
            <span className="line-clamp-2 font-serif text-[15px] italic leading-snug text-[var(--reader-fg-soft)]">
              {hit.text}
            </span>
            <span className="mt-0.5 block truncate text-[12.5px] text-[var(--reader-muted)]">
              {hit.kind === "note" ? "Note" : "Highlight"} · {hit.articleTitle}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
