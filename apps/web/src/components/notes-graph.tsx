"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Skeleton, SkeletonBar } from "@/components/in-place";
import { Keycap } from "@/components/keycap";
import { authClient } from "@/lib/auth-client";
import { discoveryInvalidation } from "@/lib/discovery-invalidation";
import type { Graph, GraphEdge, NodeKind } from "@/lib/idea-kinds";
import { KIND_LABELS } from "@/lib/idea-kinds";
import { SessionCache } from "@/lib/session-cache";
import { useShortcuts } from "@/lib/shortcuts";
import { useDiscoveryRevision } from "@/lib/use-discovery-revision";
import { invalidateTopicSearchCache } from "@/lib/use-topic-search";
import { IdeaGraphLegend, IdeaGraphView } from "./idea-graph-view";
import { Composer, EdgePanel, NodePanel } from "./idea-panel";

type Panel =
  | { kind: "closed" }
  | { kind: "node" }
  | { kind: "edge"; edgeId: string }
  | { kind: "compose"; prompt?: string };

type GraphRequest = {
  key: string;
  navigation: number;
  generation: number;
  revision: string | null;
  cached?: Graph;
};

const SEARCH_DELAY_MS = 200;

/** Keeps the last answer on screen while a new one loads, so the map doesn't blink. */
function useLatest<T>(value: T | undefined): T | undefined {
  const last = useRef<T | undefined>(undefined);
  if (value !== undefined) last.current = value;
  return last.current;
}

/**
 * The measured width of an element, with a fallback before it is measured.
 * The element mounts only once there is a map to draw, so it is found through
 * a callback ref: an effect on a plain ref would run before it exists.
 */
function useWidth(fallback: number) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry.contentRect.width) || fallback),
    );
    observer.observe(element);
    setWidth(Math.floor(element.getBoundingClientRect().width) || fallback);
    return () => observer.disconnect();
  }, [element, fallback]);
  return [setElement, width] as const;
}

/**
 * Notes as a small map around one idea (D-DES-062). Opens on the latest note;
 * walking to a neighbour, searching, or writing a connected note all move the
 * same map. The list view is one click away through `toggle`.
 */
export function NotesGraph({ toggle }: { toggle: ReactNode }) {
  const { data: session } = authClient.useSession();
  const sessionId = session?.session.id ?? null;
  // The entire private map/panel/search draft is scoped, including the retained
  // last graph during useQuery's undefined gap and late child action callbacks.
  return sessionId ? (
    <SessionNotesGraph key={sessionId} sessionId={sessionId} toggle={toggle} />
  ) : (
    <main aria-label="Your notes" />
  );
}

function SessionNotesGraph({
  toggle,
  sessionId,
}: {
  toggle: ReactNode;
  sessionId: string;
}) {
  const [neighbours] = useState(
    // Epoch/local/tab signals evict reuse, never refresh the active map.
    () => new SessionCache<{ key: string; via?: string }[]>(20, 60_000),
  );
  neighbours.forScope(sessionId);
  const [snapshots] = useState(() => new SessionCache<Graph>(20, 60_000));
  snapshots.forScope(sessionId);
  const revision = useDiscoveryRevision(sessionId, (token) => {
    neighbours.observeRevision(token);
    snapshots.observeRevision(token);
  });
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const off = discoveryInvalidation.subscribe(() => {
      neighbours.invalidate();
      snapshots.invalidate();
    });
    return () => {
      mounted.current = false;
      off();
    };
  }, [neighbours, snapshots]);
  const [centre, setCentre] = useState<string | undefined>();
  const [navigation, setNavigation] = useState(0);
  // For a vault idea: the passage it was chosen by
  const [centreVia, setCentreVia] = useState<string | undefined>();
  const [panel, setPanel] = useState<Panel>({ kind: "node" });
  const [similar, setSimilar] = useState<{
    sessionId: string;
    navigation: number;
    for: string;
    hints: { key: string; via?: string }[];
    cacheable: boolean;
  } | null>(null);
  const [addedKey, setAddedKey] = useState<string | null>(null);
  // The note just written, asked to be on the map whatever else is near it
  const [pinned, setPinned] = useState<string | undefined>();
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedEpoch, setSavedEpoch] = useState<{ token: string } | null>(null);
  const [stageRef, stageWidth] = useWidth(770);

  const findSimilar = useAction(api.actions.ideaNeighbours.similar);

  // The map's own centre, as the server resolved it (the latest note until one is chosen)
  const [resolved, setResolved] = useState<string | undefined>();
  const requestKey = JSON.stringify([
    centre ?? null,
    centreVia ?? null,
    pinned ?? null,
  ]);
  const [request, setRequest] = useState<GraphRequest | null>(null);
  const [complete, setComplete] = useState<{
    request: GraphRequest;
    graph: Graph;
  } | null>(null);
  let ticket = request;
  // A successful connected-note write necessarily advances an epoch. Its
  // explicit pinned refresh waits for that signal rather than reserving the
  // old epoch, being fenced, and falsely claiming the note is already drawn.
  const waitingForSave =
    savedEpoch !== null && revision.token === savedEpoch.token;
  // Only the outstanding explicit save may advance its graph reservation as
  // indexing commits overtake it. This ends at the first complete pinned map;
  // ordinary receipt never refreshes a view or starts a semantic action.
  const pinnedPending =
    pinned &&
    !(
      complete?.request.key === requestKey &&
      complete.request.navigation === navigation
    );
  // Capture the epoch BEFORE starting the graph query, not when it resolves.
  // A changed epoch fences publication but does not restart the active view.
  if (
    revision.settled &&
    !waitingForSave &&
    (!ticket ||
      ticket.key !== requestKey ||
      ticket.navigation !== navigation ||
      (pinnedPending && ticket.revision !== revision.token))
  ) {
    ticket = {
      key: requestKey,
      navigation,
      generation: snapshots.generation,
      revision: revision.token ?? null,
      cached: revision.usable ? snapshots.get(requestKey) : undefined,
    };
    // Conditional render adjustment scopes the request before querying, without
    // a mutable ref leaking a reservation from an abandoned concurrent render.
    setRequest(ticket);
  }
  const snapshot =
    ticket?.cached ??
    (complete?.request === ticket ? complete?.graph : undefined);
  const response = useQuery(
    api.discoveryRevision.graph,
    !revision.settled || waitingForSave || snapshot
      ? "skip"
      : {
          session: sessionId,
          revision: ticket?.revision ?? null,
          centre,
          centreVia,
          similar:
            similar &&
            similar.sessionId === sessionId &&
            similar.navigation === navigation &&
            similar.for === (centre ?? resolved)
              ? similar.hints
              : undefined,
          pin: pinned,
        },
  );
  const live =
    ticket?.generation === snapshots.generation &&
    response?.revision === ticket?.revision
      ? (response?.graph ?? undefined)
      : undefined;
  const graph = useLatest(snapshot ?? live);
  const graphCentre = graph?.centre ?? undefined;
  useEffect(() => setResolved(graphCentre), [graphCentre]);
  // The chosen idea was deleted: the server fell back to the latest note
  useEffect(() => {
    if (live && centre && live.centre !== centre) setCentre(undefined);
  }, [live, centre]);

  // Vector search only runs in actions: ask once per centre, and the map folds it in
  // A vault idea is recentred from the passage that matched, not the file's opening
  const viaOf = (key: string | undefined) =>
    graph?.nodes.find((n) => n.key === key)?.via;
  const graphCentreVia = viaOf(graphCentre);
  const centreRevision = JSON.stringify(
    graph?.nodes.find((node) => node.key === graphCentre),
  );
  useEffect(() => {
    if (
      !graphCentre ||
      !sessionId ||
      snapshot ||
      pinned ||
      !revision.settled ||
      ticket?.generation !== snapshots.generation
    )
      return;
    if (
      centre &&
      (centre !== graphCentre ||
        (centreVia !== undefined && centreVia !== graphCentreVia))
    )
      return;
    const key = `${graphCentre}:${graphCentreVia ?? ""}:${centreRevision}`;
    const cached =
      ticket && ticket.revision !== null ? neighbours.get(key) : undefined;
    if (cached) {
      setSimilar({
        sessionId,
        navigation,
        for: graphCentre,
        hints: cached,
        cacheable: true,
      });
      return;
    }
    let current = true;
    const generation = neighbours.generation;
    findSimilar({ key: graphCentre, via: graphCentreVia })
      .then((hints) => {
        if (!current || generation !== neighbours.generation) return;
        if (ticket && ticket.revision !== null)
          neighbours.set(key, hints, generation);
        setSimilar({
          sessionId,
          navigation,
          for: graphCentre,
          hints,
          cacheable: true,
        });
      })
      // Without neighbours by meaning the other connections still draw the map
      .catch(() => {
        if (current && generation === neighbours.generation)
          setSimilar({
            sessionId,
            navigation,
            for: graphCentre,
            hints: [],
            cacheable: false,
          });
      });
    return () => {
      current = false;
    };
  }, [
    graphCentre,
    graphCentreVia,
    centreRevision,
    findSimilar,
    neighbours,
    sessionId,
    centre,
    centreVia,
    navigation,
    snapshot,
    revision.settled,
    snapshots,
    ticket,
    pinned,
  ]);

  useEffect(() => {
    // Only a fully folded graph is reusable; a base graph remains progressive.
    if (
      !live ||
      !ticket ||
      ticket.generation !== snapshots.generation ||
      (live.centre &&
        !pinned &&
        (!similar ||
          similar.navigation !== navigation ||
          similar.for !== live.centre))
    )
      return;
    // The pinned refresh folds the active view's existing hints, not a new
    // semantic action. They are server-rechecked but not a reusable new epoch.
    if (!pinned && revision.usable && (!live.centre || similar?.cacheable)) {
      snapshots.set(requestKey, live, ticket.generation);
      // Alias the initially server-selected centre for A -> B -> A navigation.
      if (!centre && live.centre)
        snapshots.set(
          JSON.stringify([live.centre, centreVia ?? null, pinned ?? null]),
          live,
          ticket.generation,
        );
    }
    setComplete({ request: ticket, graph: live });
  }, [
    live,
    similar,
    navigation,
    snapshots,
    requestKey,
    centre,
    centreVia,
    pinned,
    revision.usable,
    ticket,
  ]);

  const openKey = centre ?? graphCentre;
  const labels = useMemo(
    () => new Map(graph?.nodes.map((n) => [n.key, n.label]) ?? []),
    [graph?.nodes],
  );
  const edge: GraphEdge | undefined =
    panel.kind === "edge"
      ? graph?.edges.find((e) => e.id === panel.edgeId)
      : undefined;

  function open(key: string, via = viaOf(key)) {
    // Even reselecting the current centre is an explicit lookup, unlike a
    // received invalidation. It may now miss the evicted neighbour cache.
    setNavigation((current) => current + 1);
    setCentre(key);
    setCentreVia(via);
    setPinned(undefined);
    setSavedEpoch(null);
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
  // The map's own keys act on the focused idea; this only lists them in `?`
  useShortcuts({}, Boolean(graph?.nodes.length), {
    help: {
      group: "Notes map",
      keys: [
        ["← ↑ ↓ →", "Move between ideas, once the map has focus"],
        ["Enter", "Open the idea"],
        ["Space", "Show why it connects"],
        ["Esc", "Close the panel"],
      ],
    },
  });

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
        <Skeleton label="Loading your ideas">
          <SkeletonBar className="h-[min(60vh,420px)] w-full" />
        </Skeleton>
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
            <IdeaGraphLegend
              kinds={[...new Set(graph.nodes.map((n) => n.kind))]}
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
                  via={centre ? centreVia : graphCentreVia}
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
                    if (!mounted.current) return;
                    invalidateTopicSearchCache();
                    neighbours.forScope(null);
                    setSavedEpoch(
                      revision.token !== null && revision.token !== undefined
                        ? { token: revision.token }
                        : null,
                    );
                    setAddedKey(key);
                    setPinned(key);
                    setSaved(true);
                    setPanel({ kind: "node" });
                  }}
                />
              )}
              {panel.kind === "edge" && edge && (
                <EdgePanel edge={edge} labels={labels} viaOf={viaOf} />
              )}
            </aside>
          )}
        </div>
      )}
    </main>
  );
}

function Search({ onPick }: { onPick: (key: string, via?: string) => void }) {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(
      () => setTerm(text.trim()),
      SEARCH_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [text]);
  const inputRef = useRef<HTMLInputElement>(null);
  useShortcuts({ "/": () => inputRef.current?.focus() }, true, {
    help: { group: "Notes map", keys: [["/", "Search your ideas"]] },
  });
  const hits = useQuery(
    api.ideaGraph.search,
    term.length >= 2 ? { query: term } : "skip",
  );
  const current = text.trim() === term;
  const pick = (key: string, via?: string) => {
    setText("");
    setTerm("");
    onPick(key, via);
  };
  return (
    <div className="relative w-full max-w-[520px] flex-1">
      <input
        ref={inputRef}
        type="search"
        aria-keyshortcuts="/"
        role="combobox"
        aria-expanded={current && Boolean(hits?.length)}
        aria-controls="idea-search-results"
        aria-label="Search your ideas"
        placeholder="What are you thinking about?"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && current && hits?.[0])
            pick(hits[0].key, hits[0].via);
          if (event.key === "Escape") {
            if (text) {
              event.stopPropagation();
              setText("");
            } else event.currentTarget.blur();
          }
        }}
        className="w-full rounded-lg border border-[var(--reader-border-strong)] bg-transparent px-3.5 py-2.5 text-[14.5px] text-[var(--reader-fg)] placeholder:text-[var(--reader-muted)] focus:outline-none focus-visible:border-[var(--reader-focus)]"
      />
      <Keycap className="absolute right-3 top-1/2 -translate-y-1/2">/</Keycap>
      {current && term.length >= 2 && hits !== undefined && (
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
                onClick={() => pick(hit.key, hit.via)}
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
