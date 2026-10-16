// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectionToolbar } from "./selection-toolbar";

vi.mock("@/lib/companion", () => ({ usePassageHighlight: vi.fn() }));
let root: Root;
let article: HTMLElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(50, 200, 100, 30),
  });
  document.body.innerHTML =
    '<article><div data-article-body><p>A passage worth keeping.</p></div><input aria-label="A note" value="My note"></article><div id="toolbar"></div><p id="outside">Other content</p>';
  article = document.querySelector("article")!;
  root = createRoot(document.getElementById("toolbar")!);
  await act(async () =>
    root.render(
      <SelectionToolbar
        containerRef={{ current: article }}
        getCurrentParagraphRange={() => null}
        onAddNote={vi.fn()}
        onCompanion={vi.fn()}
        depth="quick"
        onDepthChange={vi.fn()}
        web={false}
        onWebChange={vi.fn()}
        isMarked={() => false}
        onToggleMark={vi.fn()}
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});

function select(node: Node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  act(() => {
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
}
function nativeMenu(target: Element) {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}
describe("native passage menus", () => {
  it("suppresses a duplicate touch context menu without clearing the selected passage", () => {
    const passage = article.querySelector("p")!;
    select(passage);
    const event = nativeMenu(passage);
    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).toBe("A passage worth keeping.");
  });
  it("keeps desktop context menus available", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const passage = article.querySelector("p")!;
    select(passage);
    expect(nativeMenu(passage).defaultPrevented).toBe(false);
  });
  it("does not intercept menus outside the article, in editors, or without selection", () => {
    const passage = article.querySelector("p")!;
    expect(nativeMenu(passage).defaultPrevented).toBe(false);
    select(passage);
    expect(nativeMenu(article.querySelector("input")!).defaultPrevented).toBe(
      false,
    );
    const outside = document.getElementById("outside")!;
    select(outside);
    expect(nativeMenu(outside).defaultPrevented).toBe(false);
  });
});

describe("the passage menu, ordered by hand", () => {
  it("puts the pen actions first, then a hairline, then the pencil actions, then Copy", async () => {
    select(article.querySelector("p")!);
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    const toolbar = document.querySelector('[role="toolbar"]')!;
    const order = Array.from(toolbar.querySelectorAll("button, hr"), (el) =>
      el.tagName === "HR"
        ? "|"
        : (el.getAttribute("aria-label") ?? el.textContent?.trim() ?? ""),
    );
    expect(order).toEqual([
      "Highlight",
      "Underline",
      "Add note",
      "|",
      "Explain",
      "Simplify",
      "Define",
      "Ask",
      "Copy",
    ]);
  });
});
