"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type AnnotationKind, KINDS, plainNote } from "@/lib/margin-kinds";
import {
  type LayoutNote,
  layoutMargin,
  type Placement,
} from "@/lib/margin-layout";
import { type MarginMode, measureGutter } from "@/lib/margin-mode";
import { getArticleBody } from "@/lib/paragraphs";
import type { ReaderSettings } from "@/lib/reader-settings";
import { findTextRange } from "@/lib/text-range";
import { usePrefersReducedMotion } from "@/lib/use-margin-mode";

const COLLAPSED_HEIGHT = 20;
const MAX_WIDTH = 300;
/** The bottom 40% of the viewport is outside the zone, so a note arrives as its line rises into the upper 60%. */
const ARRIVAL_ROOT_MARGIN = "0px 0px -40% 0px";
/** Aligns the connector (6px into the note) with the middle of the line. */
const CONNECTOR_OFFSET = 6;

export interface SidenoteAnnotation {
  _id: string;
  type: AnnotationKind;
  content: string;
}

export interface SidenoteUserNote {
  _id: string;
  selectedText: string;
  contentPlain: string;
  annotationId?: string;
}

interface SidenoteMark {
  doc: { _id: string };
  range: Range;
}

type Entry =
  | {
      key: string;
      kind: "annotation";
      id: string;
      type: AnnotationKind;
      text: string;
    }
  | {
      key: string;
      kind: "note";
      id: string;
      text: string;
      selectedText: string;
    }
  | { key: "waiting"; kind: "waiting" };

interface LayoutState {
  placements: Record<string, Placement>;
  labels: Record<string, string>;
  ticks: { key: string; top: number }[];
}

const EMPTY: LayoutState = { placements: {}, labels: {}, ticks: [] };

/**
 * The motion token's duration and easing, so the slot's height and the notes'
 * slide run on one clock. The fallback is the token in globals.css.
 */
function moveTiming(): { duration: number; easing: string } {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--motion-move")
    .trim();
  const match = /^(\d+)ms\s+(.+)$/.exec(raw);
  return match
    ? { duration: Number(match[1]), easing: match[2] }
    : { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
}

/**
 * A note's natural height. An open note measures its card, which keeps its
 * height while the slot around it is animating.
 */
function naturalHeight(el: HTMLElement): number {
  return el.dataset.open === "true"
    ? (el.querySelector<HTMLElement>(".sidenote-card")?.offsetHeight ??
        el.offsetHeight)
    : el.offsetHeight;
}

function firstRect(rects: DOMRectList | DOMRect[] | undefined): DOMRect | null {
  const rect = rects?.[0];
  return rect && (rect.width > 0 || rect.height > 0) ? rect : null;
}

const textId = (key: string) => `sidenote-text-${key.replace(/[^\w-]/g, "_")}`;

export function Sidenotes({
  containerRef,
  mode,
  version,
  layoutKey,
  annotations,
  userNotes,
  marks,
  waiting,
  openId,
  onClose,
  onOpenNotes,
  openCard,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  mode: MarginMode;
  /** Bumps when the article's paragraphs are re-tagged, i.e. its HTML or size changed. */
  version: number;
  /** Changes with text settings that move lines without resizing the article. */
  layoutKey: ReaderSettings;
  annotations: SidenoteAnnotation[] | undefined;
  userNotes: SidenoteUserNote[] | undefined;
  marks: SidenoteMark[];
  /** Annotation is still running for this article. */
  waiting: boolean;
  /** The annotation whose card is open, if any. */
  openId: string | null;
  onClose: () => void;
  onOpenNotes: () => void;
  /** The open annotation's card; it takes the open note's place in the column. */
  openCard?: ReactNode;
}) {
  const active = mode === "sidenotes";
  const layerRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const [layout, setLayout] = useState<LayoutState>(EMPTY);
  const layoutJson = useRef("");
  const reduced = usePrefersReducedMotion();
  const [arrived, setArrived] = useState<ReadonlySet<string>>(new Set());

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];
    if (waiting) list.push({ key: "waiting", kind: "waiting" });
    for (const a of annotations ?? []) {
      list.push({
        key: `a:${a._id}`,
        kind: "annotation",
        id: a._id,
        type: a.type,
        text: plainNote(a.content),
      });
    }
    // Reflections on an annotation live inside that annotation's card.
    // Offsets are never saved by the reader today, so notes anchor by the
    // passage they quote, the way highlights do.
    for (const n of userNotes ?? []) {
      const first = n.contentPlain.split("\n").find((l) => l.trim()) ?? "";
      if (n.annotationId || !n.selectedText.trim() || !first) continue;
      list.push({
        key: `n:${n._id}`,
        kind: "note",
        id: n._id,
        text: first.trim(),
        selectedText: n.selectedText,
      });
    }
    return list;
  }, [annotations, userNotes, waiting]);

  // Resolved ranges survive layout passes; they only go stale with the HTML.
  const ranges = useRef<{ key: string; map: Map<string, Range | null> }>({
    key: "",
    map: new Map(),
  });

  const run = useCallback(() => {
    const layer = layerRef.current;
    const container = containerRef.current;
    const body = getArticleBody(container);
    if (!layer || !container || !body) return;

    const gutter = measureGutter(container);
    const left = container.getBoundingClientRect().right + window.scrollX + 8;
    layer.style.setProperty("--sidenote-left", `${left}px`);
    layer.style.setProperty(
      "--sidenote-width",
      `${Math.min(MAX_WIDTH, gutter - 48)}px`,
    );

    const rangeKey = `${version}|${entries.map((e) => e.key).join(",")}`;
    if (ranges.current.key !== rangeKey) {
      ranges.current = { key: rangeKey, map: new Map() };
    }
    const scrollY = window.scrollY;
    const centred = (rect: DOMRect) =>
      rect.top + scrollY + rect.height / 2 - CONNECTOR_OFFSET;

    const notes: LayoutNote[] = [];
    const labels: Record<string, string> = {};
    for (const entry of entries) {
      const el = nodes.current.get(entry.key);
      if (!el) continue;
      let rect: DOMRect | null = null;
      let host: Element | null = null;
      if (entry.kind === "annotation") {
        host = body.querySelector(
          `[data-annotation-id="${CSS.escape(entry.id)}"]`,
        );
        rect = firstRect(host?.getClientRects());
      } else if (entry.kind === "note") {
        let range = ranges.current.map.get(entry.key);
        if (range === undefined) {
          range = findTextRange(body, entry.selectedText);
          ranges.current.map.set(entry.key, range);
        }
        rect = firstRect(range?.getClientRects());
        host =
          range?.startContainer instanceof Element
            ? range.startContainer
            : (range?.startContainer.parentElement ?? null);
      } else {
        host = body.querySelector("[data-para]") ?? body;
        rect = firstRect(host.getClientRects());
      }
      if (!rect) continue;
      const para = host?.closest<HTMLElement>("[data-para]")?.dataset.para;
      if (para) labels[entry.key] = `¶${para}`;
      // The open card is the whole note; a collapsed note measures its hidden body.
      const isOpenNote = el.dataset.open === "true";
      const height = isOpenNote
        ? naturalHeight(el)
        : (el.querySelector<HTMLElement>(".sidenote-body")?.scrollHeight ??
          COLLAPSED_HEIGHT);
      notes.push({
        id: entry.key,
        anchor: entry.kind === "waiting" ? rect.top + scrollY : centred(rect),
        height,
        collapsedHeight: entry.kind === "waiting" ? height : COLLAPSED_HEIGHT,
        hand: entry.kind === "note" ? "pen" : "pencil",
        mergeable: entry.kind !== "waiting" && !isOpenNote,
      });
    }

    const placements = layoutMargin(notes, {
      contentEnd: body.getBoundingClientRect().bottom + scrollY,
      openId: openId ? `a:${openId}` : undefined,
    });
    const ticks = marks.flatMap((m) => {
      const rect = m.range.startContainer.isConnected
        ? firstRect(m.range.getClientRects())
        : null;
      return rect
        ? [{ key: m.doc._id, top: rect.top + scrollY + rect.height / 2 - 1 }]
        : [];
    });

    const next: LayoutState = {
      placements: Object.fromEntries(placements.map((p) => [p.id, p])),
      labels,
      ticks,
    };
    const json = JSON.stringify(next);
    if (json === layoutJson.current) return;
    layoutJson.current = json;
    setLayout(next);
  }, [containerRef, entries, marks, version, openId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `layoutKey` asks for a re-measure
  useLayoutEffect(() => {
    if (active) run();
  }, [active, run, layoutKey]);

  // The open card grows as its content streams in, and the notes below follow its height.
  useEffect(() => {
    const el = openId ? nodes.current.get(`a:${openId}`) : undefined;
    if (!active || !el) return;
    // Observe the card itself: its size is its content's, not the animated slot's.
    const resize = new ResizeObserver(() => run());
    resize.observe(el.querySelector<HTMLElement>(".sidenote-card") ?? el);
    return () => resize.disconnect();
  }, [active, openId, run]);

  // Notes that move slide from where they were, so they never jump. A note that
  // opens or closes also grows or shrinks its slot over the same duration and
  // easing, so the slide and the height stay in step.
  const lastTops = useRef(new Map<string, number>());
  const slots = useRef(
    new Map<string, { open: boolean; height: number; animation?: Animation }>(),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `openId` must run this pass even when the layout is unchanged
  useLayoutEffect(() => {
    for (const [key, placement] of Object.entries(layout.placements)) {
      const previous = lastTops.current.get(key);
      lastTops.current.set(key, placement.top);
      const el = nodes.current.get(key);
      if (
        !el ||
        reduced ||
        previous === undefined ||
        previous === placement.top
      )
        continue;
      el.style.transition = "none";
      el.style.transform = `translateY(${previous - placement.top}px)`;
      void el.offsetHeight;
      el.style.transition = "";
      el.style.transform = "";
    }
    for (const [key, el] of nodes.current) {
      const open = el.dataset.open === "true";
      const slot = slots.current.get(key);
      if (!slot) {
        slots.current.set(key, { open, height: naturalHeight(el) });
        continue;
      }
      if (slot.open === open) {
        // Track the settled height so the next open or close starts from it.
        if (slot.animation?.playState !== "running")
          slot.height = naturalHeight(el);
        continue;
      }
      // Measure from the height it settled at, then animate to the new one.
      slot.open = open;
      slot.animation?.cancel();
      const to = naturalHeight(el);
      if (!reduced) {
        el.style.overflow = "hidden";
        const animation = el.animate(
          [{ height: `${slot.height}px` }, { height: `${to}px` }],
          moveTiming(),
        );
        slot.animation = animation;
        animation.finished.then(
          () => {
            el.style.overflow = "";
          },
          // Cancelled by a newer change, which owns the overflow now.
          () => {},
        );
      }
      slot.height = to;
    }
  }, [layout, openId, reduced]);

  // Anything that moves lines without a React update: resize, the notes pane, web fonts.
  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;
    let frame = 0;
    let disposed = false;
    const schedule = () => {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(run);
    };
    window.addEventListener("resize", schedule);
    const resize = new ResizeObserver(schedule);
    resize.observe(container);
    document.fonts?.ready.then(schedule);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      resize.disconnect();
    };
  }, [active, containerRef, run]);

  // The mark is where keyboard and screen reader users meet a note, so it carries the note's text.
  const placedKeys = Object.keys(layout.placements).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` signals the article HTML was replaced
  useEffect(() => {
    const body = getArticleBody(containerRef.current);
    if (!active || !body) return;
    const described: Element[] = [];
    for (const key of placedKeys.split(",")) {
      if (!key.startsWith("a:")) continue;
      const mark = body.querySelector(
        `[data-annotation-id="${CSS.escape(key.slice(2))}"]`,
      );
      mark?.setAttribute("aria-describedby", textId(key));
      if (mark) described.push(mark);
    }
    return () => {
      for (const mark of described) mark.removeAttribute("aria-describedby");
    };
  }, [active, containerRef, placedKeys, version]);

  // A note arrives once, when its line first rises into view.
  useEffect(() => {
    if (!active || reduced) return;
    const pending = placedKeys
      .split(",")
      .filter((key) => key && key !== "waiting" && !arrived.has(key));
    if (!pending.length) return;
    const observer = new IntersectionObserver(
      (records) => {
        const fresh = records
          .filter(
            (r) =>
              r.isIntersecting ||
              // Already scrolled past: nothing left to animate.
              r.boundingClientRect.bottom < (r.rootBounds?.top ?? 0),
          )
          .map((r) =>
            r.target instanceof HTMLElement ? r.target.dataset.key : undefined,
          )
          .filter((key): key is string => Boolean(key));
        if (!fresh.length) return;
        setArrived((prev) => new Set([...prev, ...fresh]));
      },
      { rootMargin: ARRIVAL_ROOT_MARGIN },
    );
    for (const key of pending) {
      const el = nodes.current.get(key);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [active, reduced, placedKeys, arrived]);

  const openMark = (id: string) =>
    getArticleBody(containerRef.current)
      ?.querySelector<HTMLElement>(`[data-annotation-id="${CSS.escape(id)}"]`)
      // Same path as the `o` shortcut: the renderer opens the card and marks it viewed.
      ?.click();

  // A click on the page closes the open note.
  useEffect(() => {
    if (!active || !openId) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (
        !target?.closest ||
        target.closest(
          ".annotation-mark, .sidenote, [role='dialog'], [role='menu'], [data-radix-popper-content-wrapper]",
        )
      )
        return;
      if (!window.getSelection()?.isCollapsed) return;
      onClose();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [active, openId, onClose]);

  // Closing hands focus back to the note the card grew from.
  const lastOpen = useRef<string | null>(null);
  useEffect(() => {
    const closed = lastOpen.current;
    lastOpen.current = openId;
    if (!closed || openId) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body) return;
    nodes.current
      .get(`a:${closed}`)
      ?.querySelector<HTMLElement>(".sidenote-hit")
      ?.focus({ preventScroll: true });
  }, [openId]);

  if (!active) return null;

  const register = (key: string) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(key, el);
    else nodes.current.delete(key);
  };

  return (
    <div ref={layerRef} className="sidenote-layer" data-sidenotes>
      {entries.map((entry) => {
        const placement = layout.placements[entry.key];
        const isNote = entry.kind === "note";
        const kind =
          entry.kind === "annotation" ? KINDS[entry.type] : undefined;
        const label = isNote ? "your note" : (kind?.name ?? "");
        const paragraph = layout.labels[entry.key];
        const isOpen = entry.kind === "annotation" && entry.id === openId;
        const isArrived =
          reduced ||
          isOpen ||
          entry.kind === "waiting" ||
          arrived.has(entry.key);
        const common = {
          ref: register(entry.key),
          "data-key": entry.key,
          "data-placed": placement ? "true" : "false",
          "data-arrived": isArrived ? "true" : "false",
          // SAFETY: custom properties are valid inline style keys; React types only know CSS properties.
          style: {
            top: placement?.top ?? 0,
            "--elbow": `${placement?.elbow ?? 0}px`,
          } as React.CSSProperties,
        };

        if (entry.kind === "waiting") {
          return (
            <div
              key={entry.key}
              {...common}
              className="sidenote sidenote-waiting"
              role="status"
            >
              <span className="sidenote-body">
                <svg
                  width="220"
                  height="14"
                  viewBox="0 0 220 14"
                  aria-hidden="true"
                  className="sidenote-pencil"
                >
                  <path d="M2 8 C 30 1, 50 13, 80 6 S 130 1, 160 8 S 200 11, 218 5" />
                </svg>
                <span className="sidenote-waiting-text">
                  Reading alongside you…
                </span>
              </span>
            </div>
          );
        }

        return (
          <div
            key={entry.key}
            {...common}
            className="sidenote"
            data-hand={isNote ? "pen" : "pencil"}
            data-collapsed={placement?.collapsed ? "true" : "false"}
            data-open={isOpen ? "true" : "false"}
            // SAFETY: custom properties are valid inline style keys; React types only know CSS properties.
            style={
              {
                ...common.style,
                "--kind-color": kind?.color,
              } as React.CSSProperties
            }
          >
            {isOpen && openCard ? (
              <div className="sidenote-card">{openCard}</div>
            ) : (
              <>
                {(placement?.connector ?? true) && (
                  <span
                    className="sidenote-connector"
                    data-bent={
                      placement && placement.elbow > 1 ? "true" : "false"
                    }
                    aria-hidden="true"
                  />
                )}
                <button
                  type="button"
                  className="sidenote-hit"
                  // Marks are the keyboard stop for annotations (they carry this
                  // text via aria-describedby); your own notes have no mark, so
                  // they take a stop of their own.
                  tabIndex={isNote ? 0 : -1}
                  aria-label={`${label}: ${entry.text}`}
                  onClick={() => (isNote ? onOpenNotes() : openMark(entry.id))}
                >
                  <span className="sidenote-body">
                    <span className="sidenote-kind">
                      {kind && (
                        <i className="sidenote-dot" aria-hidden="true" />
                      )}
                      {label}
                    </span>
                    <span className="sidenote-text" id={textId(entry.key)}>
                      {entry.text}
                    </span>
                  </span>
                  <span className="sidenote-line" aria-hidden="true">
                    <i className="sidenote-dot" />
                    {label}
                    {paragraph ? ` · ${paragraph}` : ""}
                  </span>
                </button>
              </>
            )}
          </div>
        );
      })}
      {layout.ticks.map((tick) => (
        <span
          key={tick.key}
          className="sidenote-tick"
          style={{ top: tick.top }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
