"use client";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  pushReturn,
  type ReturnEntry,
  returnedTo,
} from "@/lib/paragraph-return";
import {
  flashParagraph,
  getArticleBody,
  getParagraphs,
} from "@/lib/paragraphs";

/** Longest a jump's own scroll is treated as the reader's Plain scrolling. */
const SETTLE_MS = 1500;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Index of the first paragraph whose bottom edge is on screen. */
function paragraphAtTop(body: HTMLElement | null): number {
  const index = getParagraphs(body).findIndex(
    (el) => el.getBoundingClientRect().bottom > 0,
  );
  return index < 0 ? 0 : index;
}

/**
 * Every in-article jump goes through `jump`, which remembers where the reader was.
 * `back` returns to the newest remembered place with the same scroll the jump used.
 * Scrolling back to within a viewport of that place yourself also counts as returning.
 */
export function useParagraphReturn(articleRef: RefObject<HTMLElement | null>) {
  const [stack, setStackState] = useState<ReturnEntry[]>([]);
  // A ref mirrors the stack so scroll and key handlers never act on a stale copy.
  const stackRef = useRef<ReturnEntry[]>([]);
  const settling = useRef<number | null>(null);

  const setStack = useCallback((next: ReturnEntry[]) => {
    stackRef.current = next;
    setStackState(next);
  }, []);

  // A jump's own scroll is not the reader scrolling back, so scroll events are ignored
  // until it lands (scrollend, or the timeout where scrollend is unsupported).
  const settle = useCallback(() => {
    if (settling.current !== null) window.clearTimeout(settling.current);
    const done = () => {
      if (settling.current !== null) window.clearTimeout(settling.current);
      settling.current = null;
      window.removeEventListener("scrollend", done);
    };
    window.addEventListener("scrollend", done, { once: true });
    settling.current = window.setTimeout(done, SETTLE_MS);
  }, []);

  const jump = useCallback(
    (index: number) => {
      const body = getArticleBody(articleRef.current);
      const el = getParagraphs(body)[index];
      if (!el) return;
      setStack(
        pushReturn(
          stackRef.current,
          { scrollY: window.scrollY, paragraph: paragraphAtTop(body) },
          window.innerHeight,
        ),
      );
      settle();
      // flashParagraph always scrolls smoothly; reduced motion lands first, instantly.
      if (reducedMotion())
        el.scrollIntoView({ block: "center", behavior: "instant" });
      flashParagraph(el);
    },
    [articleRef, setStack, settle],
  );

  const back = useCallback(() => {
    const current = stackRef.current;
    const last = current[current.length - 1];
    if (!last) return;
    setStack(current.slice(0, -1));
    settle();
    window.scrollTo({
      top: last.scrollY,
      behavior: reducedMotion() ? "instant" : "smooth",
    });
  }, [setStack, settle]);

  useEffect(() => {
    const onScroll = () => {
      if (settling.current !== null) return;
      const next = returnedTo(
        stackRef.current,
        window.scrollY,
        window.innerHeight,
      );
      if (next !== stackRef.current) setStack(next);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (settling.current !== null) window.clearTimeout(settling.current);
    };
  }, [setStack]);

  return { top: stack[stack.length - 1] ?? null, jump, back };
}
