"use client";
import type { BibleSuggestion } from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import {
  type LibrarySearchMatch,
  librarySearchResponseSchema,
} from "@marginalia/backend/library-search";
import { useAction, useQuery } from "convex/react";
import { Link2, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { ReaderRequestError, readerRequestError } from "@/lib/companion";
import { useShortcuts } from "@/lib/shortcuts";
import { useModalDialog } from "@/lib/use-modal-dialog";
import { cn } from "@/lib/utils";
import { BibleBrowser } from "./bible-browser";
import { ReadingScopeControl } from "./reading-scope";

const URL_PATTERN = /^(https?:\/\/|www\.)\S+$/i;
const CACHE_TTL_MS = 5 * 60_000;
type FinderMatch =
  | { kind: "article"; key: string; article: LibrarySearchMatch }
  | { kind: "bible"; key: string; passage: BibleSuggestion };
type SourceResult =
  | { status: "pending" }
  | { status: "ready"; matches: FinderMatch[]; notice?: string | null }
  | { status: "error"; error: unknown };

/** A keyboard-first search picker: the input keeps focus while arrows choose a result. */
export function ArticleFinder() {
  const router = useRouter();
  const addByUrl = useAction(api.actions.addArticleByUrl.add);
  const suggestBible = useAction(api.actions.bible.suggest);
  const openBible = useAction(api.actions.bible.openPassage);
  const preferences = useQuery(api.bible.preferences, {});
  const scope = preferences?.enabled ? preferences.scope : "articles";
  const overview = useQuery(api.home.overview, {});
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    query: string;
    matches: FinderMatch[];
    status: "loading" | "ready" | "error";
    /** Why search can't run yet, such as a missing provider key. */
    reason?: string;
    notice?: string;
    incomplete?: boolean;
    pending?: boolean;
  }>({ query: "", matches: [], status: "ready" });
  const [selected, setSelected] = useState(0);
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [retry, setRetry] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cache = useRef(
    new Map<
      string,
      { time: number; matches: FinderMatch[]; notice?: string }
    >(),
  );
  const id = useId();
  const listId = `${id}-results`;
  const text = query.trim();
  const searchKey = `${scope}:${preferences?.translation ?? "web"}:${text}`;
  const isLink = URL_PATTERN.test(text);
  useShortcuts({ "/": () => setOpen(true) });

  useModalDialog(dialogRef, open, triggerRef);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly reruns a failed request
  useEffect(() => {
    if (!open || text.length < 2 || isLink) return;
    const key = searchKey.toLowerCase();
    const cached = cache.current.get(key);
    if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
      setResult({
        query: searchKey,
        matches: cached.matches,
        status: "ready",
        notice: cached.notice,
      });
      return;
    }
    const controller = new AbortController();
    let bibleDeadline: number | undefined;
    setResult({ query: searchKey, matches: [], status: "loading" });
    const timer = window.setTimeout(() => {
      let articles: SourceResult =
        scope === "bible"
          ? { status: "ready", matches: [] }
          : { status: "pending" };
      let bible: SourceResult =
        scope === "articles"
          ? { status: "ready", matches: [] }
          : { status: "pending" };
      const publishedOrder: string[] = [];
      const publish = () => {
        if (controller.signal.aborted) return;
        const pending =
          articles.status === "pending" || bible.status === "pending";
        const matches: FinderMatch[] = [
          ...(bible.status === "ready" ? bible.matches : []),
          ...(articles.status === "ready" ? articles.matches : []),
        ];
        for (const match of matches)
          if (!publishedOrder.includes(match.key))
            publishedOrder.push(match.key);
        matches.sort(
          (a, b) =>
            publishedOrder.indexOf(a.key) - publishedOrder.indexOf(b.key),
        );
        const failed =
          (articles.status === "error" &&
            (scope === "articles" || bible.status === "error")) ||
          (bible.status === "error" && scope === "bible");
        const error =
          articles.status === "error"
            ? articles.error
            : bible.status === "error"
              ? bible.error
              : null;
        const notice = [
          bible.status === "ready"
            ? bible.notice
            : bible.status === "error"
              ? "Bible search couldn't complete. Try again."
              : null,
          articles.status === "error"
            ? "Article search couldn't complete. Try again."
            : null,
        ]
          .filter(Boolean)
          .join(" ");
        const incomplete =
          articles.status === "error" || bible.status === "error";
        if (!pending && !incomplete) {
          if (cache.current.size >= 20) {
            const oldest = cache.current.keys().next().value;
            if (oldest !== undefined) cache.current.delete(oldest);
          }
          cache.current.set(key, { time: Date.now(), matches, notice });
        }
        setResult({
          query: searchKey,
          matches,
          status: failed
            ? "error"
            : pending && !matches.length
              ? "loading"
              : "ready",
          notice,
          incomplete,
          pending,
          reason:
            error instanceof ReaderRequestError && error.code
              ? error.message
              : undefined,
        });
      };
      const articleSearch = async (): Promise<FinderMatch[]> => {
        if (scope === "bible") return [];
        const response = await fetch("/api/reader/library/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: text, scope: "articles" }),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(30_000),
          ]),
        });
        if (!response.ok) throw await readerRequestError(response);
        return librarySearchResponseSchema
          .parse(await response.json())
          .matches.map((article) => ({
            kind: "article",
            key: article.articleId,
            article,
          }));
      };
      if (scope !== "bible")
        void articleSearch().then(
          (matches) => {
            articles = { status: "ready", matches };
            publish();
          },
          (error: unknown) => {
            articles = { status: "error", error };
            publish();
          },
        );
      if (scope !== "articles") {
        bibleDeadline = window.setTimeout(() => {
          bible = {
            status: "error",
            error: new Error("Bible search timed out."),
          };
          publish();
        }, 30_000);
        void suggestBible({ question: text }).then(
          (response) => {
            if (bible.status !== "pending" || controller.signal.aborted) return;
            window.clearTimeout(bibleDeadline);
            bible = {
              status: "ready",
              matches: response.passages.map((passage) => ({
                kind: "bible",
                key: passage.reference,
                passage,
              })),
              notice: response.notice,
            };
            publish();
          },
          (error: unknown) => {
            if (bible.status !== "pending" || controller.signal.aborted) return;
            window.clearTimeout(bibleDeadline);
            bible = { status: "error", error };
            publish();
          },
        );
      }
    }, 600);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(bibleDeadline);
      controller.abort();
    };
  }, [open, text, searchKey, scope, isLink, retry, suggestBible]);

  const suggestions: FinderMatch[] = (
    scope === "bible" ? [] : (overview?.upNext ?? [])
  )
    .slice(0, 5)
    .map((article) => ({
      kind: "article",
      key: article._id,
      article: {
        articleId: article._id,
        title: article.title,
        author: article.author ?? null,
        minutes: article.minutes ?? null,
        status: "Unread",
        reason: article.excerpt || "Waiting in your library, ready to read.",
      },
    }));
  const matches =
    text.length < 2
      ? suggestions
      : result.query === searchKey && result.status === "ready"
        ? result.matches
        : [];
  const count = isLink ? 1 : matches.length;
  const selectedIndex = Math.min(selected, Math.max(0, count - 1));
  const activeId = count
    ? `${id}-option-${Math.min(selected, count - 1)}`
    : undefined;
  const loading =
    text.length >= 2 &&
    !isLink &&
    (result.query !== searchKey ||
      result.status === "loading" ||
      Boolean(result.pending));

  useEffect(() => {
    if (!open || !activeId) return;
    document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId, open]);

  const choose = async (index: number) => {
    if (fetchingUrl) return;
    if (!isLink) {
      const match = matches[Math.min(index, matches.length - 1)];
      if (!match) return;
      if (match.kind === "bible") {
        setFetchingUrl(true);
        try {
          const articleId = await openBible({
            reference: match.passage.reference,
          });
          setOpen(false);
          router.push(`/read/${articleId}`);
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Couldn't open that passage. Please try again.",
          );
        } finally {
          setFetchingUrl(false);
        }
        return;
      }
      setOpen(false);
      router.push(`/read/${match.article.articleId}`);
      return;
    }
    setFetchingUrl(true);
    try {
      const url = text.startsWith("www.") ? `https://${text}` : text;
      const { articleId, alreadyExists } = await addByUrl({ url });
      toast.success(
        alreadyExists
          ? "Already in your library. Opening it."
          : "Added. Marginalia is on its way.",
      );
      setOpen(false);
      router.push(`/read/${articleId}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't fetch that article",
      );
    } finally {
      setFetchingUrl(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="/"
        className="flex w-full items-center gap-2.5 h-12 rounded-2xl px-4 bg-[var(--reader-surface)] ring-1 ring-[var(--reader-border)] text-left text-[var(--reader-muted)] hover:text-[var(--reader-fg)] transition-colors"
      >
        <Search size={16} className="shrink-0" />
        <span className="flex-1 min-w-0 truncate text-[15px]">
          {scope === "bible"
            ? "Find a Bible passage by topic, time or reference"
            : "Ask for something to read, or paste a link"}
        </span>
        <kbd className="reader-kbd hidden md:inline-block" aria-hidden>
          /
        </kbd>
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Find something to read"
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        className="mx-auto mt-[calc(var(--app-viewport-top)+env(safe-area-inset-top)+1rem)] md:mt-[12dvh] mb-auto w-[calc(100%-2rem)] max-w-[720px] max-h-[calc(var(--app-viewport-height)-env(safe-area-inset-top)-2rem)] rounded-2xl p-0 overflow-hidden bg-[var(--reader-surface)] text-[var(--reader-fg)] ring-1 ring-[var(--reader-border-strong)] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.6)] backdrop:bg-black/40 font-sans"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void choose(selected);
          }}
          className="focus-frame flex items-center gap-3 px-4 py-4 border-b border-[var(--reader-border)]"
        >
          {isLink ? (
            <Link2 size={19} className="shrink-0 text-[var(--reader-muted)]" />
          ) : (
            <Search size={19} className="shrink-0 text-[var(--reader-muted)]" />
          )}
          <input
            ref={inputRef}
            role="combobox"
            aria-label={
              scope === "articles"
                ? "Search your articles or paste a link"
                : "Search by topic, time or Bible reference"
            }
            aria-autocomplete="list"
            aria-expanded={count > 0}
            aria-controls={listId}
            aria-activedescendant={activeId}
            maxLength={2000}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) {
                if (e.key === "Enter") e.preventDefault();
                return;
              }
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (count)
                  setSelected((index) =>
                    Math.max(
                      0,
                      Math.min(
                        count - 1,
                        index + (e.key === "ArrowDown" ? 1 : -1),
                      ),
                    ),
                  );
              }
            }}
            placeholder={
              scope === "articles"
                ? "Science, a quick read, that piece about cows…"
                : "Hope, 5 minutes about forgiveness, Romans 8…"
            }
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[var(--reader-muted)]"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close search"
            className="flex h-11 w-11 md:h-7 md:w-7 shrink-0 items-center justify-center rounded-md text-[var(--reader-muted)] hover:text-[var(--reader-fg)]"
          >
            <X size={16} />
          </button>
        </form>
        {preferences?.enabled && (
          <div className="border-b border-[var(--reader-border)] px-4 py-2">
            <ReadingScopeControl scope={scope} />
          </div>
        )}
        <div className="max-h-[min(calc(var(--app-viewport-height)-10rem),480px)] overflow-y-auto overscroll-contain p-2">
          {preferences?.enabled && scope !== "articles" && (
            <BibleBrowser onOpen={() => setOpen(false)} />
          )}
          {!text && (
            <p className="px-3 pb-2 pt-1 text-[12px] text-[var(--reader-muted)]">
              {scope === "bible"
                ? "Choose a book below or search by topic, time or reference"
                : "Up next · search by topic, time or memory"}
            </p>
          )}
          <div
            role="listbox"
            id={listId}
            aria-label="Matching reading suggestions"
            tabIndex={0}
            aria-activedescendant={activeId}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (count)
                  setSelected((index) =>
                    Math.max(
                      0,
                      Math.min(
                        count - 1,
                        index + (e.key === "ArrowDown" ? 1 : -1),
                      ),
                    ),
                  );
              } else if (e.key === "Enter") {
                e.preventDefault();
                void choose(selected);
              }
            }}
          >
            {isLink ? (
              <button
                type="button"
                role="option"
                id={`${id}-option-0`}
                aria-selected={true}
                tabIndex={-1}
                onClick={() => void choose(0)}
                disabled={fetchingUrl}
                className="w-full rounded-xl bg-[var(--reader-chip)] px-3 py-3 text-left"
              >
                <span className="block text-[15px] font-medium">
                  {fetchingUrl ? "Fetching article…" : "Read this link"}
                </span>
                <span className="mt-1 block break-all text-[13px] text-[var(--reader-muted)]">
                  {text}
                </span>
              </button>
            ) : (
              matches.map((match, index) => {
                const item =
                  match.kind === "article"
                    ? match.article
                    : {
                        title: match.passage.reference,
                        minutes: match.passage.minutes,
                        reason: `${match.passage.title} · ${match.passage.reason}`,
                        author: preferences?.translation.toUpperCase() ?? "WEB",
                        status: "Bible · estimated reading time",
                      };
                return (
                  <button
                    key={match.key}
                    type="button"
                    role="option"
                    id={`${id}-option-${index}`}
                    aria-selected={index === selectedIndex}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => setSelected(index)}
                    onClick={() => void choose(index)}
                    disabled={fetchingUrl}
                    className={cn(
                      "block w-full rounded-xl px-3 py-3 text-left transition-colors",
                      index === selectedIndex
                        ? "bg-[var(--reader-chip)]"
                        : "hover:bg-[var(--reader-chip)]",
                    )}
                  >
                    <span className="flex items-baseline gap-4">
                      <span className="flex-1 font-serif text-[20px] leading-snug">
                        {item.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--reader-muted)]">
                        {item.minutes
                          ? `${match.kind === "bible" ? "~" : ""}${item.minutes} min`
                          : item.status}
                      </span>
                    </span>
                    <span className="mt-1 block text-[13px] leading-relaxed text-[var(--reader-fg-soft)]">
                      {item.reason}
                    </span>
                    <span className="mt-1 block text-[11px] text-[var(--reader-muted)]">
                      {[item.author, item.status].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {loading && (
            <p
              role="status"
              className="px-3 py-6 text-[14px] text-[var(--reader-muted)]"
            >
              Finding something that fits…
            </p>
          )}
          {!isLink &&
            text.length >= 2 &&
            result.query === searchKey &&
            result.status === "ready" &&
            !result.pending &&
            !matches.length && (
              <p
                role="status"
                className="px-3 py-6 text-[14px] text-[var(--reader-muted)]"
              >
                {scope === "bible"
                  ? "No passage suggestions yet. Try another topic or enter a reference such as John 3."
                  : "Nothing fits that yet. Try another topic or paste a link."}
              </p>
            )}
          {result.query === searchKey &&
            result.status === "ready" &&
            result.notice && (
              <p
                role="status"
                className="px-3 py-3 text-xs text-[var(--reader-muted)]"
              >
                {result.notice}{" "}
                {result.incomplete && (
                  <button
                    type="button"
                    className="min-h-11 underline underline-offset-4"
                    onClick={() => setRetry((n) => n + 1)}
                  >
                    Retry search
                  </button>
                )}
              </p>
            )}
          {fetchingUrl && (
            <p role="status" className="px-3 py-3 text-sm">
              Opening your reading…
            </p>
          )}
          {result.query === searchKey &&
            result.status === "error" &&
            !isLink &&
            result.reason && (
              <div
                role="alert"
                className="px-3 py-6 text-[14px] text-[var(--reader-fg-soft)]"
              >
                {result.reason}{" "}
                <Link
                  href="/account"
                  onClick={() => setOpen(false)}
                  className="underline underline-offset-2"
                >
                  Open Your account
                </Link>
              </div>
            )}
          {result.query === searchKey &&
            result.status === "error" &&
            !isLink &&
            !result.reason && (
              <div
                role="alert"
                className="px-3 py-6 text-[14px] text-[var(--reader-fg-soft)]"
              >
                Couldn&apos;t complete this search.{" "}
                <button
                  type="button"
                  onClick={() => setRetry((n) => n + 1)}
                  className="underline underline-offset-2"
                >
                  Try again
                </button>
              </div>
            )}
        </div>
        <div className="hidden md:flex items-center justify-between gap-3 border-t border-[var(--reader-border)] px-5 py-3 text-[11px] text-[var(--reader-muted)]">
          <span>
            <kbd className="reader-kbd">↑</kbd>{" "}
            <kbd className="reader-kbd">↓</kbd> choose{" "}
            <kbd className="reader-kbd">Enter</kbd> read
          </span>
          <span>
            <kbd className="reader-kbd">Esc</kbd> close
          </span>
        </div>
        <span role="status" className="sr-only">
          {!loading && count
            ? `${count} reading suggestions. Use up and down arrows to choose, Enter to read.`
            : ""}
        </span>
      </dialog>
    </>
  );
}
