"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useAction, useMutation } from "convex/react";
import { Link2, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useCommand, useShortcuts } from "@/lib/shortcuts";
import {
  nextPosition,
  previousPosition,
  type TopicMatch,
  topicCard,
} from "@/lib/topic-card";
import { useModalDialog } from "@/lib/use-modal-dialog";
import { usePresented } from "@/lib/use-presented";
import { useTopicSearch } from "@/lib/use-topic-search";

const URL_PATTERN = /^(https?:\/\/|www\.)\S+$/i;

const labelClass =
  "mb-2 text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--reader-muted)]";
const primaryClass =
  "rounded-md bg-[var(--reader-fg)] px-4 py-2 text-[14px] text-[var(--reader-surface)] disabled:opacity-60";
const secondaryClass =
  "rounded-md bg-[var(--reader-chip)] px-4 py-2 text-[14px] text-[var(--reader-fg-soft)]";
const quietClass =
  "py-2 text-[14px] text-[var(--reader-fg-soft)] underline decoration-[var(--reader-border-strong)] underline-offset-[3px] disabled:no-underline";

function metaLine(match: TopicMatch) {
  return [
    match.source ?? match.author,
    match.minutes ? `${match.minutes} min` : null,
    match.status === "Read" ? "read before" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The floating picker: type a topic and get one article at a time, or paste a
 * link. `windowMinutes` is the time the desk has chosen, if any; matches then
 * have to fit it until the reader clears the limit.
 */
export function ArticleFinder({
  windowMinutes = null,
  onClearWindow,
  showKey = false,
}: {
  windowMinutes?: number | null;
  onClearWindow?: () => void;
  /** The desk's hold-Alt overlay: show the `/` key on the trigger. */
  showKey?: boolean;
}) {
  const router = useRouter();
  const addByUrl = useAction(api.actions.addArticleByUrl.add);
  const saveArticle = useMutation(api.savedArticles.save);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState(0);
  const [limitCleared, setLimitCleared] = useState(false);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const text = query.trim();
  const isLink = URL_PATTERN.test(text);
  const searching = open && text.length >= 2 && !isLink;
  const result = useTopicSearch(text, searching, retry);
  const limit = limitCleared ? null : windowMinutes;
  useShortcuts({ "/": () => setOpen(true) });
  useCommand("open-finder", () => setOpen(true));
  // Search from another room lands on the desk with ?find=1; open the picker once
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("find") !== "1") return;
    url.searchParams.delete("find");
    window.history.replaceState(window.history.state, "", url);
    setOpen(true);
  }, []);

  useModalDialog(dialogRef, open, triggerRef);

  // The desk can choose a different time while the picker is closed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new window or a reopened picker restores the limit
  useEffect(() => {
    setLimitCleared(false);
  }, [open, windowMinutes]);

  const current = result.query === text;
  const loading = searching && (!current || result.status === "loading");
  const card =
    searching && current && result.status === "ready"
      ? topicCard(result.matches, position, limit)
      : null;
  const shown = card?.kind === "card" ? card : null;
  const recordInteraction = useMutation(api.sessions.recordInteraction);
  // SAFETY: match ids come from the library search, which returns article ids.
  usePresented(
    shown?.match.articleId as Id<"articles"> | undefined,
    (articleId) => {
      recordInteraction({
        articleId,
        action: "presented",
      }).catch((error) => console.error("Couldn't record the offer", error));
    },
  );
  const shortest = card?.kind === "none-fit" ? card.shortest : null;

  const go = (articleId: string) => {
    setOpen(false);
    router.push(`/read/${articleId}`);
  };
  const clearLimit = () => {
    setLimitCleared(true);
    onClearWindow?.();
  };
  const another = () => {
    if (shown?.hasNext) setPosition(nextPosition(shown.index));
  };
  const previous = () => {
    if (shown?.hasPrevious)
      setPosition(previousPosition(result.matches, shown.index, limit));
  };
  const save = async (articleId: string) => {
    try {
      await saveArticle({ articleId: articleId as Id<"articles"> });
      setSaved((ids) => new Set(ids).add(articleId));
      toast.success("Saved for later");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save that article",
      );
    }
  };
  const fromLink = async (andRead: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const url = text.startsWith("www.") ? `https://${text}` : text;
      const { articleId, alreadyExists } = await addByUrl({ url });
      if (andRead) {
        toast.success(
          alreadyExists
            ? "Already in your library. Opening it."
            : "Added. Marginalia is on its way.",
        );
        go(articleId);
      } else {
        await save(articleId);
        setQuery("");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't fetch that article",
      );
    } finally {
      setBusy(false);
    }
  };
  const readNow = () => {
    if (isLink) void fromLink(true);
    else if (shown) go(shown.match.articleId);
  };

  const reason = shown && result.reasons[shown.match.articleId];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="/"
        title="Ask, or paste a link · press /"
        className="flex w-full items-center gap-2.5 h-12 rounded-2xl px-4 bg-[var(--reader-surface)] ring-1 ring-[var(--reader-border)] text-left text-[var(--reader-muted)] hover:text-[var(--reader-fg)] transition-colors"
      >
        <Search size={16} className="shrink-0" />
        <span className="flex-1 min-w-0 truncate text-[15px]">
          Ask, or paste a link
        </span>
        {showKey && (
          <kbd className="reader-kbd hidden md:inline-block" aria-hidden>
            /
          </kbd>
        )}
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Find something to read"
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        className="mx-auto mt-[calc(var(--app-viewport-top)+env(safe-area-inset-top)+1rem)] md:mt-[12dvh] mb-auto w-[calc(100%-2rem)] max-w-[640px] max-h-[calc(var(--app-viewport-height)-env(safe-area-inset-top)-2rem)] rounded-[10px] p-0 overflow-hidden bg-[var(--reader-surface)] text-[var(--reader-fg)] ring-1 ring-[var(--reader-border-strong)] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.6)] backdrop:bg-black/40 font-sans"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            readNow();
          }}
          className="focus-frame flex items-center gap-3 px-4 py-3.5 border-b border-[var(--reader-border)]"
        >
          {isLink ? (
            <Link2 size={19} className="shrink-0 text-[var(--reader-muted)]" />
          ) : (
            <Search size={19} className="shrink-0 text-[var(--reader-muted)]" />
          )}
          <input
            type="text"
            aria-label="Ask for something to read, or paste a link"
            maxLength={2000}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPosition(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) {
                if (e.key === "Enter") e.preventDefault();
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                another();
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                previous();
              }
            }}
            placeholder="Science, a quick read, that piece about cows…"
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[var(--reader-muted)]"
          />
          {limit !== null && !isLink && (
            <button
              type="button"
              onClick={clearLimit}
              aria-label={`Clear the ${limit} minute limit`}
              className="shrink-0 rounded-full bg-[var(--reader-chip)] px-2.5 py-0.5 text-[12.5px] text-[var(--reader-fg-soft)]"
            >
              within {limit} min ×
            </button>
          )}
          <span
            aria-hidden
            className="reader-kbd hidden shrink-0 md:inline-block"
          >
            esc
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close search"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--reader-muted)] hover:text-[var(--reader-fg)] md:hidden"
          >
            <X size={16} />
          </button>
        </form>
        <div className="max-h-[min(calc(var(--app-viewport-height)-10rem),480px)] overflow-y-auto overscroll-contain">
          {!text && (
            <p className="px-5 py-6 text-[14px] text-[var(--reader-muted)]">
              Say what you feel like reading about, or paste a link.
            </p>
          )}
          {text && text.length < 2 && !isLink && (
            <p className="px-5 py-6 text-[14px] text-[var(--reader-muted)]">
              Keep typing.
            </p>
          )}
          {isLink && (
            <div className="px-[18px] pb-4 pt-[18px]">
              <p className={labelClass}>A link</p>
              <p className="mb-1.5 break-all font-serif text-[22px] leading-tight">
                {text}
              </p>
              <p className="mb-4 text-[14.5px] text-[var(--pencil)]">
                {busy ? "Fetching article…" : "Not in your library yet."}
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  className={primaryClass}
                  disabled={busy}
                  onClick={() => void fromLink(true)}
                >
                  Save and read
                </button>
                <button
                  type="button"
                  className={quietClass}
                  disabled={busy}
                  onClick={() => void fromLink(false)}
                >
                  Save for later
                </button>
              </div>
            </div>
          )}
          {loading && (
            <p
              role="status"
              className="px-5 py-6 text-[14px] text-[var(--reader-muted)]"
            >
              Finding something that fits…
            </p>
          )}
          {shown && (
            <div className="px-[18px] pb-4 pt-[18px]">
              <p className={labelClass}>
                About {text}
                {limit !== null && `, within ${limit} min`}
              </p>
              <h3
                key={shown.match.articleId}
                className="mb-1.5 font-serif text-[22px] leading-tight md:text-[26px]"
              >
                {shown.match.title}
              </h3>
              <p className="mb-2 text-[13.5px] text-[var(--reader-muted)]">
                {metaLine(shown.match)}
              </p>
              <p className="mb-4 min-h-[22px] text-[14.5px] text-[var(--pencil)]">
                {reason ||
                  (!result.explained && (
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-[180px] animate-pulse rounded-full bg-[var(--reader-chip)] align-middle"
                    />
                  ))}
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  className={primaryClass}
                  onClick={readNow}
                >
                  Read now
                </button>
                {shown.hasNext && (
                  <button
                    type="button"
                    className={secondaryClass}
                    onClick={another}
                  >
                    Another
                  </button>
                )}
                <button
                  type="button"
                  className={quietClass}
                  disabled={saved.has(shown.match.articleId)}
                  onClick={() => void save(shown.match.articleId)}
                >
                  {saved.has(shown.match.articleId)
                    ? "Saved"
                    : "Save for later"}
                </button>
                <span className="ml-auto hidden text-[12.5px] text-[var(--reader-muted)] md:inline">
                  {shown.ordinal} of {shown.total}
                  {result.more && "+"}
                </span>
              </div>
            </div>
          )}
          {card?.kind === "none-fit" && (
            <div className="px-[18px] pb-4 pt-[18px]">
              <p className={labelClass}>
                About {text}, within {limit} min
              </p>
              <p className="mb-1.5 font-serif text-[22px] leading-tight">
                Nothing on {text} fits in {limit} minutes.
              </p>
              {shortest && (
                <p className="mb-4 text-[14.5px] text-[var(--pencil)]">
                  The shortest is {shortest.minutes} min: &ldquo;
                  {shortest.title}&rdquo;.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2.5">
                {shortest && (
                  <button
                    type="button"
                    className={secondaryClass}
                    onClick={() => go(shortest.articleId)}
                  >
                    Read it anyway
                  </button>
                )}
                <button
                  type="button"
                  className={quietClass}
                  onClick={clearLimit}
                >
                  Clear the time
                </button>
              </div>
            </div>
          )}
          {card?.kind === "end" && (
            <div className="px-[18px] py-5">
              <p className="mb-3 text-[14px] text-[var(--reader-fg-soft)]">
                That&apos;s everything closest to {text}.
              </p>
              <button
                type="button"
                className={secondaryClass}
                onClick={() => setPosition(0)}
              >
                Start again
              </button>
            </div>
          )}
          {card?.kind === "empty" && (
            <p
              role="status"
              className="px-5 py-6 text-[14px] text-[var(--reader-muted)]"
            >
              Nothing in your library fits that yet. Try another topic or paste
              a link.
            </p>
          )}
          {searching && current && result.status === "error" && (
            <div
              role="alert"
              className="px-5 py-6 text-[14px] text-[var(--reader-fg-soft)]"
            >
              {result.error ? (
                <>
                  {result.error}{" "}
                  <Link
                    href="/account"
                    onClick={() => setOpen(false)}
                    className="underline underline-offset-2"
                  >
                    Open Your account
                  </Link>
                </>
              ) : (
                <>
                  Couldn&apos;t search your library.{" "}
                  <button
                    type="button"
                    onClick={() => setRetry((n) => n + 1)}
                    className="underline underline-offset-2"
                  >
                    Try again
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {searching && (
          <div className="border-t border-[var(--reader-border)] px-[18px] py-2.5 text-[12.5px] text-[var(--reader-muted)]">
            See every match in{" "}
            <Link
              href={`/library?q=${encodeURIComponent(text)}`}
              onClick={() => setOpen(false)}
              className="text-[var(--reader-fg-soft)] underline decoration-[var(--reader-border-strong)] underline-offset-[3px]"
            >
              Library
            </Link>
          </div>
        )}
        <span role="status" className="sr-only">
          {shown
            ? `${shown.ordinal} of ${shown.total}${result.more ? " or more" : ""}: ${shown.match.title}, ${shown.match.minutes ?? "unknown"} minutes.`
            : ""}
        </span>
      </dialog>
    </>
  );
}
