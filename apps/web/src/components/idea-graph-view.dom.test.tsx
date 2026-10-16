// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Graph } from "@/lib/idea-kinds";
import { IdeaGraphView } from "./idea-graph-view";

const graph: Graph = {
  centre: "note:c",
  nodes: [
    {
      key: "note:c",
      kind: "note",
      label: "Block whole mornings",
      hop: 0,
      createdAt: 5,
    },
    {
      key: "highlight:r",
      kind: "highlight",
      label: "too small to return at all",
      hop: 1,
      createdAt: 4,
    },
    { key: "vault:d", kind: "vault", label: "Deep work", hop: 1, createdAt: 3 },
    {
      key: "answer:s",
      kind: "answer",
      label: "Resumption lag",
      hop: 1,
      createdAt: 2,
    },
    {
      key: "note:f",
      kind: "note",
      label: "False choice",
      hop: 1,
      createdAt: 1,
    },
    {
      key: "note:far",
      kind: "note",
      label: "Further out",
      hop: 2,
      createdAt: 0,
    },
    {
      key: "article:q",
      kind: "article",
      label: "The quiet cost",
      hop: 1,
      createdAt: 0,
    },
  ],
  edges: [
    {
      id: "f",
      a: "note:c",
      b: "article:q",
      reasons: [{ type: "article", text: "From this article" }],
      needsAi: false,
    },
    {
      id: "a",
      a: "note:c",
      b: "highlight:r",
      reasons: [{ type: "article", text: "Same article: X" }],
      needsAi: false,
    },
    {
      id: "b",
      a: "note:c",
      b: "vault:d",
      reasons: [{ type: "linked", text: "You linked these" }],
      needsAi: false,
    },
    {
      id: "c",
      a: "note:c",
      b: "answer:s",
      reasons: [{ type: "similar", text: "Close in meaning" }],
      needsAi: true,
    },
    {
      id: "d",
      a: "note:c",
      b: "note:f",
      reasons: [{ type: "tag", text: "Shared tag: focus" }],
      needsAi: false,
    },
    {
      id: "e",
      a: "note:f",
      b: "note:far",
      reasons: [{ type: "article", text: "Same article: Y" }],
      needsAi: false,
    },
  ],
};

const handlers = {
  onOpen: vi.fn(),
  onEdge: vi.fn(),
  onEscape: vi.fn(),
};

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  for (const fn of Object.values(handlers)) fn.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (over: Partial<Parameters<typeof IdeaGraphView>[0]> = {}) =>
  act(async () =>
    root.render(
      <IdeaGraphView
        graph={graph}
        width={770}
        height={700}
        edgeId={null}
        addedKey={null}
        focusKey={null}
        {...handlers}
        {...over}
      />,
    ),
  );
const node = (key: string) =>
  host.querySelector<SVGGElement>(`[data-node="${key}"]`) as SVGGElement;
const press = (el: Element, key: string) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

describe("the idea map", () => {
  it("draws every idea as a focusable button, naming its kind and the centre", async () => {
    await render();
    const nodes = host.querySelectorAll("[data-node]");
    expect(nodes).toHaveLength(7);
    expect(node("article:q").querySelector("rect")).not.toBeNull();
    expect(node("article:q").getAttribute("aria-label")).toBe(
      "Article: The quiet cost",
    );
    for (const n of nodes) expect(n.getAttribute("tabindex")).toBe("0");
    expect(node("note:c").getAttribute("aria-label")).toBe(
      "Your note: Block whole mornings. At the centre",
    );
    expect(node("vault:d").getAttribute("aria-label")).toBe(
      "From your vault: Deep work",
    );
    expect(node("note:c").getAttribute("aria-current")).toBe("true");
  });

  it("labels the lines between the first ring and leaves the second ring unlabelled", async () => {
    await render();
    const text = host.textContent ?? "";
    for (const label of [
      "same article",
      "you linked these",
      "close in meaning",
      "shared tag: focus",
    ])
      expect(text).toContain(label);
    expect(host.querySelectorAll("[aria-pressed]")).toHaveLength(6);
  });

  it("moves between ideas with the arrow keys", async () => {
    await render();
    node("note:c").focus();
    await press(node("note:c"), "ArrowUp");
    // The first idea sits straight above the centre
    expect(document.activeElement).toBe(node("highlight:r"));
    await press(node("highlight:r"), "ArrowDown");
    expect(document.activeElement).toBe(node("note:c"));
    await press(node("note:c"), "ArrowRight");
    expect(document.activeElement).toBe(node("vault:d"));
  });

  it("opens the focused idea on Enter, shows its line on Space, and reports Escape", async () => {
    await render();
    await press(node("vault:d"), "Enter");
    expect(handlers.onOpen).toHaveBeenCalledWith("vault:d");

    await press(node("answer:s"), " ");
    expect(handlers.onEdge).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c" }),
    );
    // A second-ring idea explains the line to the neighbour it hangs off
    await press(node("note:far"), " ");
    expect(handlers.onEdge).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "e" }),
    );

    await press(node("note:c"), "Escape");
    expect(handlers.onEscape).toHaveBeenCalled();
  });

  it("opens an idea on click and selects a line on click", async () => {
    await render();
    await act(async () =>
      node("note:f").dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(handlers.onOpen).toHaveBeenCalledWith("note:f");
    const line = host.querySelector('[aria-label^="Why"]') as Element;
    await act(async () =>
      line.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(handlers.onEdge).toHaveBeenCalled();
  });

  it("marks the selected line and moves focus to a chosen idea", async () => {
    await render({ edgeId: "b", focusKey: "vault:d" });
    const pressed = host.querySelector('[aria-pressed="true"]');
    expect(pressed?.getAttribute("aria-label")).toContain("Deep work");
    expect(document.activeElement).toBe(node("vault:d"));
  });
});
