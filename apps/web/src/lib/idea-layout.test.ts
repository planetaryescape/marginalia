import { describe, expect, it } from "vitest";
import {
  type Box,
  edgeLabelSpot,
  ideaBoxes,
  layoutGraph,
  nextInDirection,
  wrapLabel,
} from "./idea-layout";

const ring = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ key: `n${i}`, hop: 1 as const }));

function input(n: number, outer = 0) {
  const nodes = [{ key: "c", hop: 0 as const }, ...ring(n)];
  const edges = ring(n).map((r) => ({ a: "c", b: r.key }));
  for (let i = 0; i < outer; i++) {
    nodes.push({ key: `o${i}`, hop: 2 as never });
    edges.push({ a: `n${i}`, b: `o${i}` });
  }
  return { nodes, edges, width: 770, height: 700 };
}

describe("layoutGraph", () => {
  it("puts the centre in the middle and the first idea straight above it", () => {
    const placed = layoutGraph(input(7));
    const centre = placed.find((p) => p.key === "c");
    expect(centre).toMatchObject({ x: 385, y: 350 });
    const first = placed.find((p) => p.key === "n0");
    expect(first?.x).toBeCloseTo(385);
    expect(first?.y).toBeLessThan(350);
  });

  it("keeps every idea inside the frame and apart from the others at both widths", () => {
    for (const [width, height] of [
      [770, 700],
      [350, 480],
    ]) {
      const placed = layoutGraph({ ...input(7, 7), width, height });
      expect(placed).toHaveLength(15);
      for (const p of placed) {
        expect(p.x - p.r).toBeGreaterThanOrEqual(0);
        expect(p.x + p.r).toBeLessThanOrEqual(width);
        expect(p.y - p.r).toBeGreaterThanOrEqual(0);
        expect(p.y + p.r).toBeLessThanOrEqual(height);
      }
      for (const a of placed)
        for (const b of placed)
          if (a.key < b.key)
            expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(
              a.r + b.r + 4,
            );
    }
  });

  it("hangs a second-ring idea beyond the neighbour it belongs to", () => {
    const placed = layoutGraph(input(4, 1));
    const near = placed.find((p) => p.key === "n0");
    const far = placed.find((p) => p.key === "o0");
    expect(far?.parent).toBe("n0");
    expect(
      Math.hypot((far?.x ?? 0) - 385, (far?.y ?? 0) - 350),
    ).toBeGreaterThan(Math.hypot((near?.x ?? 0) - 385, (near?.y ?? 0) - 350));
  });

  it("gives siblings that share a parent, and a hub with several members, their own places", () => {
    const nodes = [
      { key: "c", hop: 0 as const },
      ...ring(7),
      ...Array.from({ length: 7 }, (_, i) => ({
        key: `s${i}`,
        hop: 2 as const,
      })),
    ];
    // Every second-ring idea hangs off the same neighbour; the last is a hub also tied to the centre
    const edges = [
      ...ring(7).map((r) => ({ a: "c", b: r.key })),
      ...Array.from({ length: 7 }, (_, i) => ({ a: "n0", b: `s${i}` })),
      { a: "c", b: "s6" },
    ];
    for (const [width, height] of [
      [770, 700],
      [350, 560],
    ]) {
      const placed = layoutGraph({ nodes, edges, width, height });
      expect(placed).toHaveLength(15);
      const points = new Set(
        placed.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
      );
      expect(points.size).toBe(15);
      for (const a of placed)
        for (const b of placed)
          if (a.key < b.key)
            expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
    }
  });

  it("lays out a lone centre", () => {
    expect(layoutGraph(input(0))).toHaveLength(1);
  });
});

describe("nextInDirection", () => {
  const placed = layoutGraph(input(4));
  // n0 top, n1 right, n2 bottom, n3 left
  it("moves between ideas the way the arrow points", () => {
    expect(nextInDirection(placed, "c", "right")).toBe("n1");
    expect(nextInDirection(placed, "c", "up")).toBe("n0");
    expect(nextInDirection(placed, "c", "down")).toBe("n2");
    expect(nextInDirection(placed, "c", "left")).toBe("n3");
    expect(nextInDirection(placed, "n3", "right")).toBe("c");
  });

  it("stays put when nothing lies that way", () => {
    expect(nextInDirection(placed, "n1", "right")).toBeNull();
    expect(nextInDirection(placed, "gone", "right")).toBeNull();
  });
});

describe("wrapLabel", () => {
  it("wraps on words and ends a cut label with an ellipsis", () => {
    expect(wrapLabel("Block whole mornings", 14)).toEqual([
      "Block whole",
      "mornings",
    ]);
    expect(
      wrapLabel("a very long label that will not fit in two lines", 10),
    ).toEqual(["a very", "long labe…"]);
    expect(wrapLabel("", 10)).toEqual([""]);
  });
});

describe("edge labels", () => {
  const centre = { x: 400, y: 300, r: 22 };
  const outer = { x: 400, y: 500, r: 16 };

  it("sits at the middle of a clear line", () => {
    const spot = edgeLabelSpot(centre, outer, "same article", []);
    expect(spot?.y).toBeCloseTo(394);
  });

  it("moves along the line to clear an idea's label", () => {
    const labelUnderCentre = ideaBoxes(centre, ["A long centre label"], 14);
    const blocker: Box = { x0: 300, y0: 380, x1: 500, y1: 410 };
    const spot = edgeLabelSpot(centre, outer, "same article", [
      ...labelUnderCentre,
      blocker,
    ]);
    expect(spot).not.toBeNull();
    for (const box of [...labelUnderCentre, blocker])
      expect(
        spot!.box.y1 <= box.y0 ||
          spot!.box.y0 >= box.y1 ||
          spot!.box.x1 <= box.x0 ||
          spot!.box.x0 >= box.x1,
      ).toBe(true);
  });

  it("gives up when nowhere on the line is clear", () => {
    const wall: Box = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
    expect(edgeLabelSpot(centre, outer, "same article", [wall])).toBeNull();
  });
});
