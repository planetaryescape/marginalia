"use client";
import { useEffect, useState } from "react";

// Paragraph numbering lives in the shared reader package; this keeps app imports stable.
export {
  flashParagraph,
  getArticleBody,
  getParagraphs,
  paragraphIndexOf,
  paragraphText,
} from "@planetaryescape/reader";

import { getArticleBody } from "@planetaryescape/reader";

/** Marks our own UI placed among the article's blocks (answers unfolded on a phone). */
export const UI_HOST_ATTRIBUTE = "data-marginalia-ui";
const UI_HOST = `[${UI_HOST_ATTRIBUTE}]`;

const BLOCK_SELECTOR =
  "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, figcaption";

const isUiHost = (node: Node) =>
  node instanceof Element && node.matches(UI_HOST);

/**
 * The reader package's `useParagraphs`, except that blocks inside our own UI
 * are never numbered. The package counts every `p` under the article body, so
 * an answer unfolded in the flow would become ¶N and shift every later number.
 * Drop-cap marking is kept as the package does it.
 */
function tagParagraphs(body: HTMLElement): number {
  const leaves = Array.from(
    body.querySelectorAll<HTMLElement>(BLOCK_SELECTOR),
  ).filter(
    (el) =>
      !el.closest(UI_HOST) &&
      !el.querySelector(BLOCK_SELECTOR) &&
      el.textContent?.trim(),
  );
  const leafSet = new Set(leaves);
  for (const el of body.querySelectorAll<HTMLElement>("[data-para]")) {
    if (!leafSet.has(el)) el.removeAttribute("data-para");
  }
  const bodyLeft = body.getBoundingClientRect().left;
  leaves.forEach((el, i) => {
    const label = String(i + 1);
    if (el.dataset.para !== label) el.dataset.para = label;
    el.style.setProperty(
      "--para-indent",
      `${el.getBoundingClientRect().left - bodyLeft}px`,
    );
  });
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
  return leaves.length;
}

/** Whether a DOM change touched only our own UI, which never changes the numbering. */
function onlyUi(record: MutationRecord) {
  if (record.target instanceof Element && record.target.closest(UI_HOST))
    return true;
  const changed = [...record.addedNodes, ...record.removedNodes];
  return changed.length > 0 && changed.every(isUiHost);
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
    const mutations = new MutationObserver((records) => {
      if (!records.every(onlyUi)) retag();
    });
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
