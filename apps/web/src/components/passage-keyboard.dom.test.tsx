// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectionToolbar } from "./selection-toolbar";

vi.mock("@/lib/companion", () => ({ usePassageHighlight: vi.fn() }));
// Test settled UI states; happy-dom cannot finish exit animations.
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  const { createElement, Fragment } = await import("react");
  const tags = new Map<string, unknown>();
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      createElement(Fragment, null, children),
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => {
          if (!tags.has(tag))
            tags.set(
              tag,
              ({
                children,
                initial: _initial,
                animate: _animate,
                exit: _exit,
                transition: _transition,
                layout: _layout,
                layoutDependency: _layoutDependency,
                ...props
              }: Record<string, unknown>) =>
                createElement(tag, props, children as React.ReactNode),
            );
          return tags.get(tag);
        },
      },
    ),
  };
});

const onCompanion = vi.fn();
const onAddNote = vi.fn();
const restoreCursorFocus = vi.fn();
let root: Root;
let cursorBlock = 0;

const PROSE =
  "<p>First paragraph, read aloud.</p><p>Second paragraph with <a href='#x'>a link</a>.</p>";
function Prose() {
  const ref = useRef<HTMLElement>(null);
  return (
    <>
      <article ref={ref}>
        <div
          data-article-body
          // biome-ignore lint/security/noDangerouslySetInnerHtml: fixed test markup
          dangerouslySetInnerHTML={{ __html: PROSE }}
        />
      </article>
      <SelectionToolbar
        containerRef={ref}
        getCurrentParagraphRange={() => null}
        getCursorRange={() => {
          const p = ref.current?.querySelectorAll("p")[cursorBlock];
          if (!p) return null;
          const range = document.createRange();
          range.selectNodeContents(p);
          return range;
        }}
        restoreCursorFocus={restoreCursorFocus}
        onAddNote={onAddNote}
        onCompanion={onCompanion}
        depth="quick"
        onDepthChange={vi.fn()}
        web={false}
        onWebChange={vi.fn()}
        isMarked={() => false}
        onToggleMark={vi.fn()}
        onMarkInColor={vi.fn()}
        markedColor={() => null}
        defaultColors={{ highlight: "green", underline: "cobalt" }}
      />
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(50, 200, 100, 30),
  });
  onCompanion.mockReset();
  onAddNote.mockReset();
  restoreCursorFocus.mockReset();
  cursorBlock = 0;
  document.body.innerHTML = '<div id="host"></div>';
  root = createRoot(document.getElementById("host")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
  Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  vi.unstubAllGlobals();
});

const press = (key: string, target: EventTarget = document.body) => {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};
const menu = () => document.querySelector('[role="toolbar"]');
const keycaps = () =>
  [...document.querySelectorAll('[role="toolbar"] kbd')].map(
    (k) => k.textContent,
  );
const frame = () =>
  act(async () => {
    await new Promise(requestAnimationFrame);
  });

describe("Enter opens Passage actions on the cursor", () => {
  beforeEach(async () => {
    await act(async () => root.render(<Prose />));
  });

  it("opens on the cursor paragraph, and Escape closes it and hands focus back", async () => {
    cursorBlock = 1;
    expect(press("Enter").defaultPrevented).toBe(true);
    await frame();
    expect(menu()).not.toBeNull();
    await act(async () => press("e"));
    expect(onCompanion).toHaveBeenCalledOnce();
    expect(onCompanion.mock.calls[0][0].mode).toBe("explain");
    expect(onCompanion.mock.calls[0][0].range.toString()).toBe(
      "Second paragraph with a link.",
    );

    press("Enter");
    await frame();
    press("Escape");
    expect(menu()).toBeNull();
    expect(restoreCursorFocus).toHaveBeenCalledOnce();
  });

  it("does nothing without a cursor, and leaves Enter on a link to the link", async () => {
    cursorBlock = 9;
    expect(press("Enter").defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
    cursorBlock = 0;
    const link = document.querySelector("a")!;
    expect(press("Enter", link).defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
  });

  it("acts on a real selection in the article instead of the cursor", async () => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelectorAll("p")[1]);
    window.getSelection()?.addRange(range);
    cursorBlock = 0;
    press("Enter");
    await frame();
    await act(async () => press("e"));
    expect(onCompanion.mock.calls[0][0].range.toString()).toBe(
      "Second paragraph with a link.",
    );
  });

  it("runs a menu key on the menu's range, not on a selection made since", async () => {
    cursorBlock = 0;
    press("Enter");
    await frame();
    const other = document.createRange();
    other.selectNodeContents(document.querySelectorAll("p")[1]);
    window.getSelection()?.addRange(other);
    await act(async () => press("e"));
    expect(onCompanion.mock.calls[0][0].range.toString()).toBe(
      "First paragraph, read aloud.",
    );
  });

  it("gives Note and Copy their own keys while the menu is open", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: write } });
    press("Enter");
    await frame();
    await act(async () => press("n"));
    expect(onAddNote).toHaveBeenCalledWith({
      text: "First paragraph, read aloud.",
    });
    expect(menu()).toBeNull();
    press("Enter");
    await frame();
    await act(async () => press("c"));
    expect(write).toHaveBeenCalledWith("First paragraph, read aloud.");
  });

  it("leaves n, c and t alone when the menu is closed", () => {
    press("n");
    press("c");
    expect(onAddNote).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it("ignores menu keys while the Ask field has focus", async () => {
    press("Enter");
    await frame();
    await act(async () => press("a"));
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Ask about this passage"]',
    )!;
    expect(document.activeElement).toBe(input);
    for (const key of ["e", "s", "n", "c", "h"]) press(key, input);
    expect(onCompanion).not.toHaveBeenCalled();
    expect(onAddNote).not.toHaveBeenCalled();
    expect(menu()).not.toBeNull();
  });

  it("shows keys beside the actions when opened by keyboard, and only in tooltips for a pointer selection", async () => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("p")!);
    await act(async () => {
      window.getSelection()?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise(requestAnimationFrame);
    });
    expect(menu()).not.toBeNull();
    expect(keycaps()).toEqual([]);
    expect(
      document.querySelector('button[title="Explain (E)"]'),
    ).not.toBeNull();

    // Enter on an open menu is how a pointer user asks to see them.
    press("Enter");
    expect(keycaps()).toEqual(
      expect.arrayContaining(["H", "P", "N", "E", "S", "D", "A", "C"]),
    );
  });

  it("shows them for a keyboard-opened menu from the start, and closes the menu on j", async () => {
    press("Enter");
    await frame();
    expect(keycaps()).toEqual(
      expect.arrayContaining(["H", "P", "N", "E", "S", "D", "A", "C"]),
    );
    press("j");
    expect(menu()).toBeNull();
  });

  it("keeps a keyboard-opened menu through selection events with nothing selected", async () => {
    press("Enter");
    await frame();
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, 230));
    });
    expect(menu()).not.toBeNull();
  });
});
