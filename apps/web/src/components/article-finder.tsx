"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import {
  type LibrarySearchMatch,
  librarySearchResponseSchema,
} from "@marginalia/backend/library-search";
import { useAction, useQuery } from "convex/react";
import { Link2, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { CONVEX_SITE_URL } from "@/lib/convex-site";
import { useShortcuts } from "@/lib/shortcuts";
import { useModalDialog } from "@/lib/use-modal-dialog";
import { cn } from "@/lib/utils";

const URL_PATTERN = /^(https?:\/\/|www\.)\S+$/i;
const CACHE_TTL_MS = 5 * 60_000;

/** A keyboard-first search picker: the input keeps focus while arrows choose a result. */
export function ArticleFinder() {
  const router = useRouter();
  const addByUrl = useAction(api.actions.addArticleByUrl.add);
  const overview = useQuery(api.home.overview, {});
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    query: string;
    matches: LibrarySearchMatch[];
    status: "loading" | "ready" | "error";
  }>({ query: "", matches: [], status: "ready" });
  const [selected, setSelected] = useState(0);
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [retry, setRetry] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cache = useRef(
    new Map<string, { time: number; matches: LibrarySearchMatch[] }>(),
  );
  const id = useId();
  const listId = `${id}-results`;
  const text = query.trim();
  const isLink = URL_PATTERN.test(text);
  useShortcuts({ "/": () => setOpen(true) });

  useModalDialog(dialogRef, open, triggerRef);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly reruns a failed request
  useEffect(() => {
    if (!open || text.length < 2 || isLink) return;
    const key = text.toLowerCase();
    const cached = cache.current.get(key);
    if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
      setResult({ query: text, matches: cached.matches, status: "ready" });
      return;
    }
    const controller = new AbortController();
    setResult({ query: text, matches: [], status: "loading" });
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${CONVEX_SITE_URL}/api/library/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: text }),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(30_000),
          ]),
        });
        if (!response.ok) throw new Error(`Search failed (${response.status})`);
        const { matches } = librarySearchResponseSchema.parse(
          await response.json(),
        );
        if (controller.signal.aborted) return;
        if (cache.current.size >= 20) {
          const oldest = cache.current.keys().next().value;
          if (oldest !== undefined) cache.current.delete(oldest);
        }
        cache.current.set(key, { time: Date.now(), matches });
        setResult({ query: text, matches, status: "ready" });
      } catch {
        if (!controller.signal.aborted)
          setResult({ query: text, matches: [], status: "error" });
      }
    }, 600);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, text, isLink, retry]);

  const suggestions: LibrarySearchMatch[] = (overview?.upNext ?? [])
    .slice(0, 5)
    .map((article) => ({
      articleId: article._id,
      title: article.title,
      author: article.author ?? null,
      minutes: article.minutes ?? null,
      status: "Unread",
      reason: article.excerpt || "Waiting in your library, ready to read.",
    }));
  const matches =
    text.length < 2
      ? suggestions
      : result.query === text && result.status === "ready"
        ? result.matches
        : [];
  const count = isLink ? 1 : matches.length;
  const activeId = count
    ? `${id}-option-${Math.min(selected, count - 1)}`
    : undefined;
  const loading =
    text.length >= 2 &&
    !isLink &&
    (result.query !== text || result.status === "loading");

  useEffect(() => {
    if (!open || !activeId) return;
    document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId, open]);

  const choose = async (index: number) => {
    if (fetchingUrl) return;
    if (!isLink) {
      const match = matches[Math.min(index, matches.length - 1)];
      if (!match) return;
      setOpen(false);
      router.push(`/read/${match.articleId}`);
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
          Ask for something to read, or paste a link
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
            aria-label="Search your articles or paste a link"
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
            placeholder="Science, a quick read, that piece about cows…"
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
        <div className="max-h-[min(calc(var(--app-viewport-height)-10rem),480px)] overflow-y-auto overscroll-contain p-2">
          {!text && (
            <p className="px-3 pb-2 pt-1 text-[12px] text-[var(--reader-muted)]">
              Up next · search by topic, time or memory
            </p>
          )}
          <div
            role="listbox"
            id={listId}
            aria-label="Matching articles"
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
              matches.map((match, index) => (
                <button
                  key={match.articleId}
                  type="button"
                  role="option"
                  id={`${id}-option-${index}`}
                  aria-selected={index === selected}
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setSelected(index)}
                  onClick={() => void choose(index)}
                  className={cn(
                    "block w-full rounded-xl px-3 py-3 text-left transition-colors",
                    index === selected
                      ? "bg-[var(--reader-chip)]"
                      : "hover:bg-[var(--reader-chip)]",
                  )}
                >
                  <span className="flex items-baseline gap-4">
                    <span className="flex-1 font-serif text-[20px] leading-snug">
                      {match.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--reader-muted)]">
                      {match.minutes ? `${match.minutes} min` : match.status}
                    </span>
                  </span>
                  <span className="mt-1 block text-[13px] leading-relaxed text-[var(--reader-fg-soft)]">
                    {match.reason}
                  </span>
                  <span className="mt-1 block text-[11px] text-[var(--reader-muted)]">
                    {[match.author, match.status].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))
            )}
          </div>
          {loading && (
            <p
              role="status"
              className="px-3 py-6 text-[14px] text-[var(--reader-muted)]"
            >
              Finding articles that fit…
            </p>
          )}
          {!isLink &&
            text.length >= 2 &&
            result.query === text &&
            result.status === "ready" &&
            !matches.length && (
              <p
                role="status"
                className="px-3 py-6 text-[14px] text-[var(--reader-muted)]"
              >
                Nothing in your library fits that yet. Try another topic or
                paste a link.
              </p>
            )}
          {result.query === text && result.status === "error" && !isLink && (
            <div
              role="alert"
              className="px-3 py-6 text-[14px] text-[var(--reader-fg-soft)]"
            >
              Couldn&apos;t search your library.{" "}
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
            ? `${count} articles. Use up and down arrows to choose, Enter to read.`
            : ""}
        </span>
      </dialog>
    </>
  );
}
