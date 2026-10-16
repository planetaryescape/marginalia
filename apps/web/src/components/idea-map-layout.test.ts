import { describe, expect, it } from "vitest";
import {
  edgeCurve,
  type Idea,
  type Link,
  layoutIdeaMap,
  type MapLayout,
  type Point,
} from "./idea-map-layout";

const idea = (id: string, role: Idea["role"], label = `Idea ${id}`): Idea => ({
  id,
  label,
  detail: "",
  role,
  paragraphs: [],
});
const link = (
  from: string,
  to: string,
  relation: Link["relation"] = "leads_to",
): Link => ({
  from,
  to,
  relation,
});

// Seven ideas: a tree that leads to the conclusion, plus two cross-links
// that skip a rank (c -> e) or push against the tree (d -> f).
const fixtureIdeas: Idea[] = [
  idea("a", "premise"),
  idea("b", "claim"),
  idea("c", "claim"),
  idea("d", "evidence"),
  idea("e", "claim"),
  idea("f", "counterpoint"),
  idea("g", "conclusion"),
];
const fixtureLinks: Link[] = [
  link("a", "b"),
  link("a", "c"),
  link("b", "d", "illustrates"),
  link("d", "e", "supports"),
  link("d", "f", "contrasts"),
  link("c", "e", "supports"),
  link("e", "g"),
  link("f", "g", "supports"),
];

type Segment = [Point, Point];

function segmentsOf(points: Point[]): Segment[] {
  return points.slice(1).map((p, i) => [points[i], p]);
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function properlyCross([p1, p2]: Segment, [p3, p4]: Segment): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Counts pairs of edges whose polylines cross, ignoring edges that share a node. */
function countCrossings(layout: MapLayout): number {
  let count = 0;
  const { edges } = layout;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i].link;
      const b = edges[j].link;
      if (new Set([a.from, a.to, b.from, b.to]).size < 4) continue;
      for (const s of segmentsOf(edges[i].points)) {
        for (const t of segmentsOf(edges[j].points)) {
          if (properlyCross(s, t)) count++;
        }
      }
    }
  }
  return count;
}

describe("layoutIdeaMap", () => {
  it("is empty for a map with no ideas", () => {
    const layout = layoutIdeaMap([], []);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
  });

  it("places every idea and every link", () => {
    const layout = layoutIdeaMap(fixtureIdeas, fixtureLinks);
    expect(layout.nodes.map((n) => n.idea.id).sort()).toEqual(
      fixtureIdeas.map((i) => i.id).sort(),
    );
    expect(layout.edges).toHaveLength(fixtureLinks.length);
    for (const edge of layout.edges)
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
  });

  it("draws the seven-idea fixture with zero edge crossings", () => {
    const layout = layoutIdeaMap(fixtureIdeas, fixtureLinks);
    expect(countCrossings(layout)).toBe(0);
  });

  it("runs top-down for a long map", () => {
    // A chain of six ideas has six ranks, so it reads top-down
    const chain = ["a", "b", "c", "d", "e", "f"].map((id) => idea(id, "claim"));
    const links = chain.slice(1).map((n, i) => link(chain[i].id, n.id));
    const layout = layoutIdeaMap(chain, links);
    expect(layout.direction).toBe("TB");
    const ys = layout.nodes.map((n) => n.y);
    expect(new Set(ys).size).toBe(6);
    expect(layout.height).toBeGreaterThan(layout.width);
  });

  it("runs left to right for a short map", () => {
    const layout = layoutIdeaMap(
      [idea("a", "premise"), idea("b", "conclusion")],
      [link("a", "b")],
    );
    expect(layout.direction).toBe("LR");
  });

  it("keeps the map's edges connected to their nodes", () => {
    const layout = layoutIdeaMap(fixtureIdeas, fixtureLinks);
    const byId = new Map(layout.nodes.map((n) => [n.idea.id, n]));
    for (const { link: l, points } of layout.edges) {
      const from = byId.get(l.from);
      const to = byId.get(l.to);
      expect(from && to).toBeTruthy();
      const start = points[0];
      const end = points[points.length - 1];
      const near = (p: Point, n: NonNullable<typeof from>) =>
        p.x >= n.x - 1 &&
        p.x <= n.x + n.w + 1 &&
        p.y >= n.y - 1 &&
        p.y <= n.y + n.h + 1;
      expect(near(start, from as NonNullable<typeof from>)).toBe(true);
      expect(near(end, to as NonNullable<typeof to>)).toBe(true);
    }
  });
});

describe("edgeCurve", () => {
  it("bends halfway between points along the flow", () => {
    expect(
      edgeCurve(
        [
          { x: 0, y: 0 },
          { x: 10, y: 20 },
        ],
        "TB",
      ),
    ).toBe("M 0 0 C 0 10, 10 10, 10 20");
    expect(
      edgeCurve(
        [
          { x: 0, y: 0 },
          { x: 10, y: 20 },
        ],
        "LR",
      ),
    ).toBe("M 0 0 C 5 0, 5 20, 10 20");
  });
});

describe("edges meet boxes square-on", () => {
  const layout = layoutIdeaMap(fixtureIdeas, fixtureLinks);
  const node = (id: string) => {
    const n = layout.nodes.find((p) => p.idea.id === id);
    if (!n) throw new Error(id);
    return n;
  };

  it("leaves the far side of the source and lands on the near side of the target", () => {
    for (const { link: l, points } of layout.edges) {
      const from = node(l.from);
      const to = node(l.to);
      const first = points[0];
      const last = points[points.length - 1];
      if (layout.direction === "TB") {
        expect(first.y).toBeCloseTo(from.y + from.h);
        expect(last.y).toBeCloseTo(to.y);
        expect(last.x).toBeGreaterThan(to.x + to.w * 0.15);
        expect(last.x).toBeLessThan(to.x + to.w * 0.85);
      } else {
        expect(first.x).toBeCloseTo(from.x + from.w);
        expect(last.x).toBeCloseTo(to.x);
      }
    }
  });

  it("keeps no bend squeezed against a box", () => {
    for (const { points } of layout.edges) {
      for (const p of points.slice(1, -1)) {
        const along = (q: Point) => (layout.direction === "TB" ? q.y : q.x);
        expect(along(p) - along(points[0])).toBeGreaterThanOrEqual(16);
        expect(
          along(points[points.length - 1]) - along(p),
        ).toBeGreaterThanOrEqual(16);
      }
    }
  });

  it("gives edges arriving at the same box their own ports", () => {
    const into = (id: string) =>
      layout.edges
        .filter((e) => e.link.to === id)
        .map((e) => e.points[e.points.length - 1]);
    for (const id of ["e", "g"]) {
      const ends = into(id);
      const keys = new Set(
        ends.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`),
      );
      expect(keys.size).toBe(ends.length);
    }
  });
});
