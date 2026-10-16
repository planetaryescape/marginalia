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
// Where lines sit, by data-y; happy-dom has no layout.
let lineOffset = 0;

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
  version = 1,
  onClose = () => {},
  onOpenNotes = () => {},
  onMarkClick = () => {},
  initialOpen = null,
}: {
  mode?: "sidenotes" | "phone" | "sheet";
  notes?: SidenoteAnnotation[];
  users?: SidenoteUserNote[];
  waiting?: boolean;
  version?: number;
  onClose?: () => void;
  onOpenNotes?: () => void;
  onMarkClick?: (id: string) => void;
  initialOpen?: string | null;
}) {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState<string | null>(initialOpen);
  (window as unknown as { setOpen: typeof setOpen }).setOpen = setOpen;
  return (
    <>
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
        marks={[]}
        waiting={waiting}
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

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reducedMotion = false;
  ioConstructed = 0;
  lineOffset = 0;
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
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains("sidenote") && this.dataset.open === "true")
        return Number(
          this.querySelector("[data-card-height]")?.getAttribute(
            "data-card-height",
          ) ?? 70,
        );
      return 0;
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ioDisconnect.mockReset();
  roDisconnect.mockReset();
});

describe("Sidenotes at a wide width", () => {
  it("renders every annotation as a sidenote with its kind and text, and no number", async () => {
    await render(<Article />);
    const notes = all(".sidenote:not(.sidenote-waiting)");
    expect(notes).toHaveLength(3);
    expect(q('[data-key="a:a1"] .sidenote-kind')?.textContent).toBe(
      "connection",
    );
    expect(q('[data-key="a:a1"] .sidenote-text')?.textContent).toBe(
      "Ties to your earlier note. ¶14",
    );
    expect(q('[data-key="a:a2"] .sidenote-kind')?.textContent).toBe("tension");
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
    const mark = q('[data-annotation-id="a1"]') as HTMLElement;
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
        marks={[{ doc: { _id: "h1" }, range }]}
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
    await act(async () =>
      (window as unknown as { setOpen: (v: null) => void }).setOpen(null),
    );
    expect(document.activeElement).toBe(q('[data-key="a:a2"] .sidenote-hit'));
  });

  it("leaves focus alone when it already moved somewhere else", async () => {
    await render(<Article initialOpen="a2" />);
    const mark = q('[data-annotation-id="a1"]') as HTMLElement;
    mark.tabIndex = 0;
    mark.focus();
    await act(async () =>
      (window as unknown as { setOpen: (v: null) => void }).setOpen(null),
    );
    expect(document.activeElement).toBe(mark);
  });

  it("keeps the open note's slot so neighbours do not move", async () => {
    await render(<Article users={[]} />);
    const before = q('[data-key="a:a2"]')?.style.top;
    await act(async () =>
      (window as unknown as { setOpen: (v: string) => void }).setOpen("a1"),
    );
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
});
