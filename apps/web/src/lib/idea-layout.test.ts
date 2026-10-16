import { describe, expect, it } from "vitest";
import { layoutGraph, nextInDirection, wrapLabel } from "./idea-layout";

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
