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
import {
  invalidateParagraphGeometry,
  paragraphGeometry,
} from "./paragraph-geometry";

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
function tagParagraphs(body: HTMLElement): HTMLElement[] {
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
  leaves.forEach((el, i) => {
    const label = String(i + 1);
    if (el.dataset.para !== label) el.dataset.para = label;
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
  return leaves;
}

function measureIndents(body: HTMLElement, leaves: HTMLElement[]) {
  const geometry = paragraphGeometry(body);
  if (!geometry) return;
  const bodyLeft = geometry.body.left;
  // Read the whole column before writing any paragraph's style.
  const indents = leaves.map((_el, i) => geometry.rects[i].left - bodyLeft);
  leaves.forEach((el, i) => {
    const value = `${indents[i]}px`;
    if (el.style.getPropertyValue("--para-indent") !== value)
      el.style.setProperty("--para-indent", value);
  });
}

/** Whether a DOM change touched only our own UI, which never changes the numbering. */
function onlyUi(record: MutationRecord) {
  const target =
    record.target instanceof Element
      ? record.target
      : record.target.parentElement;
  if (target?.closest(UI_HOST)) return true;
  const changed = [...record.addedNodes, ...record.removedNodes];
  return changed.length > 0 && changed.every(isUiHost);
}

/** `version` is a prose epoch: geometry-only changes never invalidate text ranges. */
export function useParagraphs(
  containerRef: React.RefObject<HTMLElement | null>,
  ready: boolean,
) {
  const [state, setState] = useState({
    count: 0,
    version: 0,
    layoutVersion: 0,
  });

  useEffect(() => {
    const body = getArticleBody(containerRef.current);
    if (!ready || !body) return;

    let frame = 0;
    let contentChanged = false;
    let indentsChanged = false;
    let leaves: HTMLElement[] = [];
    const initial = body.getBoundingClientRect();
    let width = initial.width;
    let height = initial.height;
    const schedule = (content: boolean, indents = true) => {
      contentChanged ||= content;
      indentsChanged ||= indents;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const proseChanged = contentChanged;
        if (proseChanged) {
          leaves = tagParagraphs(body);
          invalidateParagraphGeometry(body);
          contentChanged = false;
        }
        if (indentsChanged) measureIndents(body, leaves);
        indentsChanged = false;
        setState((s) => ({
          count: leaves.length,
          version: s.version + (proseChanged ? 1 : 0),
          layoutVersion: s.layoutVersion + 1,
        }));
      });
    };

    schedule(true);
    const mutations = new MutationObserver((records) => {
      if (!records.every(onlyUi)) schedule(true);
    });
    mutations.observe(body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    const resize = new ResizeObserver((records) => {
      const rect = records[0]?.contentRect ?? body.getBoundingClientRect();
      if (rect.width === width && rect.height === height) return;
      // Inline UI growth changes placement, but neither ranges nor horizontal indents.
      schedule(false, rect.width !== width);
      width = rect.width;
      height = rect.height;
    });
    resize.observe(body);
    const geometryChanged = () => schedule(false);
    window.addEventListener("resize", geometryChanged);
    const settings = new MutationObserver(geometryChanged);
    if (containerRef.current)
      settings.observe(containerRef.current, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    let disposed = false;
    document.fonts?.ready.then(() => {
      if (!disposed) geometryChanged();
    });
    document.fonts?.addEventListener("loadingdone", geometryChanged);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      settings.disconnect();
      window.removeEventListener("resize", geometryChanged);
      document.fonts?.removeEventListener("loadingdone", geometryChanged);
    };
  }, [containerRef, ready]);

  return state;
}
