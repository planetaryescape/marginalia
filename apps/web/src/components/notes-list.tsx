"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Doc, Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { InlineError, Skeleton, SkeletonBar } from "@/components/in-place";
import { KeptTranscript } from "@/components/kept-transcript";
import { useListKeys } from "@/lib/list-nav";
import { MODE_LABELS } from "@/lib/margin-answers";
import {
  type ArticleGroup,
  type GroupItem,
  groupByArticle,
  type KeptMark,
  type KeptThread,
  readLink,
} from "@/lib/notes-groups";
import { cn } from "@/lib/utils";

/** Marks are read this many at a time; each row carries an embedding, so pages stay small. */
const MARKS_PAGE = 50;

/** The commonplace book: every note, highlight and kept answer, grouped by article. */
export function NotesList() {
  const notes = useQuery(api.userNotes.listAll);
  const kept = useQuery(api.companionThreads.listKept);
  const marks = usePaginatedQuery(
    api.highlights.listMine,
    {},
    { initialNumItems: MARKS_PAGE },
  );
  const removeNote = useMutation(api.userNotes.remove);
  const removeThread = useMutation(api.companionThreads.remove);
  useListKeys();
  // A failed delete stays above the notes with Retry; the note stays where it was
  const [failure, setFailure] = useState<{
    message: string;
    retry: () => Promise<void>;
  } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const attempt = async (message: string, run: () => Promise<unknown>) => {
    try {
      await run();
      setFailure(null);
    } catch {
      setFailure({ message, retry: () => attempt(message, run) });
    }
  };

  const loading =
    notes === undefined ||
    kept === undefined ||
    marks.status === "LoadingFirstPage";
  const groups = loading
    ? undefined
    : groupByArticle(notes, kept, marks.results);

  return (
    <>
      {groups === undefined && (
        <Skeleton label="Loading notes">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="border-b border-[var(--reader-border)] py-4"
            >
              <SkeletonBar className="h-3.5 w-[30%]" />
              <SkeletonBar className="mt-3 h-4 w-full" />
              <SkeletonBar className="mt-2 h-4 w-[70%]" />
            </div>
          ))}
        </Skeleton>
      )}

      {groups?.length === 0 && (
        <div className="text-center py-16">
          <p className="text-[var(--reader-muted)] text-sm">
            No notes yet. Highlight text while reading to create notes.
          </p>
        </div>
      )}

      {failure && (
        <div className="mb-6">
          <InlineError
            message={failure.message}
            busy={retrying}
            onRetry={async () => {
              setRetrying(true);
              await failure.retry();
              setRetrying(false);
            }}
          />
        </div>
      )}

      {groups?.map((group) => (
        <ArticleNotesGroup
          key={group.articleId}
          group={group}
          onDelete={(noteId) =>
            void attempt("Couldn't delete the note.", () =>
              removeNote({ noteId }),
            )
          }
          onDeleteAnswer={(threadId) =>
            void attempt("Couldn't delete the answer.", () =>
              removeThread({ threadId }),
            )
          }
        />
      ))}

      {marks.status === "CanLoadMore" && (
        <div className="flex justify-center pb-10">
          <button
            type="button"
            onClick={() => marks.loadMore(MARKS_PAGE)}
            className="text-sm text-[var(--reader-muted)] hover:text-[var(--reader-fg)] underline underline-offset-4 transition-colors"
          >
            Show more
          </button>
        </div>
      )}
      {marks.status === "LoadingMore" && (
        <p
          role="status"
          className="pb-10 text-center text-sm text-[var(--reader-muted)]"
        >
          Loading more…
        </p>
      )}
    </>
  );
}

/** Where a row opens, and which note or answer the reader should open on arriving. */
type LinkTo = (
  quote?: string,
  paragraphIndex?: number,
  unitIndex?: number,
  opens?: { note?: string; answer?: string },
) => string | null;

function ArticleNotesGroup({
  group,
  onDelete,
  onDeleteAnswer,
}: {
  group: ArticleGroup;
  onDelete: (noteId: Id<"userNotes">) => void;
  onDeleteAnswer: (threadId: Id<"companionThreads">) => void;
}) {
  const { articleId } = group;
  // `undefined` while loading; `null` once the article is gone, which a mark or note can outlive.
  const article = useQuery(api.articles.getById, { articleId });
  const source = article ? sourceOf(article.url) : null;
  // Where a row opens: the reader at a quote, or nowhere once the article is gone.
  const at: LinkTo = (quote, paragraphIndex, unitIndex, opens) =>
    article === null
      ? null
      : readLink(articleId, quote, paragraphIndex, unitIndex, opens);

  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between gap-4 border-t border-[var(--reader-border-strong)] pt-4 pb-3">
        {article ? (
          <Link
            href={readLink(articleId)}
            data-nav-item
            className="font-serif text-xl text-[var(--reader-fg)] hover:underline hover:decoration-[var(--pencil-rule)] underline-offset-4 transition-colors"
          >
            {article.title}
          </Link>
        ) : (
          <span className="font-serif text-xl text-[var(--reader-muted)]">
            {article === null
              ? "Article no longer in your library"
              : "Loading…"}
          </span>
        )}
        <span className="shrink-0 text-xs text-[var(--reader-muted)]">
          {[source, formatDay(group.latest)].filter(Boolean).join(" · ")}
        </span>
      </div>

      <div className="space-y-5">
        {group.items.map((item) => (
          <GroupRow
            key={itemKey(item)}
            item={item}
            at={at}
            onDelete={onDelete}
            onDeleteAnswer={onDeleteAnswer}
          />
        ))}
      </div>
    </section>
  );
}

function GroupRow({
  item,
  at,
  onDelete,
  onDeleteAnswer,
}: {
  item: GroupItem;
  at: LinkTo;
  onDelete: (noteId: Id<"userNotes">) => void;
  onDeleteAnswer: (threadId: Id<"companionThreads">) => void;
}) {
  if (item.type === "note")
    return (
      <NoteRow
        note={item.note}
        at={at}
        onDelete={() => onDelete(item.note._id)}
      />
    );
  if (item.type === "mark") return <MarkRow mark={item.mark} at={at} />;
  return (
    <KeptAnswerRow
      thread={item.thread}
      at={at}
      onDelete={() => onDeleteAnswer(item.thread._id)}
    />
  );
}

/** The reader's own words: the line they're about in italic, then their note with a pen rule. */
function NoteRow({
  note,
  at,
  onDelete,
}: {
  note: Doc<"userNotes">;
  at: LinkTo;
  onDelete: () => void;
}) {
  return (
    <div className="group">
      <Opens
        href={at(note.selectedText || undefined, undefined, note.unitIndex, {
          note: note._id,
        })}
        className="block"
      >
        {note.selectedText && (
          <blockquote className="mb-1 line-clamp-2 font-serif text-sm italic text-[var(--ink-muted)]">
            {note.selectedText}
          </blockquote>
        )}
        <p className="border-l-2 border-[var(--pen)] pl-3 font-sans text-[15px] leading-relaxed text-[var(--reader-fg)] whitespace-pre-wrap break-words">
          {note.contentPlain}
        </p>
      </Opens>
      <div className="mt-1.5 flex items-center justify-between pl-3">
        <span className="text-[11px] text-[var(--reader-muted)]">
          {formatStamp(note.createdAt)}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="md:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 text-[12px] text-[var(--reader-muted)] hover:text-[var(--reader-fg)] transition-opacity"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/** A highlight or underline in its own colour; older marks follow the reader's current highlighter or pen. */
function MarkRow({ mark, at }: { mark: KeptMark; at: LinkTo }) {
  return (
    <Opens
      href={at(mark.text, mark.paragraphIndex, mark.unitIndex)}
      className="block"
    >
      <p className="font-serif text-[16px] leading-relaxed text-[var(--reader-fg)]">
        {mark.kind === "highlight" ? (
          <span
            data-color={mark.color}
            className={cn(
              "rounded-sm",
              mark.color ? "bg-[var(--mark)]" : "bg-[var(--highlighter)]",
            )}
          >
            {mark.text}
          </span>
        ) : (
          <span
            data-color={mark.color}
            className={cn(
              "underline decoration-2 underline-offset-4",
              mark.color
                ? "decoration-[var(--mark)]"
                : "decoration-[var(--pen)]",
            )}
          >
            {mark.text}
          </span>
        )}
      </p>
      <span className="text-[11px] text-[var(--reader-muted)]">
        {mark.kind === "highlight" ? "Highlight" : "Underline"} ·{" "}
        {formatStamp(mark.createdAt)}
      </span>
    </Opens>
  );
}

/** One of Marginalia's answers the reader kept: a pencil line that opens in place. */
function KeptAnswerRow({
  thread,
  at,
  onDelete,
}: {
  thread: KeptThread;
  at: LinkTo;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <div data-hand="pencil" className="px-1 group">
      <button
        type="button"
        aria-expanded={open}
        data-nav-item
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 py-2 text-left text-[13px] text-[var(--pencil)]"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="shrink-0">
          Marginalia&rsquo;s answer &middot; {MODE_LABELS[thread.mode]}
        </span>
        {/* What it answered, so a closed row says what it is about */}
        {thread.selection && (
          <span className="min-w-0 truncate text-[var(--reader-muted)]">
            {thread.selection}
          </span>
        )}
      </button>
      {open && (
        <div className="pb-3 pl-4">
          {thread.selection && (
            <Opens
              href={at(thread.selection, undefined, thread.unitIndex, {
                answer: thread._id,
              })}
              className="block mb-2"
            >
              <blockquote className="text-sm font-serif text-[var(--ink-muted)] border-l border-[var(--reader-border-strong)] pl-3 italic line-clamp-2">
                {thread.selection}
              </blockquote>
            </Opens>
          )}
          <KeptTranscript
            thread={thread}
            onJump={() => {
              const href = at(
                thread.selection || undefined,
                undefined,
                thread.unitIndex,
                { answer: thread._id },
              );
              if (href) router.push(href);
            }}
          />
          <div className="flex justify-end mt-2">
            <button
              type="button"
              onClick={onDelete}
              className="md:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 text-[12px] text-[var(--reader-muted)] hover:text-[var(--reader-fg)] transition-opacity"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A row that links to the reader, or just sits on the page when there is no article to open. */
function Opens({
  href,
  className,
  children,
}: {
  href: string | null;
  className: string;
  children: ReactNode;
}) {
  return href ? (
    <Link href={href} data-nav-item className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

function itemKey(item: GroupItem): string {
  if (item.type === "note") return `note:${item.note._id}`;
  if (item.type === "mark") return `mark:${item.mark._id}`;
  return `answer:${item.thread._id}`;
}

/** The site an article came from, as its host name. */
function sourceOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function formatDay(at: number): string {
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatStamp(at: number): string {
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
