"use client";

import { X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { getArticleBody, getParagraphs } from "@/lib/paragraphs";

/** One docked reading surface for notes, whole-article answers, and future study. */
export function ReaderPane({
  title,
  onClose,
  children,
  focusFallback,
  style,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  focusFallback?: RefObject<HTMLElement | null>;
  style?: React.CSSProperties;
}) {
  const paneRef = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => setMounted(true), []);
  useLayoutEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    delete root.dataset.readerPaneClosing;
    const opener = document.activeElement;
    const captureAnchor = () => {
      const body = getArticleBody(focusFallback?.current ?? null);
      const paragraph = getParagraphs(body).find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      });
      return paragraph
        ? { paragraph, top: paragraph.getBoundingClientRect().top }
        : null;
    };
    const restoreAnchor = (anchor: ReturnType<typeof captureAnchor>) => {
      if (!anchor?.paragraph.isConnected) return;
      window.scrollBy(
        0,
        anchor.paragraph.getBoundingClientRect().top - anchor.top,
      );
    };
    const beforeOpen = captureAnchor();
    root.dataset.readerPane = "";
    const pane = paneRef.current;
    const syncModal = () => {
      if (!pane?.isConnected) return;
      const modal = window.matchMedia("(max-width: 1023px)").matches;
      if (modal && !pane.open) pane.showModal();
      else if (!modal && !pane.open) pane.show();
      else if (modal && !pane.matches(":modal")) {
        pane.close();
        pane.showModal();
      } else if (!modal && pane.matches(":modal")) {
        pane.close();
        pane.show();
      }
      if (modal) pane.focus({ preventScroll: true });
    };
    syncModal();
    const media = window.matchMedia("(max-width: 1023px)");
    media.addEventListener("change", syncModal);
    const openFrame = window.requestAnimationFrame(() =>
      restoreAnchor(beforeOpen),
    );
    return () => {
      media.removeEventListener("change", syncModal);
      window.cancelAnimationFrame(openFrame);
      const beforeClose = captureAnchor();
      delete root.dataset.readerPane;
      root.dataset.readerPaneClosing = "";
      window.setTimeout(() => {
        if (!root.hasAttribute("data-reader-pane"))
          delete root.dataset.readerPaneClosing;
      }, 240);
      window.requestAnimationFrame(() => restoreAnchor(beforeClose));
      const active = document.activeElement;
      const shouldRestoreFocus =
        active === document.body || Boolean(paneRef.current?.contains(active));
      const returnTarget =
        opener instanceof HTMLElement &&
        opener !== document.body &&
        opener.isConnected
          ? opener
          : focusFallback?.current;
      if (pane?.open) pane.close();
      if (shouldRestoreFocus) returnTarget?.focus({ preventScroll: true });
    };
  }, [focusFallback, mounted]);

  const onKeyDownCapture = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return !mounted
    ? null
    : createPortal(
        <dialog
          ref={paneRef}
          aria-label={title}
          tabIndex={-1}
          onKeyDownCapture={onKeyDownCapture}
          onCancel={(event) => {
            event.preventDefault();
            onClose();
          }}
          className="reader-pane fixed inset-x-0 bottom-0 z-50 m-0 h-[var(--app-viewport-height)] max-h-none w-full max-w-none flex-col border-t border-[var(--reader-border)] bg-[var(--reader-bg)] p-0 text-[var(--reader-fg)] shadow-2xl shadow-black/20 backdrop:bg-transparent lg:inset-y-[var(--app-viewport-top)] lg:left-auto lg:right-0 lg:h-[var(--app-viewport-height)] lg:w-[min(50vw,760px)] lg:border-l lg:border-t-0"
          style={style}
        >
          <header className="flex min-h-12 shrink-0 items-center justify-between border-b border-[var(--reader-border)] px-5">
            <h2 className="font-sans text-sm font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Back to passage"
              className="flex h-11 items-center gap-2 rounded-md px-2 text-sm text-[var(--reader-fg-soft)] hover:bg-[var(--reader-chip)] lg:h-8"
            >
              <span className="lg:hidden">Back to passage</span>
              <span className="hidden lg:inline">Close</span>
              <X size={16} aria-hidden />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[env(safe-area-inset-bottom)] pt-5 lg:px-8">
            {children}
          </div>
        </dialog>,
        document.body,
      );
}
