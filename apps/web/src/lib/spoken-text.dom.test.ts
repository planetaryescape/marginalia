// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  LEAD_CHARS,
  MAX_CLIP_CHARS,
  splitLeading,
  splitSpoken,
  spokenBlock,
  spokenTitle,
} from "./spoken-text";

function block(html: string, tag = "p"): HTMLElement {
  document.body.innerHTML = `<${tag}>${html}</${tag}>`;
  return document.body.firstElementChild as HTMLElement;
}
const text = (html: string, tag = "p") => spokenBlock(block(html, tag))?.text;

describe("spokenBlock", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("drops footnote markers but keeps a superscript that is a word or an exponent", () => {
    expect(
      text("The claim<sup>1</sup> was disputed.[12] Later<sup>†</sup>."),
    ).toBe("The claim was disputed. Later.");
    expect(text("10<sup>th</sup> century")).toBe("10th century");
  });

  it("drops the marker of an annotation but not the words around it", () => {
    expect(
      text('a <span class="annotation-mark">note<sup>3</sup></span> here'),
    ).toBe("a note here");
  });

  it("says a bare URL as a link to its domain, keeping the sentence's punctuation", () => {
    expect(
      text("See https://www.example.com/a/b?c=1, or www.example.org."),
    ).toBe("See a link to example.com, or a link to example.org.");
  });

  it("leaves text that only looks like a URL alone", () => {
    expect(text("Visit example dot com")).toBe("Visit example dot com");
  });

  it("ends a heading with a full stop unless it already has closing punctuation", () => {
    expect(spokenBlock(block("Background", "h2"))).toEqual({
      text: "Background.",
      heading: true,
    });
    expect(text("Why now?", "h3")).toBe("Why now?");
    expect(text("“Quoted.”", "h3")).toBe("“Quoted.”");
    expect(spokenBlock(block("Plain paragraph"))?.heading).toBe(false);
  });

  it("skips pre, code-only blocks, tables and blocks that are empty once cleaned", () => {
    expect(spokenBlock(block("const a = 1;", "pre"))).toBeNull();
    expect(spokenBlock(block("<code>npm i</code>"))).toBeNull();
    expect(spokenBlock(block("npm i", "code"))).toBeNull();
    expect(spokenBlock(block("<sup>1</sup>[2]"))).toBeNull();
    document.body.innerHTML =
      "<table><tr><td><p>in a cell</p></td></tr></table>";
    expect(spokenBlock(document.querySelector("p") as HTMLElement)).toBeNull();
    document.body.innerHTML = "<pre><code>x</code></pre>";
    expect(
      spokenBlock(document.querySelector("code") as HTMLElement),
    ).toBeNull();
  });

  it("keeps prose that mentions code inline", () => {
    expect(text("Call <code>fetch</code> first.")).toBe("Call fetch first.");
  });

  it("collapses whitespace", () => {
    expect(text("one\n\n   two\t three")).toBe("one two three");
  });
});

const sentence = (n: number) => `Sentence number ${n} says something plain. `;
const longProse = (sentences: number) =>
  Array.from({ length: sentences }, (_v, i) => sentence(i))
    .join("")
    .trim();

describe("spokenTitle", () => {
  it("says the title and author, or just the title", () => {
    expect(spokenTitle("A Plain Title", "Ann Author")).toBe(
      "A Plain Title. By Ann Author.",
    );
    expect(spokenTitle("A Plain Title")).toBe("A Plain Title.");
    expect(spokenTitle("Why now?", " Ann ")).toBe("Why now? By Ann.");
    expect(spokenTitle("  Spaced \n title ", "")).toBe("Spaced title.");
    expect(spokenTitle("", "Ann")).toBe("By Ann.");
    expect(spokenTitle("", null)).toBe("");
  });
});

describe("splitSpoken", () => {
  it("leaves a short text as one part", () => {
    expect(splitSpoken("Short one.", "en")).toEqual(["Short one."]);
  });

  it("splits a 5,000-character paragraph at sentence ends into parts of at most 2,000", () => {
    const paragraph = longProse(125);
    expect(paragraph.length).toBeGreaterThan(5000);
    const parts = splitSpoken(paragraph, "en");
    expect(parts.length).toBeGreaterThanOrEqual(3);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(MAX_CLIP_CHARS);
      expect(part).toMatch(/\.$/);
    }
    expect(parts.join(" ")).toBe(paragraph);
  });

  it("splits a single 2,500-character sentence at a comma or space before the limit", () => {
    const words = Array.from({ length: 400 }, (_v, i) => `word${i},`).join(" ");
    const one = `${words.slice(0, 2499)}.`;
    expect(one.length).toBe(2500);
    const parts = splitSpoken(one, "en");
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(2000);
    expect(parts[0].endsWith(",")).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(one.replace(/\s+/g, " "));
  });

  it("hard-cuts a 2,500-character run with no space or comma", () => {
    const parts = splitSpoken("a".repeat(2500), "en");
    expect(parts.map((p) => p.length)).toEqual([2000, 500]);
  });

  it("measures parts in UTF-16 units like the backend, so emoji-heavy text never goes over 2,000", () => {
    const check = (input: string) => {
      const parts = [...splitSpoken(input, "en"), ...splitLeading(input, "en")];
      for (const part of parts) {
        expect(part.length).toBeLessThanOrEqual(MAX_CLIP_CHARS);
        // No lone surrogate: the part survives a UTF-8 round trip unchanged
        expect(new TextDecoder().decode(new TextEncoder().encode(part))).toBe(
          part,
        );
      }
      return splitSpoken(input, "en");
    };
    // Spaced emoji sentences: 3 units each plus the space
    const sentences = Array.from(
      { length: 700 },
      () => "😀😀😀 great 🎉. ",
    ).join("");
    expect(sentences.length).toBeGreaterThan(5000);
    expect(check(sentences).length).toBeGreaterThanOrEqual(3);
    // One unbroken run of 1,500 emoji is 3,000 units and has no space to break at
    const run = "😀".repeat(1500);
    expect(check(run).map((p) => p.length)).toEqual([2000, 1000]);
    // An odd boundary: a pair straddles unit 2,000
    expect(check(`a${"😀".repeat(1500)}`).map((p) => p.length)).toEqual([
      1999, 1002,
    ]);
  });

  it("falls back to English sentences for a language tag it doesn't know", () => {
    expect(() => splitSpoken(longProse(120), "not a tag")).not.toThrow();
  });
});

describe("splitLeading", () => {
  it("keeps a block that fits in the lead as one item", () => {
    expect(splitLeading(longProse(3), "en")).toHaveLength(1);
  });

  it("makes the first part the leading sentences up to 300 characters, and packs the rest normally", () => {
    const paragraph = longProse(120);
    const [first, ...rest] = splitLeading(paragraph, "en");
    expect(first.length).toBeLessThanOrEqual(LEAD_CHARS);
    expect(first.length).toBeGreaterThan(200);
    expect(first).toMatch(/\.$/);
    expect(rest.length).toBeGreaterThanOrEqual(2);
    for (const part of rest) expect(part.length).toBeLessThanOrEqual(2000);
    expect([first, ...rest].join(" ")).toBe(paragraph);
  });

  it("takes at least one sentence even when it is longer than the lead", () => {
    const long = `${"A long opening sentence runs on ".repeat(20).trim()}. Then a short one.`;
    const [first, second] = splitLeading(long, "en");
    expect(first.length).toBeGreaterThan(LEAD_CHARS);
    expect(first).toMatch(/runs on\.$/);
    expect(second).toBe("Then a short one.");
  });
});
