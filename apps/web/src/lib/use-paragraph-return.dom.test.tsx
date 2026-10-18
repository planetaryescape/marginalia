// @vitest-environment happy-dom
import { act, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useParagraphReturn } from "./use-paragraph-return";

type Hook = ReturnType<typeof useParagraphReturn>;
let latest: Hook;
let root: Root;
let scrollY = 0;
let reduced = false;

/** Invented article: ten paragraphs, each 100px tall, paragraph i starting at i * 100. */
function Harness({
  articleRef,
}: {
  articleRef: RefObject<HTMLElement | null>;
}) {
  latest = useParagraphReturn(articleRef);
  return null;
}

const jumpTo = (index: number) =>
  act(async () => {
    latest.jump(index);
  });
const backTo = () =>
  act(async () => {
    latest.back();
  });
/** The reader scrolling by hand. */
const userScrollTo = (y: number) =>
  act(async () => {
    scrollY = y;
    window.dispatchEvent(new Event("scroll"));
  });
/** A jump's own scroll lands; the browser reports it with scrollend. */
const settled = () =>
  act(async () => {
    window.dispatchEvent(new Event("scrollend"));
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scrollY = 100;
  reduced = false;
  Object.defineProperty(window, "innerHeight", {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => scrollY,
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") && reduced,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  window.scrollTo = vi.fn((opts: ScrollToOptions) => {
    scrollY = opts.top ?? 0;
  }) as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const index = Number(this.dataset.index ?? -1);
      const top = index * 100 - scrollY;
      return {
        top,
        bottom: top + 100,
        left: 0,
        right: 600,
        width: 600,
        height: 100,
      } as DOMRect;
    },
  );
  document.body.innerHTML =
    '<div id="mount"></div><article id="article"><div data-article-body></div></article>';
  const body = document.querySelector("[data-article-body]") as HTMLElement;
  for (let i = 0; i < 10; i++) {
    const p = document.createElement("p");
    p.dataset.para = String(i);
    p.dataset.index = String(i);
    body.appendChild(p);
  }
  root = createRoot(document.getElementById("mount") as HTMLElement);
  const articleRef = { current: document.getElementById("article") };
  act(() => root.render(<Harness articleRef={articleRef} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const scrollToCalls = () =>
  (window.scrollTo as unknown as { mock: { calls: unknown[][] } }).mock.calls;

describe("in-article jumps", () => {
  it("removes superseded scrollend listeners and the final listener on unmount", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    await jumpTo(5);
    const first = add.mock.calls.find(([event]) => event === "scrollend")![1];
    await jumpTo(6);
    expect(remove).toHaveBeenCalledWith("scrollend", first);
    // Even a superseded completion already queued by the browser cannot end the new jump.
    if (typeof first === "function") first(new Event("scrollend"));
    await userScrollTo(0);
    expect(latest.top).not.toBeNull();
    const last = add.mock.calls
      .filter(([event]) => event === "scrollend")
      .at(-1)![1];
    await act(async () => root.unmount());
    expect(remove).toHaveBeenCalledWith("scrollend", last);
    root = createRoot(document.getElementById("mount")!);
  });
  it("records where the reader was, and Back restores it", async () => {
    await jumpTo(5);
    expect(latest.top).toEqual({ scrollY: 100, paragraph: 1 });
    await settled();
    await backTo();
    expect(scrollToCalls().at(-1)).toEqual([{ top: 100, behavior: "smooth" }]);
    expect(latest.top).toBeNull();
  });

  it("stacks jumps, and Back steps back through them one at a time", async () => {
    await jumpTo(5);
    await settled();
    await userScrollTo(1000);
    await jumpTo(8);
    expect(latest.top?.scrollY).toBe(1000);
    await settled();
    await backTo();
    expect(scrollToCalls().at(-1)?.[0]).toMatchObject({ top: 1000 });
    expect(latest.top?.scrollY).toBe(100);
    await settled();
    await backTo();
    expect(scrollToCalls().at(-1)?.[0]).toMatchObject({ top: 100 });
    expect(latest.top).toBeNull();
  });

  it("clears the entry once the reader scrolls back near the spot themselves", async () => {
    await jumpTo(5);
    await settled();
    await userScrollTo(300);
    expect(latest.top).toBeNull();
  });

  it("ignores the scroll its own jump makes while it settles", async () => {
    await jumpTo(5);
    await userScrollTo(0);
    expect(latest.top).toEqual({ scrollY: 100, paragraph: 1 });
  });

  it("makes one entry for a run of jumps within a viewport", async () => {
    await jumpTo(5);
    // The first jump lands 400px down, reported with scrollend rather than as a user scroll
    scrollY = 500;
    await settled();
    await jumpTo(6);
    expect(latest.top?.scrollY).toBe(100);
    await settled();
    await backTo();
    expect(latest.top).toBeNull();
  });

  it("scrolls instantly for the jump and the return under reduced motion", async () => {
    reduced = true;
    await jumpTo(5);
    const scroll = Element.prototype.scrollIntoView as unknown as {
      mock: { calls: unknown[][] };
    };
    expect(
      scroll.mock.calls.some(
        (c) => (c[0] as ScrollIntoViewOptions).behavior === "instant",
      ),
    ).toBe(true);
    await settled();
    await backTo();
    expect(scrollToCalls().at(-1)?.[0]).toMatchObject({ behavior: "instant" });
  });
});
