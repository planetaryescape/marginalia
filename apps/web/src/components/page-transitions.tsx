"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function PageTransitions() {
  const pathname = usePathname();
  const router = useRouter();
  const finish = useRef<(() => void) | null>(null);
  useEffect(() => {
    // A pathname commit completes the previous snapshot. Only opt-in chrome
    // links bypass Next's handler, leaving note/save callbacks untouched.
    finish.current?.();
    finish.current = null;
    const navigate = (e: MouseEvent) => {
      if (
        !document.startViewTransition ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        e.defaultPrevented
      )
        return;
      const link =
        e.target instanceof Element
          ? e.target.closest<HTMLAnchorElement>(
              "a[data-reader-transition][href]",
            )
          : null;
      if (!link || link.target || link.download) return;
      const url = new URL(link.href);
      if (
        url.origin !== location.origin ||
        url.hash ||
        url.pathname === pathname ||
        url.pathname.startsWith("/api/")
      )
        return;
      if (finish.current) return;
      e.preventDefault();
      const transition = document.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            const timeout = window.setTimeout(resolve, 2000);
            finish.current = () => {
              clearTimeout(timeout);
              resolve();
            };
            router.push(url.pathname + url.search);
          }),
      );
      void transition.finished.catch(() => {});
    };
    document.addEventListener("click", navigate, true);
    return () => {
      document.removeEventListener("click", navigate, true);
      finish.current?.();
      finish.current = null;
    };
  }, [pathname, router]);
  return null;
}
