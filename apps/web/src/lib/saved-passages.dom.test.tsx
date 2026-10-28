// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type PassageSource, useSavedPassages } from "./saved-passages";

let root: Root;
let article: HTMLElement;
let sources: PassageSource[];
let openId: string | undefined;
const opened = vi.fn();
function Harness() {
  const ref = useRef(article);
  useSavedPassages({
    containerRef: ref,
    threads: sources,
    version: 1,
    activeId: undefined,
    isOpen: (id) => id === openId,
    onOpen: opened,
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML =
    '<article><div data-article-body></div></article><div id="mount"></div>';
  article = document.querySelector("article")!;
  const body = article.querySelector("[data-article-body]")!;
  sources = Array.from({ length: 20 }, (_, i) => ({
    _id: `answer-${i}`,
    selection: `Passage ${i} text.`,
    paragraphIndex: i,
    marked: true,
  }));
  for (const [i, source] of sources.entries()) {
    const paragraph = document.createElement("p");
    paragraph.dataset.para = String(i + 1);
    paragraph.textContent = source.selection;
    body.append(paragraph);
  }
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (
    this: Range,
  ) {
    const element =
      this.startContainer instanceof Element
        ? this.startContainer
        : this.startContainer.parentElement;
    const index =
      Number(element?.closest("[data-para]")?.getAttribute("data-para")) - 1;
    const rects = [new DOMRect(0, index * 100, 200, 40)];
    return Object.assign(rects, { item: (at: number) => rects[at] });
  });
  root = createRoot(document.getElementById("mount")!);
  opened.mockReset();
  openId = undefined;
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("does no drag hit testing, bounds hover to the target paragraph, and retains first-match click priority", async () => {
  sources.unshift({ ...sources[10], _id: "first-overlapping-answer" });
  await act(async () => root.render(<Harness />));
  const measure = vi.mocked(Range.prototype.getClientRects);
  measure.mockClear();
  const paragraph = article.querySelectorAll("p")[10];
  await act(async () => {
    paragraph.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        buttons: 1,
        clientX: 10,
        clientY: 1020,
      }),
    );
    await new Promise(requestAnimationFrame);
  });
  expect(measure).not.toHaveBeenCalled();
  await act(async () => {
    paragraph.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 10,
        clientY: 1020,
      }),
    );
    await new Promise(requestAnimationFrame);
  });
  expect(measure).toHaveBeenCalledTimes(1);
  expect(article.style.cursor).toBe("pointer");
  await act(async () =>
    paragraph.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 1020,
      }),
    ),
  );
  expect(opened.mock.calls[0][0].doc._id).toBe("first-overlapping-answer");
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  window.getSelection()?.addRange(range);
  measure.mockClear();
  await act(async () => {
    paragraph.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 10,
        clientY: 1020,
      }),
    );
    await new Promise(requestAnimationFrame);
  });
  expect(measure).not.toHaveBeenCalled();
  expect(article.style.cursor).toBe("");
  window.getSelection()?.removeAllRanges();
});

it("opens each answer on one passage in turn, then the open one again so it closes", async () => {
  sources.unshift(
    { ...sources[10], _id: "first-on-passage" },
    { ...sources[10], _id: "second-on-passage" },
  );
  await act(async () => root.render(<Harness />));
  const paragraph = article.querySelectorAll("p")[10];
  const tap = () =>
    act(async () =>
      paragraph.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 1020,
        }),
      ),
    );
  await tap();
  expect(opened.mock.calls.at(-1)?.[0].doc._id).toBe("first-on-passage");
  openId = "first-on-passage";
  await tap();
  expect(opened.mock.calls.at(-1)?.[0].doc._id).toBe("second-on-passage");
  openId = "second-on-passage";
  await tap();
  expect(opened.mock.calls.at(-1)?.[0].doc._id).toBe("answer-10");
  openId = "answer-10";
  await tap();
  // The last one is open: tapping it again hands it back, and the page closes it
  expect(opened.mock.calls.at(-1)?.[0].doc._id).toBe("answer-10");
});
