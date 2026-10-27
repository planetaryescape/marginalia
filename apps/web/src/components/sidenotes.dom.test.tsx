// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/reader-settings";
import {
  type SidenoteAnnotation,
  Sidenotes,
  type SidenoteUserNote,
} from "./sidenotes";

let root: Root;
let reducedMotion = false;
let arrive: (records: unknown[]) => void = () => {};
const ioDisconnect = vi.fn();
const roDisconnect = vi.fn();
let ioConstructed = 0;
const animations: {
  el: HTMLElement;
  keyframes: Keyframe[];
  options: unknown;
}[] = [];
// Where lines sit, by data-y; happy-dom has no layout.
let lineOffset = 0;
const heightReads: string[] = [];
const resizeCallbacks: (() => void)[] = [];
const noMarks: React.ComponentProps<typeof Sidenotes>["marks"] = [];
let setOpenNote: (id: string | null) => void;

const annotations: SidenoteAnnotation[] = [
  {
    _id: "a1",
    type: "cross_reference",
    content: "Ties to **your** earlier note. ¶14",
  },
  { _id: "a2", type: "tension", content: "Later work found a smaller effect." },
];
const userNotes: SidenoteUserNote[] = [
  {
    _id: "n1",
    selectedText: "whether you chose to stop",
    contentPlain: "Check the date.\nSecond line.",
  },
  {
    _id: "r1",
    selectedText: "small eviction",
    contentPlain: "A reflection",
    annotationId: "a2",
  },
];

function Article({
  mode = "sidenotes",
  notes = annotations,
  users = userNotes,
  waiting = false,
  waitingAnchor = null,
  version = 1,
  onClose = () => {},
  onOpenNotes = () => {},
  onMarkClick = () => {},
  initialOpen = null,
  progress = 0,
}: {
  mode?: "sidenotes" | "phone" | "sheet";
  notes?: SidenoteAnnotation[];
  users?: SidenoteUserNote[];
  waiting?: boolean;
  waitingAnchor?: string | null;
  version?: number;
  onClose?: () => void;
  onOpenNotes?: () => void;
  onMarkClick?: (id: string) => void;
  initialOpen?: string | null;
  progress?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState<string | null>(initialOpen);
  setOpenNote = setOpen;
  return (
    <>
      <output>{progress}</output>
      <article ref={ref} data-margin={mode}>
        <div data-article-body>
          <p data-para="3" data-y="100">
            <mark
              className="annotation-mark"
              data-annotation-id="a1"
              data-y="100"
              onClick={() => onMarkClick("a1")}
            >
              first anchor
              <sup>1</sup>
            </mark>
          </p>
          <p data-para="4" data-y="140">
            <mark
              className="annotation-mark"
              data-annotation-id="a2"
              data-y="150"
              onClick={() => onMarkClick("a2")}
            >
              second anchor<sup>2</sup>
            </mark>{" "}
            whether you chose to stop
          </p>
        </div>
      </article>
      <Sidenotes
        containerRef={ref}
        mode={mode}
        version={version}
        layoutKey={DEFAULT_SETTINGS}
        annotations={notes}
        userNotes={users}
        marks={noMarks}
        waiting={waiting}
        waitingAnchor={waitingAnchor}
        openId={open}
        onClose={onClose}
        onOpenNotes={onOpenNotes}
      />
    </>
  );
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const render = async (ui: React.ReactElement) =>
  act(async () => root.render(ui));

// Each slot animation reports this as finished; a test can hold it open to keep a shrink in progress.
let animationFinished: Promise<void> = Promise.resolve();
let animationPlaying = false;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reducedMotion = false;
  ioConstructed = 0;
  lineOffset = 0;
  heightReads.length = 0;
  resizeCallbacks.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: typeof arrive) {
        arrive = cb;
        ioConstructed++;
      }
      observe() {}
      disconnect = ioDisconnect;
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect = roDisconnect;
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") && reducedMotion,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal("innerWidth", 1440);
  if (!("escape" in CSS))
    (CSS as unknown as { escape: (s: string) => string }).escape = (s) => s;
  const rect = (y: number) => ({
    top: y,
    height: 20,
    width: 50,
    bottom: y + 20,
    left: 0,
    right: 50,
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function (this: HTMLElement) {
      const y = this.dataset.y;
      return (y === undefined
        ? []
        : [rect(Number(y) + lineOffset)]) as unknown as DOMRectList;
    },
  );
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (
    this: Range,
  ) {
    const node = this.startContainer;
    const y = ((node as HTMLElement).dataset ?? node.parentElement?.dataset)?.y;
    return (y === undefined
      ? []
      : [rect(Number(y) + lineOffset)]) as unknown as DOMRectList;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        right: 1000,
        left: 300,
        top: 0,
        bottom: 3000,
        width: 700,
        height: 3000,
      }) as DOMRect,
  );
  // An open note measures its card, which a test gives a height with data-card-height.
  // A collapsed note is 70px; a card reports its data-card-height.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      heightReads.push(this.className);
      if (this.dataset.liveHeight) return Number(this.dataset.liveHeight);
      if (this.classList.contains("sidenote-hit")) return 70;
      const card =
        this.querySelector("[data-card-height]") ??
        (this.hasAttribute("data-card-height") ? this : null);
      if (card) return Number(card.getAttribute("data-card-height"));
      return this.classList.contains("sidenote") ? 70 : 0;
    },
  });
  animations.length = 0;
  animationFinished = Promise.resolve();
  animationPlaying = false;
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: function (
      this: HTMLElement,
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions,
    ) {
      animations.push({ el: this, keyframes, options });
      return {
        cancel() {},
        get playState() {
          return animationPlaying ? "running" : "finished";
        },
        finished: animationFinished,
      };
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("sidenote-body") ? 70 : 0;
    },
  });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});

afterEach(async () => {
  await act(async () => root.unmount());
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ioDisconnect.mockReset();
  roDisconnect.mockReset();
});

describe("Sidenotes at a wide width", () => {
  it("does no geometry work or observer replacement on unrelated parent progress updates", async () => {
    await render(<Article />);
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    const read = vi.spyOn(HTMLElement.prototype, "getClientRects");
    read.mockClear();
    const observerCount = ioConstructed;
    const disconnects = roDisconnect.mock.calls.length;
    heightReads.length = 0;
    await render(<Article progress={40} />);
    expect(read).not.toHaveBeenCalled();
    expect(heightReads).toEqual([]);
    expect(ioConstructed).toBe(observerCount);
    expect(roDisconnect).toHaveBeenCalledTimes(disconnects);
  });

  it("flushes all moved notes together after their geometry reads", async () => {
    await render(<Article />);
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    heightReads.length = 0;
    lineOffset = 200;
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("resize"));
      await new Promise(requestAnimationFrame);
    });
    expect(
      heightReads.filter((name) => name === "sidenote-layer"),
    ).toHaveLength(1);
    expect(heightReads.at(-1)).toBe("sidenote-layer");
    expect(q('[data-key="a:a1"]')?.style.top).toBe("304px");
    expect(window.scrollY).toBe(0);
  });

  it("coalesces open-card, container and viewport resize notifications into one geometry pass", async () => {
    await render(<Article initialOpen="a1" />);
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    const read = vi.spyOn(HTMLElement.prototype, "getClientRects");
    read.mockClear();
    await act(async () => {
      for (const callback of resizeCallbacks) {
        callback();
        callback();
      }
      window.dispatchEvent(new Event("resize"));
      await new Promise(requestAnimationFrame);
    });
    // The two annotation anchors are measured once, not once per observer.
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("renders every annotation as a sidenote with its kind and text, and no number", async () => {
    await render(<Article />);
    const notes = all(".sidenote:not(.sidenote-waiting)");
    expect(notes).toHaveLength(3);
    expect(q('[data-key="a:a1"] .sidenote-kind')?.textContent).toBe(
      "connection · in your notes",
    );
    expect(q('[data-key="a:a1"] .sidenote-text')?.textContent).toBe(
      "Ties to your earlier note. ¶14",
    );
    expect(q('[data-key="a:a2"] .sidenote-kind')?.textContent).toBe(
      "tension · pushback",
    );
    // Numbers are removed by stylesheet, so check the rule rather than the markup.
    const css = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    expect(css).toMatch(
      /article\[data-margin="sidenotes"\] \.annotation-mark sup,[^{]*\{\s*display: none;/,
    );
    expect(css).toMatch(
      /article\[data-margin="sidenotes"\] \.annotation-mark,[^{]*\{[^}]*border-bottom-width: 0;/,
    );
  });

  it("sets notes at their lines and pushes a later one down with a bent connector", async () => {
    await render(<Article users={[]} />);
    // Line centre is y + 10; the connector sits 6px into the note.
    expect(q('[data-key="a:a1"]')?.style.top).toBe("104px");
    // a2's line is at 150 (anchor 154) but a1 ends at 104 + 70, so it moves to 182.
    const second = q('[data-key="a:a2"]');
    expect(second?.style.top).toBe("182px");
    expect(second?.style.getPropertyValue("--elbow")).toBe("28px");
    expect(
      second?.querySelector(".sidenote-connector")?.getAttribute("data-bent"),
    ).toBe("true");
    expect(
      q('[data-key="a:a1"] .sidenote-connector')?.getAttribute("data-bent"),
    ).toBe("false");
  });

  it("relays out when the lines move on resize, and when annotations stream in", async () => {
    await render(<Article users={[]} />);
    lineOffset = 300;
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(q('[data-key="a:a1"]')?.style.top).toBe("404px");
    await render(
      <Article
        users={[]}
        notes={[
          ...annotations,
          { _id: "a3", type: "question", content: "Streamed in" },
        ]}
      />,
    );
    // a3 has no mark in the text yet, so it takes no space until its mark exists.
    expect(q('[data-key="a:a3"]')?.getAttribute("data-placed")).toBe("false");
    expect(q('[data-key="a:a1"]')?.style.top).toBe("404px");
  });

  it("orders by anchor whatever order the annotations arrive in", async () => {
    await render(<Article users={[]} notes={[...annotations].reverse()} />);
    expect(q('[data-key="a:a1"]')?.style.top).toBe("104px");
    expect(q('[data-key="a:a2"]')?.style.top).toBe("182px");
  });

  it("opens through the mark, so the renderer opens and marks the note viewed", async () => {
    const onMarkClick = vi.fn();
    await render(<Article onMarkClick={onMarkClick} />);
    await act(async () => q('[data-key="a:a2"] .sidenote-hit')?.click());
    expect(onMarkClick).toHaveBeenCalledWith("a2");
  });

  it("gives marks the note's text as a description and removes it on unmount", async () => {
    await render(<Article />);
    const mark = q('[data-annotation-id="a1"]');
    if (!mark) throw new Error("Expected the rendered annotation mark");
    const id = mark.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)?.textContent).toContain(
      "Ties to your earlier note",
    );
    await act(async () => root.unmount());
    root = createRoot(document.getElementById("root") as HTMLElement);
    await render(<Article mode="phone" />);
    expect(
      q('[data-annotation-id="a1"]')?.hasAttribute("aria-describedby"),
    ).toBe(false);
  });

  it("leaves annotation sidenotes out of the tab order but keeps your own reachable", async () => {
    await render(<Article />);
    expect(q('[data-key="a:a1"] button')?.tabIndex).toBe(-1);
    expect(q('[data-key="n:n1"] button')?.tabIndex).toBe(0);
    // Marks stay the keyboard stop for annotations.
    expect(q(".annotation-mark")?.getAttribute("data-annotation-id")).toBe(
      "a1",
    );
  });

  it("renders nothing in the phone and sheet modes", async () => {
    await render(<Article mode="phone" />);
    expect(q(".sidenote-layer")).toBeNull();
    await render(<Article mode="sheet" />);
    expect(q(".sidenote-layer")).toBeNull();
  });
});

describe("your own hand", () => {
  it("shows a note you wrote in pen with its first line, and skips reflections", async () => {
    await render(<Article />);
    const mine = q('[data-key="n:n1"]');
    expect(mine?.getAttribute("data-hand")).toBe("pen");
    expect(mine?.querySelector(".sidenote-kind")?.textContent).toBe(
      "your note",
    );
    expect(mine?.querySelector(".sidenote-text")?.textContent).toBe(
      "Check the date.",
    );
    expect(q('[data-key="n:r1"]')).toBeNull();
  });

  it("opens the notes pane when your note is clicked", async () => {
    const onOpenNotes = vi.fn();
    await render(<Article onOpenNotes={onOpenNotes} />);
    await act(async () => q('[data-key="n:n1"] button')?.click());
    expect(onOpenNotes).toHaveBeenCalled();
  });

  it("draws a pen tick for each highlight without giving it space", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<article id="art"><div data-article-body><p data-para="1" data-y="500">highlighted words</p></div></article>',
    );
    const article = document.getElementById("art") as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(article.querySelector("p") as HTMLElement);
    await render(
      <Sidenotes
        containerRef={{ current: article }}
        mode="sidenotes"
        version={1}
        layoutKey={DEFAULT_SETTINGS}
        annotations={[{ _id: "a1", type: "context", content: "x" }]}
        userNotes={[]}
        marks={[{ doc: { _id: "h1", kind: "highlight" }, range }]}
        waiting={false}
        openId={null}
        onClose={() => {}}
        onOpenNotes={() => {}}
      />,
    );
    // Line centre 510, tick is 2px tall.
    expect(q(".sidenote-tick")?.style.top).toBe("509px");
    // No annotation mark in this article, so the note takes no slot either.
    expect(q('[data-key="a:a1"]')?.getAttribute("data-placed")).toBe("false");
    expect(all(".sidenote-tick")).toHaveLength(1);
  });
});

describe("arrival", () => {
  it("holds a note back until its line comes into view, then keeps it", async () => {
    await render(<Article />);
    const note = () => q('[data-key="a:a1"]');
    expect(note()?.getAttribute("data-arrived")).toBe("false");
    const target = note();
    await act(async () =>
      arrive([
        {
          isIntersecting: true,
          target,
          boundingClientRect: {},
          rootBounds: null,
        },
      ]),
    );
    expect(note()?.getAttribute("data-arrived")).toBe("true");
    await act(async () =>
      arrive([
        {
          isIntersecting: false,
          target,
          boundingClientRect: { bottom: 900 },
          rootBounds: { top: 0 },
        },
      ]),
    );
    expect(note()?.getAttribute("data-arrived")).toBe("true");
    expect(q('[data-key="a:a2"]')?.getAttribute("data-arrived")).toBe("false");
  });

  it("treats a line already scrolled past as arrived", async () => {
    await render(<Article />);
    const target = q('[data-key="a:a2"]');
    await act(async () =>
      arrive([
        {
          isIntersecting: false,
          target,
          boundingClientRect: { bottom: -40 },
          rootBounds: { top: 0 },
        },
      ]),
    );
    expect(target?.getAttribute("data-arrived")).toBe("true");
  });

  it("shows everything in place and observes nothing under reduced motion", async () => {
    reducedMotion = true;
    await render(<Article />);
    expect(
      all(".sidenote").every((n) => n.getAttribute("data-arrived") === "true"),
    ).toBe(true);
    expect(ioConstructed).toBe(0);
  });

  it("disconnects its observers on unmount", async () => {
    await render(<Article />);
    await act(async () => root.unmount());
    expect(ioDisconnect).toHaveBeenCalled();
    expect(roDisconnect).toHaveBeenCalled();
    root = createRoot(document.getElementById("root") as HTMLElement);
  });
});

describe("waiting", () => {
  it("shows the pencil line and the words while annotation runs", async () => {
    await render(<Article waiting notes={[]} users={[]} />);
    const waiting = q(".sidenote-waiting");
    expect(waiting?.getAttribute("role")).toBe("status");
    expect(waiting?.textContent).toContain("Reading alongside you…");
    expect(waiting?.querySelector("svg path")).not.toBeNull();
    expect(waiting?.getAttribute("data-placed")).toBe("true");
  });

  it("sits at the section being written when it is told where that begins", async () => {
    await render(
      <Article waiting waitingAnchor="second anchor" notes={[]} users={[]} />,
    );
    const top = (sel: string) => Number.parseFloat(q(sel)?.style.top ?? "NaN");
    const atTop = top(".sidenote-waiting");
    await render(<Article waiting notes={[]} users={[]} />);
    expect(top(".sidenote-waiting")).not.toBe(atTop);
  });

  it("is gone once annotation is done", async () => {
    await render(<Article waiting={false} />);
    expect(q(".sidenote-waiting")).toBeNull();
  });
});

describe("closing", () => {
  it("closes on a click on the page but not on a mark, a note or a card", async () => {
    const onClose = vi.fn();
    await render(<Article initialOpen="a1" onClose={onClose} />);
    await act(async () => q('[data-annotation-id="a1"]')?.click());
    await act(async () => q('[data-key="a:a2"] button')?.click());
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => q("[data-article-body]")?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close while text is selected", async () => {
    const onClose = vi.fn();
    await render(<Article initialOpen="a1" onClose={onClose} />);
    const range = document.createRange();
    range.selectNodeContents(q("[data-article-body] p") as HTMLElement);
    window.getSelection()?.addRange(range);
    await act(async () => q("[data-article-body]")?.click());
    expect(onClose).not.toHaveBeenCalled();
    window.getSelection()?.removeAllRanges();
  });

  it("hands focus back to the sidenote when the card closes and focus was lost", async () => {
    await render(<Article initialOpen="a2" />);
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => setOpenNote(null));
    expect(document.activeElement).toBe(q('[data-key="a:a2"] .sidenote-hit'));
  });

  it("leaves focus alone when it already moved somewhere else", async () => {
    await render(<Article initialOpen="a2" />);
    const mark = q('[data-annotation-id="a1"]');
    if (!mark) throw new Error("Expected the rendered annotation mark");
    mark.tabIndex = 0;
    mark.focus();
    await act(async () => setOpenNote(null));
    expect(document.activeElement).toBe(mark);
  });

  it("keeps the open note's slot so neighbours do not move", async () => {
    await render(<Article users={[]} />);
    const before = q('[data-key="a:a2"]')?.style.top;
    await act(async () => setOpenNote("a1"));
    expect(q('[data-key="a:a1"]')?.getAttribute("data-open")).toBe("true");
    expect(q('[data-key="a:a2"]')?.style.top).toBe(before);
  });
});

describe("the open card in the column", () => {
  const ids = ["a1", "a2", "a3", "a4"];
  // Anchors are line top + 4: 104, 304, 404, 504. Each closed note is 70px tall.
  function Column({
    openId,
    cardHeight = 260,
  }: {
    openId: string | null;
    cardHeight?: number;
  }) {
    const ref = useRef<HTMLElement>(null);
    return (
      <>
        <article ref={ref}>
          <div data-article-body>
            {[
              ["a1", 100],
              ["a2", 300],
              ["a3", 400],
              ["a4", 500],
            ].map(([id, y]) => (
              <p key={id} data-para={String(y)}>
                <mark
                  className="annotation-mark"
                  data-annotation-id={id}
                  data-y={y}
                >
                  mark {id}
                </mark>
              </p>
            ))}
          </div>
        </article>
        <Sidenotes
          containerRef={ref}
          mode="sidenotes"
          version={1}
          layoutKey={DEFAULT_SETTINGS}
          annotations={ids.map((id) => ({
            _id: id,
            type: "context",
            content: `note ${id}`,
          }))}
          userNotes={[]}
          marks={[]}
          waiting={false}
          openId={openId}
          openCard={
            openId ? (
              <div data-card-height={cardHeight}>card {openId}</div>
            ) : undefined
          }
          onClose={() => {}}
          onOpenNotes={() => {}}
        />
      </>
    );
  }
  const tops = () =>
    Object.fromEntries(
      ids.map((id) => [id, q(`[data-key="a:${id}"]`)?.style.top]),
    );

  it("pushes the notes below an open note by its height and leaves the notes above in place", async () => {
    await render(<Column openId="a2" />);
    expect(tops()).toEqual({
      a1: "104px",
      a2: "304px",
      a3: "572px",
      a4: "650px",
    });
  });

  it("returns every note to its closed place when the note closes", async () => {
    await render(<Column openId="a2" />);
    await render(<Column openId={null} />);
    expect(tops()).toEqual({
      a1: "104px",
      a2: "304px",
      a3: "404px",
      a4: "504px",
    });
  });

  it("collapses the open note and expands the next in one layout, matching a fresh layout", async () => {
    await render(<Column openId="a1" cardHeight={200} />);
    await render(<Column openId="a3" cardHeight={200} />);
    const accordion = tops();
    const open = all('.sidenote[data-open="true"]').map((n) => n.dataset.key);
    expect(open).toEqual(["a:a3"]);
    await act(async () => root.unmount());
    root = createRoot(document.getElementById("root") as HTMLElement);
    await render(<Column openId="a3" cardHeight={200} />);
    expect(tops()).toEqual(accordion);
  });

  it("keeps the outgoing accordion card, not the incoming card, while closing", async () => {
    await render(<Column openId="a1" cardHeight={200} />);
    animationFinished = new Promise(() => {});
    await render(<Column openId="a3" cardHeight={200} />);
    expect(q('[data-key="a:a1"] .sidenote-card-closing')?.textContent).toBe(
      "card a1",
    );
    expect(q('[data-key="a:a3"] .sidenote-card')?.textContent).toBe("card a3");
  });

  it("puts the open card in the column, not in a hit target or a connector", async () => {
    await render(<Column openId="a2" />);
    const note = q('[data-key="a:a2"]') as HTMLElement;
    expect(
      note.querySelector(".sidenote-card [data-card-height]"),
    ).not.toBeNull();
    expect(note.querySelector(".sidenote-hit")).toBeNull();
    expect(note.querySelector(".sidenote-connector")).toBeNull();
    // Column position and width come from the layer's variables, the same as collapsed notes.
    expect(note.style.left).toBe("");
    expect(note.style.width).toBe("");
  });

  it("grows the open slot from its closed height to its card's height over the motion token", async () => {
    await render(<Column openId={null} />);
    await render(<Column openId="a2" />);
    const grow = animations.filter((a) => a.el.dataset.key === "a:a2");
    expect(grow).toHaveLength(1);
    expect(grow[0].keyframes).toEqual([
      { height: "70px" },
      { height: "260px" },
    ]);
    expect(grow[0].options).toEqual({
      duration: 240,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
  });

  it("shrinks the slot back over the same motion when the note closes", async () => {
    await render(<Column openId="a2" />);
    animations.length = 0;
    await render(<Column openId={null} />);
    const shrink = animations.filter((a) => a.el.dataset.key === "a:a2");
    expect(shrink.map((a) => a.keyframes)).toEqual([
      [{ height: "260px" }, { height: "70px" }],
    ]);
  });

  it("reverses an interrupted slot from its live height and ignores the superseded completion", async () => {
    await render(<Column openId={null} />);
    let finishGrow!: () => void;
    animationFinished = new Promise<void>((resolve) => {
      finishGrow = resolve;
    });
    await render(<Column openId="a2" />);
    const note = q('[data-key="a:a2"]')!;
    note.dataset.liveHeight = "140";
    animationPlaying = true;
    let finishShrink!: () => void;
    animationFinished = new Promise<void>((resolve) => {
      finishShrink = resolve;
    });
    await render(<Column openId={null} />);
    expect(
      animations.filter((animation) => animation.el === note).at(-1)?.keyframes,
    ).toEqual([{ height: "140px" }, { height: "70px" }]);
    await act(async () => finishGrow());
    expect(note.querySelector(".sidenote-card-closing")).not.toBeNull();
    animationPlaying = false;
    delete note.dataset.liveHeight;
    await act(async () => finishShrink());
    expect(note.querySelector(".sidenote-card-closing")).toBeNull();
  });

  it("does not animate the slot under reduced motion, but still moves the notes below", async () => {
    reducedMotion = true;
    await render(<Column openId={null} />);
    await render(<Column openId="a2" />);
    expect(animations).toHaveLength(0);
    expect(tops().a3).toBe("572px");
  });

  it("follows a card that streams taller without restarting the slot animation", async () => {
    await render(<Column openId="a2" cardHeight={260} />);
    animations.length = 0;
    await render(<Column openId="a2" cardHeight={300} />);
    expect(animations).toHaveLength(0);
    expect(tops().a3).toBe("612px");
  });

  it("keeps a closed note's card mounted, fading, until its slot has shrunk", async () => {
    await render(<Column openId="a2" />);
    let finishShrink!: () => void;
    const shrinking = new Promise<void>((resolve) => {
      finishShrink = resolve;
    });
    animationFinished = shrinking;
    await render(<Column openId={null} />);
    const note = q('[data-key="a:a2"]') as HTMLElement;
    expect(
      note.querySelector(".sidenote-card-closing [data-card-height]"),
    ).not.toBeNull();
    // The collapsed text stays hidden, not removed, so the slot measures it as it shrinks
    expect(
      note.querySelector<HTMLElement>(".sidenote-hit")?.style.visibility,
    ).toBe("hidden");
    await act(async () => finishShrink());
    expect(note.querySelector(".sidenote-card-closing")).toBeNull();
    expect(
      note.querySelector<HTMLElement>(".sidenote-hit")?.style.visibility,
    ).toBe("");
  });

  it("unmounts the card at once under reduced motion", async () => {
    await render(<Column openId="a2" />);
    reducedMotion = true;
    await render(<Column openId={null} />);
    expect(q('[data-key="a:a2"] .sidenote-card')).toBeNull();
    expect(q('[data-key="a:a2"] .sidenote-card-closing')).toBeNull();
  });
});

describe("Marginalia's answers in the column", () => {
  const opened = vi.fn();
  const closed = vi.fn();
  function Answers({
    openAnswerId,
    onClose = closed,
    answers = [
      {
        id: "d1",
        label: "Define",
        text: "A small mountain lake.",
        selection: "tarn",
        paragraphIndex: 1,
      },
    ],
  }: {
    openAnswerId: string | null;
    onClose?: () => void;
    answers?: React.ComponentProps<typeof Sidenotes>["answers"];
  }) {
    const ref = useRef<HTMLElement>(null);
    return (
      <>
        <article ref={ref}>
          <div data-article-body>
            <p data-para="1" data-y="100">
              Opening words.
            </p>
            <p data-para="2" data-y="300">
              A still tarn lay ahead.
            </p>
            <p data-para="3" data-y="400">
              <mark
                className="annotation-mark"
                data-annotation-id="a1"
                data-y="400"
              >
                later mark
              </mark>
            </p>
          </div>
        </article>
        <Sidenotes
          containerRef={ref}
          mode="sidenotes"
          version={1}
          layoutKey={DEFAULT_SETTINGS}
          annotations={[
            { _id: "a1", type: "context", content: "A later note" },
          ]}
          userNotes={[]}
          marks={[]}
          waiting={false}
          openId={null}
          answers={answers}
          openAnswerId={openAnswerId}
          onOpenAnswer={opened}
          openCard={
            openAnswerId ? (
              <div data-card-height={260}>answer card</div>
            ) : undefined
          }
          onClose={onClose}
          onOpenNotes={() => {}}
        />
      </>
    );
  }
  const top = (key: string) => q(`[data-key="${key}"]`)?.style.top;

  it("sets a collapsed answer beside its passage, in pencil, and opens it on click", async () => {
    opened.mockReset();
    await render(<Answers openAnswerId={null} />);
    // SAFETY: the answer is rendered by this test, so the node exists.
    const note = q('[data-key="c:d1"]') as HTMLElement;
    expect(note.dataset.hand).toBe("pencil");
    expect(note.textContent).toContain("Define");
    expect(note.textContent).toContain("A small mountain lake.");
    expect(top("c:d1")).toBe("304px");
    await act(async () =>
      note.querySelector<HTMLElement>(".sidenote-hit")?.click(),
    );
    expect(opened).toHaveBeenCalledWith("d1");
  });

  it("leaves an independently owned wide answer open when the reader clicks the passage", async () => {
    closed.mockReset();
    await render(<Answers openAnswerId={null} />);
    await act(async () => q("[data-article-body]")?.click());
    expect(closed).not.toHaveBeenCalled();
  });

  it("opens the answer's card in the column and pushes the notes below it down", async () => {
    await render(<Answers openAnswerId={null} />);
    expect(top("a:a1")).toBe("404px");
    await render(<Answers openAnswerId="d1" />);
    // SAFETY: the answer is rendered by this test, so the node exists.
    const note = q('[data-key="c:d1"]') as HTMLElement;
    expect(note.dataset.open).toBe("true");
    expect(
      note.querySelector(".sidenote-card [data-card-height]"),
    ).not.toBeNull();
    expect(top("c:d1")).toBe("304px");
    // 304 + the 260px card + the 8px gap
    expect(top("a:a1")).toBe("572px");
    await render(<Answers openAnswerId={null} />);
    expect(top("a:a1")).toBe("404px");
  });

  it("sets an answer at its paragraph when its passage text can't be found", async () => {
    await render(
      <Answers
        openAnswerId={null}
        answers={[
          {
            id: "x1",
            label: "Explain",
            text: "It means the lake was calm.",
            // Saved with a footnote number the article text doesn't carry
            selection: "still tarn.10 lay",
            paragraphIndex: 1,
          },
        ]}
      />,
    );
    expect(top("c:x1")).toBe("304px");
  });

  it("puts an answer about the whole article at the top of the margin", async () => {
    await render(
      <Answers
        openAnswerId={null}
        answers={[
          {
            id: "w1",
            label: "Ask the article",
            text: "It argues for patience.",
            selection: "",
            paragraphIndex: null,
          },
        ]}
      />,
    );
    expect(top("c:w1")).toBe("100px");
  });

  it("only one note is open: an answer closes the annotation's slot", async () => {
    await render(<Answers openAnswerId="d1" />);
    expect(
      all('.sidenote[data-open="true"]').map((n) => n.dataset.key),
    ).toEqual(["c:d1"]);
  });
});

describe("Sidenotes kinds", () => {
  const kinds = [
    ["tension", "pushback", "tension", "pushback"],
    ["fallacy", "pushback", "fallacy", "pushback"],
    ["assumption", "pushback", "assumption", "pushback"],
    ["unsupported", "pushback", "unsupported", "pushback"],
    ["other_explanation", "pushback", "other explanation", "pushback"],
    ["strong_point", "support", "strong point", "support"],
    ["crux", "support", "crux", "support"],
    ["cross_reference", "connection", "connection", "in your notes"],
    ["context", "connection", "context", "connection"],
    ["question", "connection", "question", "for you"],
  ] as const;

  it.each(
    kinds,
  )("draws %s with its family, label and colour", async (type, family, name, suffix) => {
    await render(
      <Article notes={[{ _id: "a1", type, content: "A short note." }]} />,
    );
    const label = q('[data-key="a:a1"] .sidenote-kind');
    expect(label?.textContent).toBe(`${name} · ${suffix}`);
    expect(label?.getAttribute("data-family")).toBe(family);
    expect(label?.querySelector(".sidenote-dot")).not.toBeNull();
    expect(
      q('[data-key="a:a1"]')?.style.getPropertyValue("--kind-color"),
    ).toMatch(/^var\(--kind-[a-z-]+\)$/);
  });

  it("names a fallacy, and says a connection points into the library", async () => {
    await render(
      <Article
        notes={[
          {
            _id: "a1",
            type: "fallacy",
            fallacyName: "false dilemma",
            content: "Leaves out hybrid.",
          },
          {
            _id: "a2",
            type: "cross_reference",
            articleRefId: "art1",
            content: "Argues the opposite.",
          },
        ]}
      />,
    );
    expect(q('[data-key="a:a1"] .sidenote-kind')?.textContent).toBe(
      "fallacy · false dilemma · pushback",
    );
    expect(q('[data-key="a:a2"] .sidenote-kind')?.textContent).toBe(
      "connection · in your library",
    );
  });

  it("draws a kind it doesn't know as a plain pencil note, without failing", async () => {
    await render(
      <Article
        notes={[
          {
            _id: "a1",
            type: "something_new" as never,
            content: "From a newer backend.",
          },
        ]}
      />,
    );
    const label = q('[data-key="a:a1"] .sidenote-kind');
    expect(label?.textContent).toBe("note");
    expect(label?.querySelector(".sidenote-dot")).toBeNull();
    expect(q('[data-key="a:a1"] .sidenote-text')?.textContent).toBe(
      "From a newer backend.",
    );
  });
});
