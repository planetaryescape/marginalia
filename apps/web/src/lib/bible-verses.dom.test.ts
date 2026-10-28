// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { displayedVerses, verseAtOrAfter } from "./bible-verses";

function body(html: string) {
  document.body.innerHTML = `<article><div data-article-body>${html}</div></article>`;
  return document.querySelector<HTMLElement>("[data-article-body]")!;
}
afterEach(() => {
  document.body.innerHTML = "";
});

// A verse that continues into a second block, a heading, and footnotes.
const MARKERS =
  '<h3 class="s">The shepherd</h3>' +
  '<div class="q1"><span class="yv-v" v="3"></span><span class="yv-vlbl">3</span><span>He restores my soul.</span></div>' +
  '<div class="q1"><span class="yv-v" v="4"></span><span class="yv-vlbl">4</span><span>Even though I walk </span></div>' +
  '<div class="q2"><span>through the valley</span><span class="yv-n">a footnote</span></div>' +
  '<div class="q1"><span class="yv-v" v="5"></span><span class="yv-vlbl">5</span><span>You prepare</span><span class="yv-n">b</span><span> a table.</span></div>';

describe("displayedVerses", () => {
  it("finds verses from empty markers across blocks, in reading order", () => {
    const verses = displayedVerses("Psalms 23", body(MARKERS));
    expect(verses.map((v) => v.label)).toEqual([
      "Psalms 23:3",
      "Psalms 23:4",
      "Psalms 23:5",
    ]);
  });

  it("covers both blocks and leaves out the number, the heading and a trailing footnote", () => {
    const [, four] = displayedVerses("Psalms 23", body(MARKERS));
    expect(four.range.toString()).toBe("Even though I walk through the valley");
    expect(four.range.startContainer).not.toBe(four.range.endContainer);
    expect(four.segments.map((s) => s.toString())).toEqual([
      "Even though I walk",
      "through the valley",
    ]);
  });

  it("never paints a footnote inside the verse, though the contiguous range spans it", () => {
    const [, , five] = displayedVerses("Psalms 23", body(MARKERS));
    expect(five.segments.map((s) => s.toString())).toEqual([
      "You prepare",
      "a table.",
    ]);
    // One range, because saved marks anchor to the displayed text including the note.
    expect(five.range.toString()).toBe("You prepareb a table.");
  });

  it("reads data-usfm spans and verse paragraphs, skipping their numbers", () => {
    const usfm = displayedVerses(
      "Psalms 23",
      body(
        '<p><span data-usfm="PSA.23.1"><span class="yv-vlbl">1</span>One.</span> <span data-usfm="PSA.23.2">Two </span></p><p><span data-usfm="PSA.23.2">continued.</span></p>',
      ),
    );
    expect(usfm.map((v) => [v.label, v.range.toString()])).toEqual([
      ["Psalms 23:1", "One."],
      ["Psalms 23:2", "Two continued."],
    ]);
    const plain = displayedVerses(
      "Psalms 23",
      body(
        '<p id="PSA.23.1"><sup>23:1</sup> The LORD is my shepherd.</p><p id="PSA.23.2"><sup>23:2</sup> He makes me lie down.</p>',
      ),
    );
    expect(plain.map((v) => v.range.toString())).toEqual([
      "The LORD is my shepherd.",
      "He makes me lie down.",
    ]);
  });

  it("returns nothing for text without verse identity or a reference it cannot parse", () => {
    expect(displayedVerses("Psalms 23", body("<p>Just prose.</p>"))).toEqual(
      [],
    );
    expect(displayedVerses("Not a book", body(MARKERS))).toEqual([]);
  });

  it("starts from the first verse at or after a block", () => {
    const root = body(MARKERS);
    const verses = displayedVerses("Psalms 23", root);
    const blocks = root.querySelectorAll("div");
    expect(verseAtOrAfter(verses, blocks[0])).toBe(0);
    expect(verseAtOrAfter(verses, blocks[2])).toBe(1);
    expect(verseAtOrAfter(verses, blocks[3])).toBe(2);
    expect(verseAtOrAfter(verses, null)).toBe(0);
  });
});
