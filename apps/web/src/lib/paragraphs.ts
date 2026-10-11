"use client";
import { useEffect, useState } from "react";

// Paragraph numbering is shared by ¶ labels, the map, focus mode, listen mode
// and the reading companion, so ¶N always means the same block everywhere.
const BLOCK_SELECTOR =
  "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, figcaption";

export function getArticleBody(
  container: HTMLElement | null,
): HTMLElement | null {
  return container?.querySelector<HTMLElement>("[data-article-body]") ?? null;
}

function tagParagraphs(body: HTMLElement): number {
  const leaves = Array.from(
    body.querySelectorAll<HTMLElement>(BLOCK_SELECTOR),
  ).filter((el) => !el.querySelector(BLOCK_SELECTOR) && el.textContent?.trim());
  const leafSet = new Set(leaves);
  for (const el of body.querySelectorAll<HTMLElement>("[data-para]")) {
    if (!leafSet.has(el)) el.removeAttribute("data-para");
  }
  const bodyLeft = body.getBoundingClientRect().left;
  leaves.forEach((el, i) => {
    const label = String(i + 1);
    if (el.dataset.para !== label) el.dataset.para = label;
    // Lets the ¶ label sit in the same gutter column for indented list items.
    el.style.setProperty(
      "--para-indent",
      `${el.getBoundingClientRect().left - bodyLeft}px`,
    );
  });
  markDropCap(body, leaves);
  return leaves.length;
}

// The drop cap goes on the first real paragraph of prose, skipping dates,
// bylines and captions that often open extracted articles.
function markDropCap(body: HTMLElement, leaves: HTMLElement[]) {
  const target = leaves.find(
    (el) =>
      el.tagName === "P" &&
      !el.closest("blockquote, li, figure, aside") &&
      (el.textContent ?? "").trim().length >= 120 &&
      /^[\s"'“‘(]*[A-Za-z0-9]/.test(el.textContent ?? ""),
  );
  for (const el of body.querySelectorAll<HTMLElement>("[data-dropcap]")) {
    if (el !== target) el.removeAttribute("data-dropcap");
  }
  if (target && !target.hasAttribute("data-dropcap"))
    target.setAttribute("data-dropcap", "");
}

export function getParagraphs(body: HTMLElement | null): HTMLElement[] {
  return body
    ? Array.from(body.querySelectorAll<HTMLElement>("[data-para]"))
    : [];
}

export function paragraphText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  for (const sup of clone.querySelectorAll(".annotation-mark sup"))
    sup.remove();
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function paragraphIndexOf(node: Node | null): number | null {
  const el = node instanceof Element ? node : node?.parentElement;
  const para = el?.closest<HTMLElement>("[data-para]");
  return para ? Number(para.dataset.para) - 1 : null;
}

export function flashParagraph(el: HTMLElement) {
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("para-flash");
  void el.offsetWidth;
  el.classList.add("para-flash");
  window.setTimeout(() => el.classList.remove("para-flash"), 1800);
}

/** Keeps `data-para` labels in sync with the rendered article. Returns a version that bumps on every re-tag. */
export function useParagraphs(
  containerRef: React.RefObject<HTMLElement | null>,
  ready: boolean,
) {
  const [state, setState] = useState({ count: 0, version: 0 });

  useEffect(() => {
    const body = getArticleBody(containerRef.current);
    if (!ready || !body) return;

    let frame = 0;
    const retag = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const count = tagParagraphs(body);
        setState((s) => ({ count, version: s.version + 1 }));
      });
    };

    retag();
    const mutations = new MutationObserver(retag);
    mutations.observe(body, { childList: true, subtree: true });
    const resize = new ResizeObserver(retag);
    resize.observe(body);
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
    };
  }, [containerRef, ready]);

  return state;
}
