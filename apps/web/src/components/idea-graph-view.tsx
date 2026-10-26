"use client";
import { useEffect, useMemo, useRef } from "react";
import {
  edgeLabel,
  type Graph,
  type GraphEdge,
  type GraphNode,
  KIND_LABELS,
} from "@/lib/idea-kinds";
import {
  type Box,
  type Direction,
  edgeLabelSpot,
  ideaBoxes,
  layoutGraph,
  nextInDirection,
  type Placed,
  wrapLabel,
} from "@/lib/idea-layout";

const ARROWS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

/** Each kind in its own hand: pen, highlighter, pencil, print and the vault's green. */
function Shape({ node, r }: { node: GraphNode; r: number }) {
  switch (node.kind) {
    case "note":
      return <circle r={r} fill="var(--pen)" />;
    case "highlight":
      // The highlighter is translucent: lay it on paper so nothing shows through
      return (
        <g data-color={node.color}>
          <circle r={r} fill="var(--reader-bg)" />
          <circle
            r={r}
            fill={node.color ? "var(--mark)" : "var(--highlighter)"}
          />
        </g>
      );
    case "vault":
      return <circle r={r} fill="var(--vault)" />;
    case "article":
      // Print: a small page, as in the comp
      return (
        <rect
          x={-r}
          y={-r * 0.7}
          width={r * 2}
          height={r * 1.4}
          rx={4}
          fill="var(--reader-surface)"
          stroke="var(--reader-border-strong)"
        />
      );
    case "answer":
      return (
        <circle
          r={r}
          fill="var(--reader-surface)"
          stroke="var(--pencil)"
          strokeWidth={1.5}
        />
      );
  }
}

interface Props {
  graph: Graph;
  width: number;
  height: number;
  /** The line whose reason is showing. */
  edgeId: string | null;
  /** A note just written from the map, drawn with a ring until the reader moves on. */
  addedKey: string | null;
  onOpen: (key: string) => void;
  onEdge: (edge: GraphEdge) => void;
  onEscape: () => void;
  /** Moves keyboard focus to this idea after the map redraws. */
  focusKey: string | null;
}

/**
 * The map itself. Ideas are focusable: arrows move to the nearest idea that
 * way, Tab walks them in order, Enter opens one, Space shows why it is
 * connected to the idea it hangs off.
 */
export function IdeaGraphView({
  graph,
  width,
  height,
  edgeId,
  addedKey,
  onOpen,
  onEdge,
  onEscape,
  focusKey,
}: Props) {
  const placed = useMemo(
    () =>
      layoutGraph({
        nodes: graph.nodes,
        edges: graph.edges,
        width,
        height,
      }),
    [graph.nodes, graph.edges, width, height],
  );
  const byKey = useMemo(() => new Map(placed.map((p) => [p.key, p])), [placed]);
  const nodeByKey = useMemo(
    () => new Map(graph.nodes.map((n) => [n.key, n])),
    [graph.nodes],
  );
  const refs = useRef(new Map<string, SVGGElement>());

  useEffect(() => {
    if (focusKey) refs.current.get(focusKey)?.focus();
  }, [focusKey]);

  const narrow = width < 520;
  const wrapAt = narrow ? 14 : 22;
  // Edge labels go where they cover no idea, no idea's label and no other
  // edge label; an edge with no clear spot stays unlabelled
  const labelSpots = useMemo(() => {
    const taken: Box[] = [];
    for (const p of placed) {
      const node = nodeByKey.get(p.key);
      if (!node) continue;
      const centre = node.hop === 0;
      const lines =
        node.hop === 2
          ? []
          : wrapLabel(node.label, centre ? wrapAt + 6 : wrapAt);
      taken.push(...ideaBoxes(p, lines, centre ? 14 : 12.5));
    }
    const spots = new Map<string, { x: number; y: number }>();
    if (narrow) return spots;
    for (const edge of graph.edges) {
      const a = byKey.get(edge.a);
      const b = byKey.get(edge.b);
      if (!a || !b || a.hop === 2 || b.hop === 2) continue;
      const [inner, outer] = a.hop <= b.hop ? [a, b] : [b, a];
      const spot = edgeLabelSpot(inner, outer, edgeLabel(edge), taken);
      if (!spot) continue;
      taken.push(spot.box);
      spots.set(edge.id, spot);
    }
    return spots;
  }, [placed, nodeByKey, byKey, graph.edges, wrapAt, narrow]);

  // The line a second-ring or neighbouring idea hangs off, for Space
  const edgeFor = (key: string) =>
    graph.edges.find(
      (e) =>
        (e.a === graph.centre && e.b === key) ||
        (e.b === key && nodeByKey.get(e.a)?.hop === 1) ||
        (e.a === key && e.b === graph.centre),
    );

  function onKeyDown(event: React.KeyboardEvent<SVGSVGElement>) {
    const key = (event.target as Element).closest<SVGGElement>("[data-node]")
      ?.dataset.node;
    if (event.key === "Escape") {
      onEscape();
      return;
    }
    if (!key) return;
    const direction = ARROWS[event.key];
    if (direction) {
      event.preventDefault();
      const next = nextInDirection(placed, key, direction);
      if (next) refs.current.get(next)?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      onOpen(key);
    } else if (event.key === " ") {
      event.preventDefault();
      const edge = edgeFor(key);
      if (edge) onEdge(edge);
    }
  }

  return (
    <svg
      role="group"
      aria-label="Map of your ideas"
      aria-describedby="idea-graph-hint"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block max-w-full select-none font-sans"
      onKeyDown={onKeyDown}
    >
      <g>
        {graph.edges.map((edge) => {
          const a = byKey.get(edge.a);
          const b = byKey.get(edge.b);
          if (!a || !b) return null;
          const faint = a.hop === 2 || b.hop === 2;
          const selected = edge.id === edgeId;
          // Lines stop short of each mark (and the centre's ring) instead of
          // running into its middle
          const [x1, y1, x2, y2] = trimToRims(a, b);
          // On a phone the lines would crowd each other; the panel says why instead
          const spot = labelSpots.get(edge.id);
          const label = spot ? edgeLabel(edge) : "";
          return (
            <g
              key={edge.id}
              className="idea-enter group/edge cursor-pointer outline-none"
              role="button"
              tabIndex={-1}
              aria-label={`Why “${nodeByKey.get(edge.a)?.label}” and “${nodeByKey.get(edge.b)?.label}” connect`}
              aria-pressed={selected}
              onClick={() => onEdge(edge)}
            >
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={
                  selected ? "var(--reader-fg)" : "var(--reader-border-strong)"
                }
                strokeWidth={selected ? 2 : 1.2}
                strokeDasharray={faint ? "3 4" : undefined}
                // Focus shows on the line itself, not as a box around it
                className="group-focus-visible/edge:stroke-[var(--reader-focus)]"
              />
              {/* A wider invisible stroke so a thin line is easy to hit */}
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="transparent"
                strokeWidth={16}
              />
              {label && (
                <text
                  x={spot?.x}
                  y={spot?.y}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--reader-muted)"
                  stroke="var(--reader-bg)"
                  strokeWidth={4}
                  paintOrder="stroke"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </g>
      {placed.map((p) => {
        const node = nodeByKey.get(p.key);
        if (!node) return null;
        return (
          <NodeMark
            key={p.key}
            placed={p}
            node={node}
            added={p.key === addedKey}
            wrapAt={wrapAt}
            register={(el) => {
              if (el) refs.current.set(p.key, el);
              else refs.current.delete(p.key);
            }}
            onOpen={() => onOpen(p.key)}
          />
        );
      })}
    </svg>
  );
}

function NodeMark({
  placed,
  node,
  added,
  wrapAt,
  register,
  onOpen,
}: {
  placed: Placed;
  node: GraphNode;
  added: boolean;
  wrapAt: number;
  register: (el: SVGGElement | null) => void;
  onOpen: () => void;
}) {
  const centre = node.hop === 0;
  const faint = node.hop === 2;
  const lines = faint
    ? []
    : wrapLabel(node.label, centre ? wrapAt + 6 : wrapAt);
  const fontSize = centre ? 14 : 12.5;
  return (
    <g
      ref={register}
      data-node={node.key}
      className="idea-enter group cursor-pointer outline-none"
      // The ring below shows focus; the browser's own box would square it off
      style={{ outline: "none" }}
      transform={`translate(${placed.x} ${placed.y})`}
      role="button"
      tabIndex={0}
      aria-current={centre ? "true" : undefined}
      aria-label={`${KIND_LABELS[node.kind]}: ${node.label}${centre ? ". At the centre" : ""}`}
      opacity={faint ? 0.45 : 1}
      onClick={onOpen}
    >
      <title>{node.label}</title>
      {(centre || added) && (
        <circle
          r={placed.r + 6}
          fill="none"
          stroke={centre ? "var(--reader-fg)" : "var(--pen)"}
          strokeWidth={1}
        />
      )}
      <circle
        r={placed.r + 11}
        fill="none"
        strokeWidth={2}
        className="stroke-transparent group-focus-visible:stroke-[var(--reader-focus)]"
      />
      <Shape node={node} r={placed.r} />
      {lines.map((line, i) => (
        <text
          key={i}
          y={placed.r + 18 + i * (fontSize + 2)}
          textAnchor="middle"
          fontSize={fontSize}
          fill="var(--reader-fg-soft)"
          stroke="var(--reader-bg)"
          strokeWidth={4}
          paintOrder="stroke"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/** The space a mark keeps clear: its rim plus a gap, and the centre's ring. */
const RIM_GAP = 4;
const rimOf = (p: Placed) => p.r + (p.hop === 0 ? 7 : 0) + RIM_GAP;

/** A line between two marks, cut back to each one's rim. */
export function trimToRims(
  a: Placed,
  b: Placed,
): [number, number, number, number] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const ra = Math.min(rimOf(a), length / 2);
  const rb = Math.min(rimOf(b), length / 2);
  return [a.x + ux * ra, a.y + uy * ra, b.x - ux * rb, b.y - uy * rb];
}

/** What each mark on the map means, for the kinds on screen. */
export function IdeaGraphLegend({
  kinds,
}: {
  kinds: readonly GraphNode["kind"][];
}) {
  const swatch = (kind: GraphNode["kind"]) => (
    <svg width={18} height={18} viewBox="-9 -9 18 18" aria-hidden="true">
      <Shape node={{ kind, hop: 1 } as GraphNode} r={7} />
    </svg>
  );
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-[var(--reader-muted)]">
      {kinds.map((kind) => (
        <li key={kind} className="flex items-center gap-1.5">
          {swatch(kind)}
          {KIND_LABELS[kind]}
        </li>
      ))}
      <li>Larger: the idea you&rsquo;re on</li>
      <li>Faint: two steps away</li>
    </ul>
  );
}
