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
    const at = clearSpot(placed, from, dx, dy, RADIUS[2], width, height);
    placed.set(node.key, {
      ...node,
      ...at,
      r: RADIUS[2],
      parent: parent?.key,
    });
  }
  return nodes.flatMap((node) => placed.get(node.key) ?? []);
}

// Tried in order: straight out from the parent, then fanning to either side, then further out
const FAN = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, Math.PI];
const REACHES = [REACH, REACH * 1.4, REACH * 1.8];
const GAP = 8;

/**
 * Where a second-ring idea goes: out from its parent, but not on top of an
 * idea already placed. Siblings of one parent therefore fan out beside each other.
 */
function clearSpot(
  placed: Map<string, Placed>,
  from: Placed,
  dx: number,
  dy: number,
  r: number,
  width: number,
  height: number,
): { x: number; y: number } {
  let best = { x: from.x, y: from.y, room: Number.NEGATIVE_INFINITY };
  for (const reach of REACHES)
    for (const turn of FAN) {
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const x = clamp(
        from.x + (dx * cos - dy * sin) * reach,
        MARGIN,
        width - MARGIN,
      );
      const y = clamp(
        from.y + (dx * sin + dy * cos) * reach,
        MARGIN,
        height - MARGIN,
      );
      // Room is the gap to the nearest idea already there; positive means clear
      let room = Number.POSITIVE_INFINITY;
      for (const other of placed.values())
        room = Math.min(
          room,
          Math.hypot(x - other.x, y - other.y) - other.r - r - GAP,
        );
      if (room >= 0) return { x, y };
      if (room > best.room) best = { x, y, room };
    }
  return best;
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

/** A rectangle on the map, in the SVG's coordinates. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Text widths are estimated, not measured: DM Sans runs about 0.56 em per
// character on average, which is close enough to keep labels apart
const CHAR_EM = 0.56;
const EDGE_FONT = 11;

const overlaps = (a: Box, b: Box) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** The space an idea takes: its mark and the label lines drawn below it. */
export function ideaBoxes(
  p: { x: number; y: number; r: number },
  lines: readonly string[],
  fontSize: number,
): Box[] {
  const boxes: Box[] = [
    { x0: p.x - p.r, y0: p.y - p.r, x1: p.x + p.r, y1: p.y + p.r },
  ];
  if (lines.length) {
    const half =
      (Math.max(...lines.map((l) => l.length)) * fontSize * CHAR_EM) / 2;
    const top = p.y + p.r + 18 - fontSize;
    const bottom = p.y + p.r + 18 + (lines.length - 1) * (fontSize + 2) + 4;
    boxes.push({ x0: p.x - half, y0: top, x1: p.x + half, y1: bottom });
  }
  return boxes;
}

// Where along an edge a label may sit, best first: the middle, then nearer
// either end
const ALONG = [0.5, 0.42, 0.6, 0.35, 0.68, 0.28, 0.75];

/**
 * Where an edge's label can sit without covering an idea, its label or a
 * label already placed, as the baseline point for centred text. Null when
 * nowhere on the line is clear: the edge then goes unlabelled, and selecting
 * it still says why it exists.
 */
export function edgeLabelSpot(
  inner: { x: number; y: number },
  outer: { x: number; y: number },
  text: string,
  obstacles: readonly Box[],
): { x: number; y: number; box: Box } | null {
  const half = (text.length * EDGE_FONT * CHAR_EM) / 2 + 3;
  for (const t of ALONG) {
    const x = inner.x + (outer.x - inner.x) * t;
    const y = inner.y + (outer.y - inner.y) * t - 6;
    const box = { x0: x - half, y0: y - EDGE_FONT, x1: x + half, y1: y + 3 };
    if (!obstacles.some((o) => overlaps(box, o))) return { x, y, box };
  }
  return null;
}
