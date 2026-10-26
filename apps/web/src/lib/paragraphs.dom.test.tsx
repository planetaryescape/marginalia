// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerUnfold } from "@/components/note-unfold";
import { getParagraphs, useParagraphs } from "./paragraphs";

let root: Root;
let version = 0;
let layoutVersion = 0;
let resized: ResizeObserverCallback;
const resizeBody = (width: number, height = 0) =>
  resized(
    [
      {
        target: document.body,
        contentRect: new DOMRect(0, 0, width, height),
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      },
    ],
    { observe() {}, unobserve() {}, disconnect() {} },
  );

function Article({ answerFor }: { answerFor: number | null | undefined }) {
  const ref = useRef<HTMLElement>(null);
  const paragraphs = useParagraphs(ref, true);
  version = paragraphs.version;
  layoutVersion = paragraphs.layoutVersion;
  return (
    <>
      <article ref={ref}>
        <div data-article-body>
          <p>First paragraph of the piece.</p>
          <p>Second paragraph of the piece.</p>
          <p>Third paragraph of the piece.</p>
        </div>
      </article>
      {answerFor !== undefined && (
        <AnswerUnfold
          containerRef={ref}
          version={version}
          id="answer-1"
          paragraphIndex={answerFor}
        >
          <div>
            <blockquote>A quoted passage.</blockquote>
            <p>An answer that is not part of the article.</p>
            <p>Nor is this one.</p>
          </div>
        </AnswerUnfold>
      )}
    </>
  );
}

const render = (answerFor: number | null | undefined) =>
  act(async () => root.render(<Article answerFor={answerFor} />));
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
/** An edit to the article itself, which makes the numbering run again. */
const retag = async () => {
  const body = document.querySelector("[data-article-body] p") as HTMLElement;
  body.append(" ");
  await settle();
};
const numbering = () =>
  getParagraphs(document.querySelector<HTMLElement>("[data-article-body]")).map(
    (p) => `${p.dataset.para}:${p.textContent?.trim()}`,
  );

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("answers unfolded in the flow on a phone", () => {
  it("keeps prose epochs and nodes stable through streamed UI growth and geometry-only resize, but observes prose edits", async () => {
    await render(0);
    await settle();
    const before = version;
    const geometryBefore = layoutVersion;
    const host = document.querySelector("[data-marginalia-ui]")!;
    const first = document.querySelector("[data-article-body] p")!;
    const measure = vi.spyOn(first, "getBoundingClientRect");
    await act(async () => {
      host.querySelector("p")!.firstChild!.textContent =
        "Streamed answer grows";
      resizeBody(0, 1000);
    });
    await settle();
    expect(version).toBe(before);
    expect(layoutVersion).toBe(geometryBefore + 1);
    expect(measure).not.toHaveBeenCalled();
    await act(async () => resizeBody(700));
    await settle();
    expect(version).toBe(before);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-marginalia-ui]")).toBe(host);
    await act(async () => {
      first.firstChild!.textContent = "Changed article prose";
    });
    await settle();
    expect(version).toBe(before + 1);
    expect(first.getAttribute("data-para")).toBe("1");
    expect(host.querySelector("p")!.hasAttribute("data-para")).toBe(false);
    measure.mockRestore();
  });
  it("leave every ¶ number unchanged, under a paragraph", async () => {
    await render(undefined);
    await settle();
    const before = numbering();
    expect(before).toHaveLength(3);
    await render(0);
    await settle();
    await retag();
    expect(numbering()).toEqual(before);
    const host = document.querySelector("[data-marginalia-ui]");
    expect(host?.textContent).toContain("An answer that is not part of");
    expect(host?.previousElementSibling?.getAttribute("data-para")).toBe("1");
  });

  it("leave the numbering alone for an answer about the whole article, and stay put", async () => {
    await render(undefined);
    await settle();
    const before = numbering();
    await render(null);
    await settle();
    await retag();
    const host = document.querySelector("[data-marginalia-ui]");
    expect(host?.nextElementSibling?.getAttribute("data-para")).toBe("1");
    expect(numbering()).toEqual(before);
    // Re-tagging must not tear the host out and put it back
    await settle();
    expect(document.querySelector("[data-marginalia-ui]")).toBe(host);
  });
});
