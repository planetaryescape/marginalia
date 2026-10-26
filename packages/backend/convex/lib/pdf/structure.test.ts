import { describe, expect, it } from "vitest";
import {
  type Block,
  blocksToHtml,
  buildBlocks,
  joinLines,
  looksScanned,
  MAX_HEADING_CHARS,
  type PdfPage,
  type PdfTextItem,
  pageToLines,
} from "./structure";

const PAGE_H = 800;

function item(
  str: string,
  x: number,
  y: number,
  { size = 11, font = "body", rotated = false } = {},
): PdfTextItem {
  return {
    str,
    // a b c d x y: a rotated run has its weight in b and c
    transform: rotated ? [0, size, -size, 0, x, y] : [size, 0, 0, size, x, y],
    width: str.length * size * 0.5,
    height: size,
    fontName: font,
  };
}

/** Lines of one page, 14 points apart from the top, starting at x = 72. */
function page(
  number: number,
  rows: (string | [string, object])[],
): PdfPage & { items: PdfTextItem[] } {
  const items: PdfTextItem[] = [];
  let y = PAGE_H - 100;
  for (const row of rows) {
    const [text, opts] = typeof row === "string" ? [row, {}] : row;
    const o = opts as {
      size?: number;
      font?: string;
      gap?: number;
      x?: number;
    };
    y -= o.gap ?? 14;
    items.push(item(text, o.x ?? 72, y, o));
  }
  return { number, width: 600, height: PAGE_H, items };
}

const linesOf = (pages: PdfPage[]) => pages.flatMap(pageToLines);
const blocks = (pages: PdfPage[]) => buildBlocks(linesOf(pages), pages.length);
const kinds = (b: Block[]) => b.map((x) => x.kind);

describe("pageToLines", () => {
  it("joins runs on one baseline and spaces them by their gap", () => {
    const lines = pageToLines({
      number: 1,
      width: 600,
      height: PAGE_H,
      items: [item("Hello", 72, 700), item("world", 72 + 5 * 5.5 + 6, 700)],
    });
    expect(lines.map((l) => l.text)).toEqual(["Hello world"]);
  });

  it("skips rotated margin text", () => {
    const lines = pageToLines({
      number: 1,
      width: 600,
      height: PAGE_H,
      items: [
        item("arXiv:1706.03762v7", 20, 400, { rotated: true }),
        item("Body", 72, 700),
      ],
    });
    expect(lines.map((l) => l.text)).toEqual(["Body"]);
  });

  it("strips private-use icon glyphs and drops lines left empty", () => {
    const lines = pageToLines({
      number: 1,
      width: 600,
      height: PAGE_H,
      items: [item("", 72, 700), item("Note this", 72, 680)],
    });
    expect(lines.map((l) => l.text)).toEqual(["Note this"]);
  });

  it("keeps italic text, whose shear is small beside its size", () => {
    const italic: PdfTextItem = {
      ...item("slanted", 72, 700),
      transform: [11, 0, 2.2, 11, 72, 700],
    };
    expect(
      pageToLines({ number: 1, width: 600, height: PAGE_H, items: [italic] }),
    ).toHaveLength(1);
  });
});

describe("buildBlocks", () => {
  const body = (n: number) =>
    `Sentence number ${n} runs on for a good while here.`;

  it("finds a larger heading and splits paragraphs on a gap", () => {
    const result = blocks([
      page(1, [
        ["A Larger Title", { size: 20, gap: 20 }],
        body(1),
        body(2),
        [body(3), { gap: 30 }],
        body(4),
      ]),
    ]);
    expect(kinds(result)).toEqual(["h1", "p", "p"]);
    expect(result[1].text).toBe(`${body(1)} ${body(2)}`);
  });

  it("starts a paragraph at an indent after a full stop", () => {
    const result = blocks([
      page(1, [
        body(1),
        [`${body(2)}.`, {}],
        ["Indented start of the next paragraph.", { x: 90 }],
        body(4),
      ]),
    ]);
    expect(result.filter((b) => b.kind === "p")).toHaveLength(2);
  });

  it("finds a numbered heading in a font other than the body's", () => {
    const result = blocks([
      page(1, [
        ...Array.from({ length: 10 }, (_, i) => body(i)),
        ["3.2 Scaled Attention", { font: "bold", gap: 24 }],
        ...Array.from({ length: 4 }, (_, i) => body(i)),
      ]),
    ]);
    expect(
      result.some((b) => b.kind !== "p" && b.text === "3.2 Scaled Attention"),
    ).toBe(true);
  });

  it("joins a word hyphenated across lines", () => {
    const result = blocks([
      page(1, ["The reader is trans-", "ported at once to the page."]),
    ]);
    expect(result[0].text).toBe(
      "The reader is transported at once to the page.",
    );
  });

  it("carries a paragraph over a page break only when its sentence is unfinished", () => {
    const open = blocks([
      page(1, ["A sentence that carries on across"]),
      page(2, ["the page break and ends here."]),
    ]);
    expect(open.map((b) => b.text)).toEqual([
      "A sentence that carries on across the page break and ends here.",
    ]);
    const closed = blocks([
      page(1, ["A sentence that ends at the foot of the page."]),
      page(2, ["A new one starts at the top of the next."]),
    ]);
    expect(closed).toHaveLength(2);
    expect(closed[1].page).toBe(2);
  });

  it("keeps the hyphens of a compound broken across lines", () => {
    const result = blocks([
      page(1, [
        "An English-",
        "to-German dictionary, and the Anglo-",
        "American way.",
      ]),
    ]);
    expect(result[0].text).toBe(
      "An English-to-German dictionary, and the Anglo-American way.",
    );
  });

  it("joins a word hyphenated only by the line break", () => {
    expect(blocks([page(1, ["the con-", "nection holds"])])[0].text).toBe(
      "the connection holds",
    );
    expect(joinLines("the con-", "nection")).toBe("the connection");
    expect(joinLines("English-", "to-German")).toBe("English-to-German");
    expect(joinLines("Anglo-", "american")).toBe("Anglo-american");
    expect(joinLines("well-", "Known")).toBe("well-Known");
    expect(joinLines("plain text", "more")).toBe("plain text more");
  });

  it("drops running headers, footers and page numbers", () => {
    const pages = Array.from({ length: 6 }, (_, i) => {
      const p = page(i + 1, [body(i), body(i + 10)]);
      p.items.push(
        item("Thinking in Systems", 72, PAGE_H - 20),
        item(String(i + 40), 300, 20),
      );
      return p;
    });
    const text = blocks(pages)
      .map((b) => b.text)
      .join(" ");
    expect(text).not.toContain("Thinking in Systems");
    expect(text).not.toMatch(/\b4[0-5]\b/);
    expect(text).toContain("Sentence number 0");
  });

  it("does not take a lone letter at the page edge for a page number", () => {
    const pages = Array.from({ length: 4 }, (_, i) => {
      const p = page(i + 1, [body(i), body(i + 10)]);
      p.items.push(item("c", 300, 20));
      return p;
    });
    expect(
      blocks(pages)
        .map((b) => b.text)
        .join(" "),
    ).toContain("c");
  });

  it("does not merge a run of heading-sized lines into one huge heading", () => {
    const heads: [string, object][] = Array.from({ length: 60 }, (_, i) => [
      `Heading sized line number ${i} that is quite long`,
      { size: 20, gap: 10 },
    ]);
    // Plenty of body text, so 11 points is the body size and 20 is a heading
    const bodyPages = Array.from({ length: 6 }, (_, p) =>
      page(
        p + 2,
        Array.from(
          { length: 40 },
          (_, i) => `Body ${p} ${i} reads on and on for a while here`,
        ),
      ),
    );
    const result = blocks([page(1, heads), ...bodyPages]);
    const headings = result.filter((b) => b.kind !== "p");
    expect(headings.length).toBeGreaterThan(5);
    for (const b of headings)
      expect(b.text.length).toBeLessThanOrEqual(MAX_HEADING_CHARS + 120);
  });

  it("filters dot-leader table of contents lines", () => {
    const result = blocks([
      page(1, [
        "Chapter One ........ 12",
        "Chapter Two . . . . . . 40",
        body(1),
      ]),
    ]);
    expect(result.map((b) => b.text).join(" ")).not.toContain("....");
    expect(result.map((b) => b.text).join(" ")).not.toContain(". . . .");
  });

  it("returns nothing for no text", () => {
    expect(buildBlocks([], 3)).toEqual([]);
  });
});

describe("blocksToHtml", () => {
  it("escapes markup in the text", () => {
    expect(
      blocksToHtml([
        { kind: "h2", text: "A <b> & C", page: 1 },
        { kind: "p", text: "x < y", page: 1 },
      ]),
    ).toBe("<h2>A &lt;b&gt; &amp; C</h2>\n<p>x &lt; y</p>");
  });
});

describe("looksScanned", () => {
  it("refuses a PDF with no text layer", () => {
    expect(looksScanned([0, 0, 0, 0])).toBe(true);
  });
  it("refuses a low average even when one page has text", () => {
    expect(looksScanned([300, 0, 0, 0, 0, 0, 0, 0])).toBe(true);
  });
  it("refuses a document where most pages are nearly empty", () => {
    expect(looksScanned([5, 5, 5, 5, 5, 4000])).toBe(true);
  });
  it("accepts an ordinary text document", () => {
    expect(looksScanned([2500, 2600, 2400])).toBe(false);
  });
  it("accepts a short document with a sparse cover page", () => {
    expect(looksScanned([10, 2500, 2600, 2400])).toBe(false);
  });
  it("treats no pages as scanned", () => {
    expect(looksScanned([])).toBe(true);
  });
});
