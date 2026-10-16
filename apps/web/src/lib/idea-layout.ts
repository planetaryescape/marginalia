// Places the idea graph. It is a hub with a ring around it, not a hierarchy, so
// dagre's layered layout (used for the article idea map) would stretch it into
// rows. A fixed radial layout also keeps the map still between renders, which
// a force simulation would not, and needs no new dependency.

export interface LayoutInput {
  nodes: { key: string; hop: 0 | 1 | 2 }[];
  edges: { a: string; b: string }[];
  width: number;
  height: number;
}

export interface Placed {
  key: string;
  hop: 0 | 1 | 2;
  x: number;
  y: number;
  r: number;
  /** The key of the idea a second-ring idea hangs off. */
  parent?: string;
}

const RADIUS = { 0: 32, 1: 21, 2: 12 } as const;
const MARGIN = 36;
// A second-ring idea sits this far beyond the neighbour it hangs off
const REACH = 88;

export type Direction = "left" | "right" | "up" | "down";

export function layoutGraph({
  nodes,
  edges,
  width,
  height,
}: LayoutInput): Placed[] {
  const cx = width / 2;
  const cy = height / 2;
  // Leave room under each ring node for its label
  // A phone has less to spare at the sides, so the ring hugs the edge more
  const side = width < 520 ? 62 : 110;
  const rx = Math.max(80, width / 2 - side);
  const ry = Math.max(90, height / 2 - 100);
  const placed = new Map<string, Placed>();

  for (const node of nodes)
    if (node.hop === 0)
      placed.set(node.key, { ...node, x: cx, y: cy, r: RADIUS[0] });

  const ring = nodes.filter((node) => node.hop === 1);
  ring.forEach((node, index) => {
    // Start at the top and go round, so the strongest connection reads first
    const angle = -Math.PI / 2 + (index / ring.length) * Math.PI * 2;
    placed.set(node.key, {
      ...node,
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
      r: RADIUS[1],
    });
  });

  for (const node of nodes) {
    if (node.hop !== 2) continue;
    const parent = edges
      .filter((e) => e.b === node.key)
      .map((e) => placed.get(e.a))
      .find((p) => p?.hop === 1);
    // An orphan is parked beside the centre rather than dropped
    const from = parent ?? placed.get(nodes[0]?.key ?? "");
    if (!from) continue;
    let dx = from.x - cx;
    let dy = from.y - cy;
    const length = Math.hypot(dx, dy) || 1;
    // Hung off the centre itself (an article its note came from): below it
    if (length === 1 && dx === 0 && dy === 0) dy = length;
    dx /= length;
    dy /= length;
    placed.set(node.key, {
      ...node,
      x: clamp(from.x + dx * REACH, MARGIN, width - MARGIN),
      y: clamp(from.y + dy * REACH, MARGIN, height - MARGIN),
      r: RADIUS[2],
      parent: parent?.key,
    });
  }
  return nodes.flatMap((node) => placed.get(node.key) ?? []);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

const VECTORS: Record<Direction, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/**
 * The idea nearest in a direction, within a 45-degree cone either side, for
 * arrow-key movement. Null when nothing lies that way.
 */
export function nextInDirection(
  placed: Placed[],
  fromKey: string,
  direction: Direction,
): string | null {
  const from = placed.find((p) => p.key === fromKey);
  if (!from) return null;
  const [ux, uy] = VECTORS[direction];
  let best: { key: string; distance: number } | null = null;
  for (const other of placed) {
    if (other.key === fromKey) continue;
    const dx = other.x - from.x;
    const dy = other.y - from.y;
    const along = dx * ux + dy * uy;
    const across = Math.abs(dx * uy - dy * ux);
    if (along <= 0 || across > along) continue;
    const distance = Math.hypot(dx, dy);
    if (!best || distance < best.distance) best = { key: other.key, distance };
  }
  return best?.key ?? null;
}

/** Breaks a label into at most `maxLines` lines of about `width` characters, ending in an ellipsis when cut. */
export function wrapLabel(text: string, width: number, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let i = 0;
  while (i < words.length && lines.length < maxLines) {
    let line = words[i++];
    while (i < words.length && line.length + 1 + words[i].length <= width)
      line += ` ${words[i++]}`;
    lines.push(line);
  }
  if (i < words.length)
    lines[lines.length - 1] += ` ${words.slice(i).join(" ")}`;
  const fit = (line: string) =>
    line.length > width ? `${line.slice(0, width - 1).trimEnd()}…` : line;
  return lines.length ? lines.map(fit) : [""];
}
