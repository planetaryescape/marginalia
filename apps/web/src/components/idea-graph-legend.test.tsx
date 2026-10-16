import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IdeaGraphLegend, trimToRims } from "./idea-graph-view";

describe("map lines", () => {
  it("stop short of each mark instead of running into it", () => {
    const a = { key: "a", hop: 0 as const, x: 0, y: 0, r: 22 };
    const b = { key: "b", hop: 1 as const, x: 200, y: 0, r: 14 };
    const [x1, , x2] = trimToRims(a, b);
    expect(x1).toBeGreaterThan(22 + 6);
    expect(x2).toBeLessThan(200 - 14);
  });

  it("never cross over when two marks sit close", () => {
    const a = { key: "a", hop: 1 as const, x: 0, y: 0, r: 14 };
    const b = { key: "b", hop: 1 as const, x: 20, y: 0, r: 14 };
    const [x1, , x2] = trimToRims(a, b);
    expect(x1).toBeLessThanOrEqual(x2);
  });
});

describe("the legend", () => {
  it("names each kind on screen and what size and fading mean", () => {
    const html = renderToStaticMarkup(
      <IdeaGraphLegend kinds={["note", "highlight", "vault", "article"]} />,
    );
    for (const text of [
      "Your note",
      "Your highlight",
      "From your vault",
      "Article",
      "the idea you",
      "two steps away",
    ])
      expect(html).toContain(text);
  });
});
