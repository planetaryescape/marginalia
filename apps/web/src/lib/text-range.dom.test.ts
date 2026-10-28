// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { occurrencesBefore } from "./lookups";
import { findOccurrenceRange, findTextRange, rangeText } from "./text-range";

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

describe("findOccurrenceRange", () => {
  const bass = () => {
    document.body.innerHTML = `<div data-article-body><p data-para="1">Bass and drums. The bass is low, the <b>bass</b> line moves.</p></div>`;
    const root = document.querySelector("[data-article-body]") as HTMLElement;
    return { root, paragraph: root.querySelector("p") as HTMLElement };
  };
  const startOf = (range: Range | null) => {
    if (!range) return null;
    const before = document.createRange();
    before.selectNodeContents(
      range.startContainer.parentElement!.closest("p")!,
    );
    before.setEnd(range.startContainer, range.startOffset);
    return rangeText(before).length;
  };

  it("finds the match the reader selected, counted the way a selection is captured", () => {
    const { root, paragraph } = bass();
    const third = document.createRange();
    third.selectNodeContents(paragraph.querySelector("b")!.firstChild!);
    const prefix = document.createRange();
    prefix.selectNodeContents(paragraph);
    prefix.setEnd(third.startContainer, third.startOffset);
    const occurrence = occurrencesBefore(rangeText(prefix), "bass");
    expect(occurrence).toBe(2);
    const found = findOccurrenceRange(root, "bass", paragraph, occurrence);
    expect(found?.toString()).toBe("bass");
    expect(found?.startContainer).toBe(third.startContainer);
  });

  it("finds the second match, not the first", () => {
    const { root, paragraph } = bass();
    expect(startOf(findOccurrenceRange(root, "bass", paragraph, 1))).toBe(
      "Bass and drums. The".length,
    );
  });

  it("keeps the exact-case first-match lookup when there's no occurrence, or it can't be found", () => {
    const { root, paragraph } = bass();
    const first = findTextRange(root, "bass", paragraph);
    for (const occurrence of [undefined, 9])
      expect(
        startOf(findOccurrenceRange(root, "bass", paragraph, occurrence)),
      ).toBe(startOf(first));
  });
});

describe("findOccurrenceRange where matches overlap, cross paragraphs or differ in case", () => {
  const mount = (html: string) => {
    document.body.innerHTML = `<div data-article-body>${html}</div>`;
    return document.querySelector("[data-article-body]") as HTMLElement;
  };
  const textNode = (el: Element) => el.firstChild as Text;
  /** The occurrence a selection over `node[start, start+length)` captures. */
  const captured = (
    paragraph: Element,
    node: Text,
    start: number,
    length: number,
  ) => {
    const selection = document.createRange();
    selection.setStart(node, start);
    selection.setEnd(node, start + length);
    const before = document.createRange();
    before.selectNodeContents(paragraph);
    before.setEnd(node, start);
    return occurrencesBefore(rangeText(before), rangeText(selection));
  };

  it("keeps words apart at the edge of the selection", () => {
    const root = mount(
      `<p data-para="1">These notes test our assumptions; we test them daily.</p>`,
    );
    const p = root.querySelector("p")!;
    const second = p.textContent!.lastIndexOf("test");
    const occurrence = captured(p, textNode(p), second, 4);
    expect(occurrence).toBe(1);
    const found = findOccurrenceRange(root, "test", p, occurrence);
    expect(found?.startOffset).toBe(second);
  });

  it("finds the selected letter case where case-blind counting ties", () => {
    const root = mount(`<p data-para="1">ος οσ ΟΣ</p>`);
    const p = root.querySelector("p")!;
    const occurrence = captured(p, textNode(p), 6, 2);
    const found = findOccurrenceRange(root, "ΟΣ", p, occurrence);
    expect(found?.toString()).toBe("ΟΣ");
  });

  it("finds a selection that runs into the next paragraph where it started", () => {
    const root = mount(
      `<p data-para="1">alpha</p>\n<p data-para="2">beta</p>\n<p data-para="3">alpha</p>\n<p data-para="4">beta</p>`,
    );
    const [, , third] = root.querySelectorAll("p");
    const found = findOccurrenceRange(root, "alpha beta", third, 0);
    expect(third.contains(found!.startContainer)).toBe(true);
  });

  it("finds a repeated phrase that runs into the next paragraph, past an earlier copy in the first", () => {
    const root = mount(
      `<p data-para="1">We take it one step at a time. We still take it one step</p>\n<p data-para="2">at a time.</p>`,
    );
    const [first] = root.querySelectorAll("p");
    const text = "take it one step at a time.";
    const node = textNode(first);
    const second = node.data.lastIndexOf("take it");
    const before = document.createRange();
    before.selectNodeContents(first);
    before.setEnd(node, second);
    const occurrence = occurrencesBefore(rangeText(before), text);
    expect(occurrence).toBe(1);
    const found = findOccurrenceRange(root, text, first, occurrence);
    expect(found?.startOffset).toBe(second);
  });

  it("leaves the reader's own unfolded answer out of a selection's text", () => {
    const root = mount(
      `<p data-para="1">Before the <span data-marginalia-ui>An answer.</span>after.</p>`,
    );
    const range = document.createRange();
    range.selectNodeContents(root.querySelector("p")!);
    expect(rangeText(range)).toBe("Before the after.");
    expect(findTextRange(root, rangeText(range))).not.toBeNull();
  });
});
