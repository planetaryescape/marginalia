// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { findTextRange, rangeText } from "./text-range";

let body: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = `<div data-article-body><p data-para="1"><mark class="annotation-mark" data-annotation-id="a1">They take less time to train.<sup>10</sup></mark> <mark class="annotation-mark" data-annotation-id="a2">Our model achieves 28.4 BLEU.<sup>11</sup></mark> Plain x<sup>2</sup> text.</p></div>`;
  body = document.querySelector("[data-article-body]") as HTMLElement;
});

const rangeOver = (from: string, to: string) => {
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let started = false;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const a = node.data.indexOf(from);
    if (!started && a >= 0) {
      range.setStart(node, a);
      started = true;
    }
    const b = node.data.indexOf(to);
    if (started && b >= 0) {
      range.setEnd(node, b + to.length);
      break;
    }
  }
  return range;
};

describe("rangeText", () => {
  it("leaves out the footnote number of a mark the selection crosses", () => {
    const range = rangeOver("less time", "28.4");
    expect(range.toString()).toContain("train.10");
    expect(rangeText(range)).toBe(
      "less time to train. Our model achieves 28.4",
    );
  });

  it("gives text that anchoring can find again", () => {
    const text = rangeText(rangeOver("less time", "28.4"));
    expect(findTextRange(body, text)).not.toBeNull();
  });

  it("leaves out the footnote of the mark the selection sits inside", () => {
    const mark = body.querySelector('[data-annotation-id="a1"]') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(mark);
    expect(rangeText(range)).toBe("They take less time to train.");
  });

  it("keeps the article's own superscripts outside annotations", () => {
    expect(rangeText(rangeOver("Plain", "text."))).toBe("Plain x2 text.");
  });
});
