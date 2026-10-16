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
  const edges = links.map((link) => ({
    link,
    points: g.edge(link.from, link.to).points,
  }));
  return {
    direction,
    width: graph.width ?? 0,
    height: graph.height ?? 0,
    nodes,
    edges,
  };
}

/**
 * Cubic curves that leave each point along the flow direction. Each segment
 * bends halfway between its ends, so lines run out of a box and into the next
 * one without kinking.
 */
export function edgeCurve(points: Point[], direction: Direction): string {
  if (points.length < 2) return "";
  const [first, ...rest] = points;
  let d = `M ${first.x} ${first.y}`;
  let prev = first;
  for (const p of rest) {
    if (direction === "TB") {
      const mid = (prev.y + p.y) / 2;
      d += ` C ${prev.x} ${mid}, ${p.x} ${mid}, ${p.x} ${p.y}`;
    } else {
      const mid = (prev.x + p.x) / 2;
      d += ` C ${mid} ${prev.y}, ${mid} ${p.y}, ${p.x} ${p.y}`;
    }
    prev = p;
  }
  return d;
}
