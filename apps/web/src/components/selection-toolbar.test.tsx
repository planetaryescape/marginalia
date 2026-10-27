// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectionToolbar } from "./selection-toolbar";

vi.mock("@/lib/companion", () => ({ usePassageHighlight: vi.fn() }));
let root: Root;
let article: HTMLElement;
const onMarkInColor = vi.fn();
let markedColor: (kind: string) => string | null = () => null;
beforeEach(async () => {
  onMarkInColor.mockReset();
  markedColor = () => null;
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
        onMarkInColor={onMarkInColor}
        markedColor={(kind) => markedColor(kind) as never}
        defaultColors={{ highlight: "green", underline: "cobalt" }}
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
  vi.restoreAllMocks();
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
  it("preserves the native touch context menu and selected passage", () => {
    const passage = article.querySelector("p")!;
    select(passage);
    const event = nativeMenu(passage);
    expect(event.defaultPrevented).toBe(false);
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

describe("selection measurement lifecycle", () => {
  const frame = () =>
    act(async () => {
      await new Promise(requestAnimationFrame);
    });
  it("coalesces selection and viewport events, preserving the range on tool clicks and Ask focus", async () => {
    await frame();
    const measure = vi.spyOn(Range.prototype, "getBoundingClientRect");
    select(article.querySelector("p")!);
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        document.dispatchEvent(new Event("selectionchange"));
        window.dispatchEvent(new Event("scroll"));
        window.dispatchEvent(new Event("resize"));
      }
      await new Promise(requestAnimationFrame);
    });
    expect(measure).toHaveBeenCalledTimes(1);
    const ask = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Ask",
    )!;
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    ask.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).toBe("A passage worth keeping.");
    await act(async () => ask.click());
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Ask about this passage",
    );
    measure.mockRestore();
  });

  it("cancels collapsed-selection hides after reselection and disposes pending work on unmount", async () => {
    select(article.querySelector("p")!);
    await frame();
    await act(async () => {
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise(requestAnimationFrame);
    });
    select(article.querySelector("p")!);
    await frame();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 230));
    });
    expect(document.querySelector('[role="toolbar"]')).not.toBeNull();
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      root.unmount();
    });
    expect(cancel).toHaveBeenCalled();
    root = createRoot(document.getElementById("toolbar")!);
    cancel.mockRestore();
  });

  it("owns and cancels the delayed hide timer on unmount", async () => {
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const clear = vi.spyOn(globalThis, "clearTimeout");
    select(article.querySelector("p")!);
    await frame();
    await act(async () => {
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise(requestAnimationFrame);
    });
    const at = timeout.mock.calls.findLastIndex(([, delay]) => delay === 200);
    expect(at).toBeGreaterThanOrEqual(0);
    const timer = timeout.mock.results[at].value;
    await act(async () => root.unmount());
    expect(clear).toHaveBeenCalledWith(timer);
    root = createRoot(document.getElementById("toolbar")!);
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
      "Highlight colour, now green",
      "Underline",
      "Underline colour, now cobalt",
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

describe("Scripture-only Deep study entry", () => {
  async function withStudy(
    onDeepStudy: (range: Range) => Promise<string | null>,
  ) {
    await act(async () =>
      root.render(
        <SelectionToolbar
          containerRef={{ current: article }}
          getCurrentParagraphRange={() => null}
          onAddNote={vi.fn()}
          onCompanion={vi.fn()}
          onDeepStudy={onDeepStudy}
          depth="quick"
          onDepthChange={vi.fn()}
          web={false}
          onWebChange={vi.fn()}
          isMarked={() => false}
          onToggleMark={vi.fn()}
          onMarkInColor={onMarkInColor}
          markedColor={() => null}
          defaultColors={{ highlight: "green", underline: "cobalt" }}
        />,
      ),
    );
    select(article.querySelector("p")!);
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise(requestAnimationFrame);
    });
  }
  it("does not offer Study on an ordinary article", async () => {
    select(article.querySelector("p")!);
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise(requestAnimationFrame);
    });
    expect(document.body.textContent).not.toContain("Deep study");
  });
  it("retains the selected endpoints on failure, without replacing Ask or marks", async () => {
    const study = vi.fn().mockResolvedValue("Select verses in one chapter.");
    await withStudy(study);
    const button = [...document.querySelectorAll("button")].find(
      (node) => node.textContent === "Deep study",
    );
    if (!button) throw new Error("Missing Study action");
    await act(async () => button.click());
    expect(study.mock.calls[0][0].toString()).toBe("A passage worth keeping.");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "one chapter",
    );
    expect(window.getSelection()?.toString()).toBe("A passage worth keeping.");
    expect(document.body.textContent).toContain("Ask");
    expect(
      document.querySelector('button[aria-label="Highlight"]'),
    ).not.toBeNull();
  });
  it("starts only once for repeated clicks, and dismisses only after successful handoff", async () => {
    let release!: (value: null) => void;
    const gate = new Promise<null>((resolve) => {
      release = resolve;
    });
    const study = vi.fn(() => gate);
    await withStudy(study);
    const button = [...document.querySelectorAll("button")].find(
      (node) => node.textContent === "Deep study",
    );
    if (!button) throw new Error("Missing Study action");
    await act(async () => {
      button.click();
      button.click();
    });
    expect(study).toHaveBeenCalledOnce();
    expect(window.getSelection()?.isCollapsed).toBe(false);
    await act(async () => release(null));
    expect(window.getSelection()?.isCollapsed).toBe(true);
  });
});

describe("the colour picker", () => {
  async function open() {
    select(article.querySelector("p")!);
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
    });
  }
  const button = (label: string) =>
    document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

  it("opens four dots for the tool, with its default checked and focused", async () => {
    await open();
    await act(async () => button("Highlight colour, now green").click());
    const dots = Array.from(
      document.querySelectorAll('[role="radiogroup"] [role="radio"]'),
      (el) => [el.getAttribute("aria-label"), el.getAttribute("aria-checked")],
    );
    expect(dots).toEqual([
      ["Yellow", "false"],
      ["Green", "true"],
      ["Blue", "false"],
      ["Pink", "false"],
    ]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Green");
  });

  it("marks the passage in the picked colour and closes", async () => {
    await open();
    await act(async () => button("Underline colour, now cobalt").click());
    await act(async () => button("Vermilion").click());
    expect(onMarkInColor).toHaveBeenCalledWith(
      "underline",
      expect.any(Range),
      "vermilion",
    );
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("shows the colour of a mark already on the passage as the choice", async () => {
    markedColor = (kind) => (kind === "highlight" ? "pink" : null);
    await open();
    await act(async () => button("Highlight colour, now pink").click());
    expect(button("Pink").getAttribute("aria-checked")).toBe("true");
  });

  it("moves between dots with the arrow keys and Escape goes back to the tools", async () => {
    await open();
    await act(async () => button("Highlight colour, now green").click());
    await act(async () => {
      button("Green").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Blue");
    await act(async () => {
      button("Blue").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    expect(button("Highlight")).not.toBeNull();
    expect(onMarkInColor).not.toHaveBeenCalled();
  });
});
