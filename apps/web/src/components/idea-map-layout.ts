import * as dagre from "@dagrejs/dagre";
import type { Doc } from "@marginalia/backend/convex/_generated/dataModel";

export type Idea = NonNullable<Doc<"summaries">["ideas"]>[number];
export type Link = NonNullable<Doc<"summaries">["links"]>[number];

export type Direction = "TB" | "LR";
export type Point = { x: number; y: number };

export interface PlacedIdea {
  idea: Idea;
  /** Top-left corner, in px, inside the map. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedLink {
  link: Link;
  /** Polyline from the source node to the target node, in px. */
  points: Point[];
}

export interface MapLayout {
  direction: Direction;
  width: number;
  height: number;
  nodes: PlacedIdea[];
  edges: PlacedLink[];
}

export const NODE_WIDTH = 176;
// Labels wrap inside the box; these estimate the box height from the text
const CHAR_WIDTH = 6.6;
const TEXT_PADDING = 20;
const LINE_HEIGHT = 17;
const CHROME_HEIGHT = 34;
// Maps with at least this many ranks read better top-down than side-on
export const LONG_MAP_RANKS = 4;

function nodeHeight(idea: Idea): number {
  const lines = Math.max(
    1,
    Math.ceil((idea.label.length * CHAR_WIDTH) / (NODE_WIDTH - TEXT_PADDING)),
  );
  return CHROME_HEIGHT + lines * LINE_HEIGHT;
}

function build(
  ideas: Idea[],
  links: Link[],
  rankdir: Direction,
): dagre.graphlib.Graph {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep: 22, ranksep: 40, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const idea of ideas) {
    g.setNode(idea.id, { width: NODE_WIDTH, height: nodeHeight(idea) });
  }
  for (const link of links) g.setEdge(link.from, link.to, {});
  dagre.layout(g);
  return g;
}

function rankCount(g: dagre.graphlib.Graph, ideas: Idea[]): number {
  const rows = new Set(ideas.map((idea) => g.node(idea.id).y));
  return rows.size;
}

/**
 * Lays the idea map out with dagre's layered graph, which orders the nodes
 * within each rank to cut crossings. Long maps run top-down towards the
 * conclusion; short ones run left to right so they don't stack too tall.
 */
export function layoutIdeaMap(ideas: Idea[], links: Link[]): MapLayout {
  if (ideas.length === 0) {
    return { direction: "TB", width: 0, height: 0, nodes: [], edges: [] };
  }
  const topDown = build(ideas, links, "TB");
  const direction: Direction =
    rankCount(topDown, ideas) >= LONG_MAP_RANKS ? "TB" : "LR";
  const g = direction === "TB" ? topDown : build(ideas, links, "LR");

  const graph = g.graph();
  const nodes = ideas.map((idea) => {
    const n = g.node(idea.id);
    return {
      idea,
      x: n.x - n.width / 2,
      y: n.y - n.height / 2,
      w: n.width,
      h: n.height,
    };
  });
  const edges = attachToPorts(nodes, links, g, direction);
  return {
    direction,
    width: graph.width ?? 0,
    height: graph.height ?? 0,
    nodes,
    edges,
  };
}

// Corner radius of the elbows, at most: small enough to read as a corner,
// large enough that the line doesn't look drawn with a ruler
const ELBOW_RADIUS = 8;

/**
 * Right-angled connectors with softly rounded corners. Each leg leaves its
 * box straight along the flow, turns once halfway, runs across, and turns
 * again to arrive square-on, the way a well-drawn diagram connects boxes.
 */
export function edgeCurve(points: Point[], direction: Direction): string {
  if (points.length < 2) return "";
  const along = (p: Point) => (direction === "TB" ? p.y : p.x);
  const across = (p: Point) => (direction === "TB" ? p.x : p.y);
  const at = (a: number, c: number): Point =>
    direction === "TB" ? { x: c, y: a } : { x: a, y: c };

  // The orthogonal route through every point: along, across, along
  const route: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (Math.abs(across(a) - across(b)) >= 0.5) {
      const mid = (along(a) + along(b)) / 2;
      route.push(at(mid, across(a)), at(mid, across(b)));
    }
    route.push(b);
  }

  let d = `M ${route[0].x} ${route[0].y}`;
  for (let i = 1; i < route.length - 1; i++) {
    const prev = route[i - 1];
    const v = route[i];
    const next = route[i + 1];
    const inLen = Math.hypot(v.x - prev.x, v.y - prev.y);
    const outLen = Math.hypot(next.x - v.x, next.y - v.y);
    const r = Math.min(ELBOW_RADIUS, inLen / 2, outLen / 2);
    if (r < 0.5) {
      d += ` L ${v.x} ${v.y}`;
      continue;
    }
    const into = {
      x: v.x - ((v.x - prev.x) / inLen) * r,
      y: v.y - ((v.y - prev.y) / inLen) * r,
    };
    const outOf = {
      x: v.x + ((next.x - v.x) / outLen) * r,
      y: v.y + ((next.y - v.y) / outLen) * r,
    };
    d += ` L ${into.x} ${into.y} Q ${v.x} ${v.y} ${outOf.x} ${outOf.y}`;
  }
  const last = route[route.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

// How far apart edges sharing a side of a box sit, at most, and how much of
// the side they may spread over
const PORT_GAP = 28;
const PORT_SPAN = 0.6;
// Routing points this close to a box's side are dropped: a curve squeezed into
// a few pixels before the arrowhead is what makes an edge look kinked
const MIN_LEG = 16;

type Side = "out" | "in";

/**
 * Edges leave the far side of their source and arrive square-on to the near
 * side of their target (bottom to top top-down, right to left side-on), each
 * at its own port when several share a side, ordered by where the other end
 * is so they don't cross. Edges that skip a rank keep dagre's routing points
 * around the boxes in between.
 */
function attachToPorts(
  nodes: PlacedIdea[],
  links: Link[],
  g: dagre.graphlib.Graph,
  direction: Direction,
): PlacedLink[] {
  const byId = new Map(nodes.map((n) => [n.idea.id, n]));
  const across = (n: PlacedIdea) =>
    direction === "TB" ? n.x + n.w / 2 : n.y + n.h / 2;
  const portOffsets = new Map<string, number>();
  const assign = (side: Side) => {
    const groups = new Map<string, Link[]>();
    for (const link of links) {
      const id = side === "out" ? link.from : link.to;
      groups.set(id, [...(groups.get(id) ?? []), link]);
    }
    for (const [id, group] of groups) {
      const node = byId.get(id);
      if (!node) continue;
      const length = direction === "TB" ? node.w : node.h;
      const other = (l: Link) => byId.get(side === "out" ? l.to : l.from);
      const sorted = [...group].sort(
        (a, b) => across(other(a) ?? node) - across(other(b) ?? node),
      );
      const gap = Math.min(PORT_GAP, (length * PORT_SPAN) / sorted.length);
      for (const [i, link] of sorted.entries())
        portOffsets.set(
          `${side}:${link.from}>${link.to}`,
          (i - (sorted.length - 1) / 2) * gap,
        );
    }
  };
  assign("out");
  assign("in");

  return links.map((link) => {
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    const raw = g.edge(link.from, link.to)?.points ?? [];
    if (!from || !to) return { link, points: raw };
    const outOffset = portOffsets.get(`out:${link.from}>${link.to}`) ?? 0;
    const inOffset = portOffsets.get(`in:${link.from}>${link.to}`) ?? 0;
    const start: Point =
      direction === "TB"
        ? { x: from.x + from.w / 2 + outOffset, y: from.y + from.h }
        : { x: from.x + from.w, y: from.y + from.h / 2 + outOffset };
    const end: Point =
      direction === "TB"
        ? { x: to.x + to.w / 2 + inOffset, y: to.y }
        : { x: to.x, y: to.y + to.h / 2 + inOffset };
    const along = (p: Point) => (direction === "TB" ? p.y : p.x);
    // dagre's own end points sit on the box edges; keep only the bends between
    const middle = raw
      .slice(1, -1)
      .filter(
        (p) =>
          along(p) - along(start) >= MIN_LEG &&
          along(end) - along(p) >= MIN_LEG,
      );
    return { link, points: [start, ...middle, end] };
  });
}
