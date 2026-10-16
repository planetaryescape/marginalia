// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarkColor } from "./mark-colours";
import { useMarkPaint } from "./use-mark-paint";

type Mark = {
  doc: { kind: "highlight" | "underline"; color?: MarkColor };
  range: Range;
};

let registry: Map<string, Range[]>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registry = new Map();
  vi.stubGlobal(
    "Highlight",
    class {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    },
  );
  vi.stubGlobal("CSS", {
    highlights: {
      set: (name: string, h: { ranges: Range[] }) =>
        registry.set(name, h.ranges),
      delete: (name: string) => registry.delete(name),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

function Painter(props: {
  marks: Mark[];
  settings: { highlighter: "yellow" | "green"; pen: "cobalt" };
}) {
  useMarkPaint(props.marks, props.settings);
  return null;
}

describe("useMarkPaint", () => {
  it("paints each mark under its own colour, and a colourless one under the setting", async () => {
    const [a, b, c] = [new Range(), new Range(), new Range()];
    const marks: Mark[] = [
      { doc: { kind: "highlight", color: "pink" }, range: a },
      { doc: { kind: "highlight" }, range: b },
      { doc: { kind: "underline", color: "graphite" }, range: c },
    ];
    const root = createRoot(document.createElement("div"));
    await act(async () =>
      root.render(
        <Painter
          marks={marks}
          settings={{ highlighter: "yellow", pen: "cobalt" }}
        />,
      ),
    );
    expect(registry.get("mark-pink")).toEqual([a]);
    expect(registry.get("mark-yellow")).toEqual([b]);
    expect(registry.get("mark-graphite")).toEqual([c]);

    // Changing the default recolours only the mark that has none
    await act(async () =>
      root.render(
        <Painter
          marks={marks}
          settings={{ highlighter: "green", pen: "cobalt" }}
        />,
      ),
    );
    expect(registry.get("mark-pink")).toEqual([a]);
    expect(registry.get("mark-green")).toEqual([b]);
    expect(registry.has("mark-yellow")).toBe(false);

    await act(async () => root.unmount());
    expect(registry.size).toBe(0);
  });
});
