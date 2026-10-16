// @vitest-environment happy-dom
import { act, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderMap } from "./reader-map";

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Five invented paragraphs: a question, a plain one, a highlighted one, a connection, a plain one
  document.body.innerHTML = `
    <div id="reader"><div data-article-body>
      <p data-para>Plain opening paragraph with some invented words.</p>
      <p data-para>A paragraph with a <span class="annotation-mark" data-type="question">mark</span>.</p>
      <p data-para>A paragraph the reader highlighted for a while.</p>
      <p data-para>A paragraph with a <span class="annotation-mark" data-type="cross_reference">connection</span>.</p>
      <p data-para>Plain closing paragraph, also invented.</p>
    </div></div>`;
  container = document.getElementById("reader") as HTMLElement;
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  root = createRoot(mount);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const render = (over: { current?: number; ticks?: number[] } = {}) =>
  act(async () =>
    root.render(
      <ReaderMap
        containerRef={{ current: container } as RefObject<HTMLElement>}
        version={1}
        position={
          {
            current: over.current ?? 0,
            firstVisible: 0,
            lastVisible: 0,
          } as never
        }
        marked={null}
        saved={[]}
        ticks={over.ticks ?? [2]}
        onJump={vi.fn()}
        minutesLeft={6}
      />,
    ),
  );

const nav = () =>
  document.querySelector("nav[aria-label='Article map']") as HTMLElement;
const dots = () =>
  [...nav().querySelectorAll("circle")].map((c) => c.getAttribute("fill"));
const ticks = () =>
  [...nav().querySelectorAll("rect")].filter(
    (r) => r.getAttribute("fill") === "var(--pen)",
  );
const bars = () =>
  [...nav().querySelectorAll("rect")].filter((r) =>
    ["var(--reader-fg)", "var(--reader-muted)"].includes(
      r.getAttribute("fill") ?? "",
    ),
  );

describe("paragraph map", () => {
  it("colours each annotated paragraph's dot by its kind", async () => {
    await render();
    expect(dots()).toEqual(["var(--kind-question)", "var(--kind-connection)"]);
  });

  it("colours the new kinds, and draws no dot for a kind it doesn't know", async () => {
    const paragraphs = container.querySelectorAll("p");
    const kinds = [
      ["fallacy", "var(--kind-fallacy)"],
      ["other_explanation", "var(--kind-other-explanation)"],
      ["strong_point", "var(--kind-strong-point)"],
      ["crux", "var(--kind-crux)"],
      ["something_new", null],
    ] as const;
    // Re-mark five paragraphs, each with one kind
    for (const [i, [type]] of kinds.entries())
      paragraphs[i].innerHTML =
        `Invented <span class="annotation-mark" data-type="${type}">text</span>.`;
    await render();
    expect(dots()).toEqual(
      kinds.flatMap(([, color]) => (color ? [color] : [])),
    );
  });

  it("marks the reader's highlighted paragraphs with a pen tick, 6 by 2", async () => {
    await render({ ticks: [2] });
    expect(ticks()).toHaveLength(1);
    expect(ticks()[0].getAttribute("width")).toBe("6");
    expect(ticks()[0].getAttribute("height")).toBe("2");
  });

  it("draws the current paragraph as the ink bar and the rest muted", async () => {
    await render({ current: 0 });
    const ink = bars().filter(
      (r) => r.getAttribute("fill") === "var(--reader-fg)",
    );
    expect(ink).toHaveLength(1);
    expect(bars()).toHaveLength(5);
    expect(bars()[0].getAttribute("fill")).toBe("var(--reader-fg)");
  });

  it("keeps the time left in its label", async () => {
    await render();
    const slider = nav().querySelector("[role=slider]") as HTMLElement;
    expect(slider.getAttribute("aria-valuetext")).toContain("About 6 min left");
  });
});
