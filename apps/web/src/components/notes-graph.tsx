"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, NodeKind } from "@/lib/idea-kinds";
import { KIND_LABELS } from "@/lib/idea-kinds";
import { IdeaGraphView } from "./idea-graph-view";
import { Composer, EdgePanel, NodePanel } from "./idea-panel";

type Panel =
  | { kind: "closed" }
  | { kind: "node" }
  | { kind: "edge"; edgeId: string }
  | { kind: "compose"; prompt?: string };

const SEARCH_DELAY_MS = 200;

/** Keeps the last answer on screen while a new one loads, so the map doesn't blink. */
function useLatest<T>(value: T | undefined): T | undefined {
  const last = useRef<T | undefined>(undefined);
  if (value !== undefined) last.current = value;
  return last.current;
}

/** The measured width of an element, with a fallback before it is measured. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry.contentRect.width) || fallback),
    );
    observer.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width) || fallback);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

/**
 * Notes as a small map around one idea (D-DES-062). Opens on the latest note;
 * walking to a neighbour, searching, or writing a connected note all move the
 * same map. The list view is one click away through `toggle`.
 */
export function NotesGraph({ toggle }: { toggle: ReactNode }) {
  const [centre, setCentre] = useState<string | undefined>();
  const [panel, setPanel] = useState<Panel>({ kind: "node" });
  const [similar, setSimilar] = useState<{
    for: string;
    keys: string[];
  } | null>(null);
  const [addedKey, setAddedKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const reasonCache = useRef(new Map<string, string>());
  const [stageRef, stageWidth] = useWidth(770);

  const findSimilar = useAction(api.actions.ideaNeighbours.similar);

  // The map's own centre, as the server resolved it (the latest note until one is chosen)
  const [resolved, setResolved] = useState<string | undefined>();
  const live = useQuery(api.ideaGraph.graph, {
    centre,
    similar:
      similar && similar.for === (centre ?? resolved)
        ? similar.keys
        : undefined,
  });
  const graph = useLatest(live);
  const graphCentre = graph?.centre ?? undefined;
  useEffect(() => setResolved(graphCentre), [graphCentre]);
  // The chosen idea was deleted: the server fell back to the latest note
  useEffect(() => {
    if (live && centre && live.centre !== centre) setCentre(undefined);
  }, [live, centre]);

  // Vector search only runs in actions: ask once per centre, and the map folds it in
  useEffect(() => {
    if (!graphCentre) return;
    let current = true;
    findSimilar({ key: graphCentre })
      .then((keys) => current && setSimilar({ for: graphCentre, keys }))
      // Without neighbours by meaning the other connections still draw the map
      .catch(() => current && setSimilar({ for: graphCentre, keys: [] }));
    return () => {
      current = false;
    };
  }, [graphCentre, findSimilar]);

  const openKey = centre ?? graphCentre;
  const labels = useMemo(
    () => new Map(graph?.nodes.map((n) => [n.key, n.label]) ?? []),
    [graph?.nodes],
  );
  const edge: GraphEdge | undefined =
    panel.kind === "edge"
      ? graph?.edges.find((e) => e.id === panel.edgeId)
      : undefined;

  function open(key: string) {
    setCentre(key);
    setPanel({ kind: "node" });
    setFocusKey(key);
    setSaved(false);
  }

  // Taller than wide on a phone, so the ring has room for its labels
  const height = Math.round(
    stageWidth < 520
      ? Math.min(560, Math.max(440, stageWidth * 1.35))
      : Math.min(680, Math.max(440, stageWidth * 0.9)),
  );
  const panelOpen = panel.kind !== "closed";

  return (
    <main
      className="mx-auto w-full max-w-[1180px] px-5 pb-10 pt-[clamp(0.75rem,3vh,2rem)] md:px-10"
      onKeyDown={(event) => {
        if (event.key === "Escape" && panelOpen) {
          setPanel({ kind: "closed" });
          setFocusKey(null);
        }
      }}
    >
      <h1 className="sr-only">Your notes</h1>
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Search onPick={open} />
        <div className="ml-auto">{toggle}</div>
      </div>

      {graph === undefined && (
        <p role="status" className="text-sm text-[var(--reader-muted)]">
          Loading your ideas…
        </p>
      )}

      {graph && graph.nodes.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-sm text-[var(--reader-muted)]">
            No notes yet. Highlight text while reading and write a note; it
            becomes the first idea on your map.
          </p>
        </div>
      )}

      {graph && graph.nodes.length > 0 && (
        <div
          className={
            panelOpen
              ? "grid gap-7 md:grid-cols-[minmax(0,1fr)_380px]"
              : "grid gap-7"
          }
        >
          <div ref={stageRef} className="min-w-0">
            <IdeaGraphView
              graph={graph}
              width={stageWidth}
              height={height}
              edgeId={panel.kind === "edge" ? panel.edgeId : null}
              addedKey={addedKey}
              focusKey={focusKey}
              onOpen={open}
              onEdge={(e) => setPanel({ kind: "edge", edgeId: e.id })}
              onEscape={() => undefined}
            />
            <p
              id="idea-graph-hint"
              className="mt-2 text-[12.5px] text-[var(--reader-muted)]"
            >
              {graph.nodes.length === 1
                ? "Nothing else connects to this yet. Write a note beside it and the map starts here. "
                : ""}
              Arrow keys move between ideas, Enter opens one, Space shows why it
              connects, Esc closes the panel.
            </p>
          </div>

          {panelOpen && openKey && (
            <aside
              aria-label="Selected idea"
              className="min-w-0 border-t border-[var(--reader-border)] pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-[18px]"
            >
              {saved && (
                <p
                  role="status"
                  className="mb-3 text-[13px] text-[var(--reader-fg-soft)]"
                >
                  Saved. Your note is on the map.
                </p>
              )}
              {panel.kind === "node" && (
                <NodePanel
                  nodeKey={openKey}
                  onWrite={(prompt) => {
                    setSaved(false);
                    setPanel({ kind: "compose", prompt });
                  }}
                />
              )}
              {panel.kind === "compose" && (
                <Composer
                  // A fresh draft for each idea it is written beside
                  key={`${openKey}:${panel.prompt ?? ""}`}
                  fromKey={openKey}
                  fromLabel={labels.get(openKey) ?? "this idea"}
                  prompt={panel.prompt}
                  onCancel={() => setPanel({ kind: "node" })}
                  onSaved={(key) => {
                    setAddedKey(key);
                    setSaved(true);
                    setPanel({ kind: "node" });
                  }}
                />
              )}
              {panel.kind === "edge" && edge && (
                <EdgePanel edge={edge} labels={labels} cache={reasonCache} />
              )}
            </aside>
          )}
        </div>
      )}
    </main>
  );
}

function Search({ onPick }: { onPick: (key: string) => void }) {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(
      () => setTerm(text.trim()),
      SEARCH_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [text]);
  const hits = useQuery(
    api.ideaGraph.search,
    term.length >= 2 ? { query: term } : "skip",
  );
  const pick = (key: string) => {
    setText("");
    setTerm("");
    onPick(key);
  };
  return (
    <div className="relative w-full max-w-[520px] flex-1">
      <input
        type="search"
        role="combobox"
        aria-expanded={Boolean(hits?.length)}
        aria-controls="idea-search-results"
        aria-label="Search your ideas"
        placeholder="What are you thinking about?"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && hits?.[0]) pick(hits[0].key);
          if (event.key === "Escape" && text) {
            event.stopPropagation();
            setText("");
          }
        }}
        className="w-full rounded-lg border border-[var(--reader-border-strong)] bg-transparent px-3.5 py-2.5 text-[14.5px] text-[var(--reader-fg)] placeholder:text-[var(--reader-muted)] focus:outline-none focus-visible:border-[var(--reader-focus)]"
      />
      {term.length >= 2 && hits !== undefined && (
        <ul
          id="idea-search-results"
          className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-[var(--reader-border-strong)] bg-[var(--reader-surface)] py-1 shadow-sm"
        >
          {hits.length === 0 && (
            <li className="px-3.5 py-2 text-[13.5px] text-[var(--reader-muted)]">
              Nothing matches “{term}”.
            </li>
          )}
          {hits.map((hit) => (
            <li key={hit.key}>
              <button
                type="button"
                onClick={() => pick(hit.key)}
                className="block w-full px-3.5 py-2 text-left text-[14px] text-[var(--reader-fg)] hover:bg-[var(--reader-chip)]"
              >
                <span className="mr-2 text-[11.5px] uppercase tracking-[0.06em] text-[var(--reader-muted)]">
                  {KIND_LABELS[hit.kind as NodeKind]}
                </span>
                {hit.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
