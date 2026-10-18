"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LeavingLink } from "@/lib/reader-links";
import { invalidateTopicSearchCache } from "@/lib/topic-search-cache";

const MARGIN = 16;
const GAP = 8;

type SaveState = "idle" | "saving" | "saved" | "failed";

/**
 * The small menu a plain click on a link in the article opens. It leaves the
 * page where it is: Save for later puts the link into the library as Saved,
 * and Open in background opens it in a new tab. Esc closes it and returns focus
 * to the link; a click outside closes it without moving focus.
 */
export function ReaderLinkMenu({
  link,
  onClose,
}: {
  link: LeavingLink;
  onClose: () => void;
}) {
  const found = useQuery(api.articles.findByUrl, { url: link.href });
  const addByUrl = useAction(api.actions.addArticleByUrl.add);
  const saveArticle = useMutation(api.savedArticles.save);

  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  // A ref, not state: a second click before the first save settles must not start another
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The document listeners below are attached once; they read the latest props from here
  const live = useRef({ link, onClose });
  useEffect(() => {
    live.current = { link, onClose };
  });

  const close = (restoreFocus: boolean) => {
    if (restoreFocus) live.current.link.anchor.focus();
    live.current.onClose();
  };

  // Escape closes from anywhere, including while focus is still on the link
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      live.current.link.anchor.focus();
      live.current.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A click outside the menu (other than on the link itself) dismisses it
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        menuRef.current?.contains(target) ||
        live.current.link.anchor.contains(target)
      )
        return;
      live.current.onClose();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, []);

  // Scrolling moves the link out from under the menu, so the menu closes rather than follow it
  useEffect(() => {
    const onScroll = () => live.current.onClose();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = link.anchor.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = menu;
    const below = rect.bottom + GAP;
    const top =
      below + height + MARGIN <= window.innerHeight
        ? below
        : Math.max(MARGIN, rect.top - GAP - height);
    const left = Math.min(
      Math.max(MARGIN, rect.left),
      window.innerWidth - width - MARGIN,
    );
    setPosition({ top, left });
  }, [link.anchor]);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  const isSaved = state === "saved" || found?.saved === true;

  async function saveForLater() {
    if (busy.current || isSaved || found === undefined) return;
    busy.current = true;
    setState("saving");
    setError(null);
    try {
      // The lookup says whether the link is already in the library; only a new
      // link is imported, and then saved like any other
      const articleId = found
        ? found._id
        : (await addByUrl({ url: link.href })).articleId;
      if (!found) invalidateTopicSearchCache();
      await saveArticle({ articleId });
      invalidateTopicSearchCache();
      if (mounted.current) setState("saved");
    } catch (err) {
      if (!mounted.current) return;
      setState("failed");
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't save that link. Try again.",
      );
    } finally {
      busy.current = false;
    }
  }

  function openInBackground() {
    // Browsers choose whether a script-opened tab takes focus. noopener keeps the
    // new page from reaching this one; see the reader docs for what is observed.
    window.open(link.href, "_blank", "noopener,noreferrer");
    close(true);
  }

  const host = hostOf(link.href);
  const title = found?.title || link.text || host;
  const minutes = found?.estimatedReadMinutes;

  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-label="Link"
      tabIndex={-1}
      data-testid="reader-link-menu"
      className="reader-menu fixed z-50 w-72 p-1.5 outline-none"
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <div className="px-2.5 pt-1.5 pb-2">
        <p className="font-serif text-[15px] leading-snug line-clamp-2">
          {title}
        </p>
        <p className="mt-0.5 text-xs font-sans text-[var(--reader-muted)]">
          {host}
          {minutes ? ` · ${minutes} min read` : null}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void saveForLater()}
        disabled={found === undefined || state === "saving" || isSaved}
        className="flex w-full items-baseline justify-between gap-3 whitespace-nowrap rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--reader-chip)] disabled:opacity-60"
      >
        <span>
          {isSaved
            ? "Saved"
            : state === "saving"
              ? "Saving…"
              : "Save for later"}
        </span>
        {!isSaved && state !== "saving" ? (
          <span className="text-xs text-[var(--reader-muted)]">
            back to you as a pick
          </span>
        ) : null}
      </button>
      {error ? (
        <p role="alert" className="px-2.5 pb-1 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      <hr className="my-1 border-[var(--reader-border)]" />
      <button
        type="button"
        onClick={openInBackground}
        className="flex w-full items-baseline justify-between gap-3 whitespace-nowrap rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--reader-chip)]"
      >
        <span>Open in background</span>
        <span className="text-xs text-[var(--reader-muted)]">new tab</span>
      </button>
    </div>
  );
}

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}
