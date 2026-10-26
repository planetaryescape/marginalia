// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWEEP_MS, sweepHighlight } from "./highlight-sweep";

const rect = (left: number, top: number, width: number) =>
  ({ left, top, width, height: 20 }) as DOMRect;

function rangeOf(rects: DOMRect[]) {
  return { getClientRects: () => rects } as unknown as Range;
}

let animate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  animate = vi.fn(() => ({ finished: Promise.resolve() }));
  Element.prototype.animate = animate as never;
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const reduced = (on: boolean) =>
  vi.stubGlobal("matchMedia", () => ({ matches: on }));

describe("the highlighter sweep", () => {
  it("sweeps each line in proportion to its length, 180 ms in all", () => {
    reduced(false);
    sweepHighlight(rangeOf([rect(10, 0, 300), rect(10, 20, 100)]));
    expect(animate).toHaveBeenCalledTimes(2);
    const [first, second] = animate.mock.calls.map((c) => c[1]);
    expect(first).toMatchObject({
      delay: 0,
      duration: (SWEEP_MS * 300) / 400,
      easing: "linear",
    });
    expect(second).toMatchObject({
      delay: (SWEEP_MS * 300) / 400,
      duration: (SWEEP_MS * 100) / 400,
    });
  });

  it("paints in the highlighter colour and leaves the page when done", async () => {
    reduced(false);
    sweepHighlight(rangeOf([rect(10, 0, 300)]));
    const layer = document.body.lastElementChild as HTMLElement;
    expect(layer.innerHTML).toContain("var(--highlighter)");
    expect(layer.innerHTML).not.toContain("var(--pen)");
    await vi.advanceTimersByTimeAsync(200);
    expect(document.body.contains(layer)).toBe(false);
  });

  it("with reduced motion draws nothing: the final highlight just appears", () => {
    reduced(true);
    sweepHighlight(rangeOf([rect(10, 0, 300)]));
    expect(animate).not.toHaveBeenCalled();
    expect(document.body.children).toHaveLength(0);
  });

  it("ignores a selection with no width", () => {
    reduced(false);
    sweepHighlight(rangeOf([rect(10, 0, 0)]));
    expect(document.body.children).toHaveLength(0);
  });
});
