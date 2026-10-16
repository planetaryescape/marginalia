import { describe, expect, it } from "vitest";
import {
  enforceByteBound,
  groupSections,
  MAX_UNIT_BYTES,
  type OutlineEntry,
  readingUnitsOf,
  type Section,
  sectionDocument,
  sectionsFromHeadings,
  sectionsFromOutline,
  sectionsInEvenParts,
  splitHugeParagraphs,
  splitText,
  storedBytes,
  toReadingUnits,
} from "./sections";
import type { Block } from "./structure";

/** A paragraph of about `tokens` tokens (four characters each). */
const para = (tokens: number, page = 1, tag = "w"): Block => ({
  kind: "p",
  text: `${tag} `.repeat(Math.ceil((tokens * 4) / (tag.length + 1))).trim(),
  page,
});
const head = (text: string, page = 1, kind: Block["kind"] = "h1"): Block => ({
  kind,
  text,
  page,
});
const tokens = (s: Section) =>
  s.blocks.reduce((n, b) => n + Math.ceil(b.text.length / 4), 0);

describe("sectionsFromOutline", () => {
  const blocks = [
    head("Cover", 1),
    para(400, 1),
    head("1 Why systems surprise us", 3),
    para(900, 3),
    head("1.1 The zoo", 4, "h2"),
    para(900, 4),
    head("2 Leverage", 6),
    para(900, 6),
  ];
  const outline: OutlineEntry[] = [
    { title: "1 Why systems surprise us", depth: 0, page: 3 },
    { title: "1.1 The zoo", depth: 1, page: 4 },
    { title: "2 Leverage", depth: 0, page: 6 },
    { title: "Deep detail", depth: 2, page: 6 },
  ];

  it("cuts at each depth 0 and 1 entry and ignores deeper ones", () => {
    const sections = sectionsFromOutline(blocks, outline);
    expect(sections.map((s) => s.title)).toEqual([
      "Opening",
      "1 Why systems surprise us",
      "1.1 The zoo",
      "2 Leverage",
    ]);
  });

  it("remembers the chapter each section belongs to", () => {
    const sections = sectionsFromOutline(blocks, outline);
    expect(sections.map((s) => s.chapter)).toEqual([
      undefined,
      "1 Why systems surprise us",
      "1 Why systems surprise us",
      "2 Leverage",
    ]);
  });

  it("starts at the heading on the page, not at the page's first block", () => {
    const pageBlocks = [para(50, 5, "tail"), head("Zoo", 5), para(50, 5)];
    const sections = sectionsFromOutline(pageBlocks, [
      { title: "Zoo", depth: 0, page: 5 },
    ]);
    expect(sections[0].blocks[0].text).toBe("Zoo");
  });

  it("drops an entry that points before the previous one", () => {
    const sections = sectionsFromOutline(blocks, [
      { title: "2 Leverage", depth: 0, page: 6 },
      { title: "1.1 The zoo", depth: 1, page: 4 },
    ]);
    expect(sections.map((s) => s.title)).toContain("2 Leverage");
    expect(sections.map((s) => s.title)).not.toContain("1.1 The zoo");
  });

  it("keeps small front matter out", () => {
    const sections = sectionsFromOutline(
      [head("Cover", 1), para(20, 1), ...blocks.slice(2)],
      outline,
    );
    expect(sections[0].title).toBe("1 Why systems surprise us");
  });
});

describe("sectionsFromHeadings", () => {
  it("merges runs under 300 tokens into the next heading", () => {
    const sections = sectionsFromHeadings([
      head("Intro"),
      para(100),
      head("Method", 2, "h2"),
      para(900),
      head("Result", 3, "h2"),
      para(900),
    ]);
    expect(sections.map((s) => s.title)).toEqual(["Intro", "Result"]);
    expect(sections[0].blocks.map((b) => b.text)).toContain("Method");
  });
});

describe("sectionsInEvenParts", () => {
  it("cuts at paragraph boundaries into parts of about 1,000 tokens", () => {
    const parts = sectionsInEvenParts(
      Array.from({ length: 10 }, () => para(400)),
    );
    expect(parts.map((p) => p.title)).toEqual([
      "Part 1",
      "Part 2",
      "Part 3",
      "Part 4",
      "Part 5",
    ]);
    for (const part of parts)
      expect(part.blocks.every((b) => b.kind === "p")).toBe(true);
  });
});

describe("sectionDocument", () => {
  it("prefers the outline, then headings, then even parts", () => {
    const withHeadings = [
      head("A"),
      para(400),
      head("B"),
      para(400),
      head("C"),
      para(400),
    ];
    expect(
      sectionDocument(withHeadings, [
        { title: "A", depth: 0, page: 1 },
        { title: "B", depth: 0, page: 1 },
      ]).basis,
    ).toBe("outline");
    expect(sectionDocument(withHeadings, []).basis).toBe("headings");
    expect(
      sectionDocument(
        Array.from({ length: 6 }, () => para(400)),
        [],
      ).basis,
    ).toBe("even");
  });

  it("falls back from an outline that resolved to a single entry", () => {
    const blocks = [para(400), para(400), para(400), para(400)];
    expect(
      sectionDocument(blocks, [{ title: "Only", depth: 0, page: 1 }]).basis,
    ).not.toBe("outline");
  });
});

describe("groupSections", () => {
  const section = (title: string, size: number, chapter?: string): Section => ({
    title,
    chapter,
    blocks: [para(size)],
  });

  it("groups small sections of a chapter up to the 1,500 token minimum", () => {
    const units = groupSections([
      section("a", 600, "C1"),
      section("b", 600, "C1"),
      section("c", 600, "C1"),
      section("d", 2000, "C1"),
    ]);
    expect(units.map((u) => u.title)).toEqual(["a", "d"]);
    expect(tokens(units[0])).toBeGreaterThanOrEqual(1500);
  });

  it("never crosses a chapter", () => {
    const units = groupSections([
      section("a", 1000, "C1"),
      section("b", 1000, "C2"),
    ]);
    // each is too small to stand alone, and each is all that is left of its chapter
    expect(units.map((u) => u.chapter)).toEqual(["C1", "C2"]);
  });

  it("does not exceed 4,000 tokens by grouping", () => {
    const units = groupSections([
      section("a", 1400, "C"),
      section("b", 1400, "C"),
      section("c", 1400, "C"),
    ]);
    for (const unit of units) expect(tokens(unit)).toBeLessThanOrEqual(4000);
  });

  it("joins a short remainder at the end of a chapter to the unit before it", () => {
    const units = groupSections([
      section("a", 3500, "C"),
      section("b", 300, "C"),
    ]);
    expect(units).toHaveLength(1);
    expect(tokens(units[0])).toBeGreaterThan(3500);
  });

  it("splits a section over 6,000 tokens at paragraph boundaries", () => {
    const big: Section = {
      title: "Git as a Client",
      chapter: "C",
      blocks: Array.from({ length: 20 }, () => para(500)),
    };
    const units = groupSections([big]);
    expect(units.length).toBeGreaterThanOrEqual(3);
    expect(units[0].title).toBe(`Git as a Client (part 1 of ${units.length})`);
    for (const unit of units) expect(tokens(unit)).toBeLessThanOrEqual(4000);
    // no paragraph lost or cut
    expect(units.flatMap((u) => u.blocks)).toHaveLength(20);
  });
});

describe("stored size", () => {
  it("keeps every part of a long section, with no ceiling on how many", () => {
    const big: Section = {
      title: "Long",
      chapter: "C",
      blocks: Array.from({ length: 300 }, () => para(500)),
    };
    const units = groupSections([big]);
    expect(units.flatMap((u) => u.blocks)).toHaveLength(300);
    for (const unit of units) expect(tokens(unit)).toBeLessThanOrEqual(4000);
  });

  it("bounds the bytes of every unit, even one that grouping left large", () => {
    const blocks = Array.from({ length: 300 }, () => para(500));
    const huge: Section = { title: "One", blocks };
    expect(storedBytes(blocks)).toBeGreaterThan(MAX_UNIT_BYTES);
    const units = enforceByteBound([huge]);
    expect(units.length).toBeGreaterThan(1);
    for (const unit of units)
      expect(storedBytes(unit.blocks)).toBeLessThanOrEqual(MAX_UNIT_BYTES);
    expect(units.flatMap((u) => u.blocks)).toHaveLength(300);
  });

  it("leaves a unit under the bound alone", () => {
    const one: Section = { title: "Small", blocks: [para(100)] };
    expect(enforceByteBound([one])).toEqual([one]);
  });

  it("reading units of a 300-paragraph section each fit a row", () => {
    const blocks = [
      head("Only"),
      ...Array.from({ length: 300 }, () => para(500)),
    ];
    const { units } = readingUnitsOf(blocks, []);
    for (const u of units)
      expect(u.content.length + u.contentHtml.length).toBeLessThan(
        MAX_UNIT_BYTES,
      );
  });
});

describe("splitHugeParagraphs", () => {
  it("cuts a paragraph over the limit at sentence ends", () => {
    const sentence = "This is one sentence of a very long paragraph. ";
    const result = splitHugeParagraphs([
      { kind: "p", text: sentence.repeat(400), page: 1 },
    ]);
    expect(result.length).toBeGreaterThan(1);
    for (const piece of result) {
      expect(piece.text.length).toBeLessThanOrEqual(8000);
      expect(piece.text.endsWith(".")).toBe(true);
    }
  });

  it("cuts text with no stops hard", () => {
    const [a, b] = splitHugeParagraphs([
      { kind: "p", text: "x".repeat(9000), page: 1 },
    ]);
    expect(a.text).toHaveLength(8000);
    expect(b.text).toHaveLength(1000);
  });
});

describe("toReadingUnits", () => {
  it("counts minutes as ceil(words / 220)", () => {
    const words = (n: number) =>
      Array.from({ length: n }, () => "word").join(" ");
    const [unit] = toReadingUnits([
      {
        title: "T",
        blocks: [head("T"), { kind: "p", text: words(441), page: 1 }],
      },
    ]);
    expect(unit.wordCount).toBe(442);
    expect(unit.estimatedReadMinutes).toBe(3);
  });

  it("gives a unit that opens on a paragraph its title as a heading", () => {
    const [unit] = toReadingUnits([{ title: "Part 2", blocks: [para(10)] }]);
    expect(unit.contentHtml.startsWith("<h2>Part 2</h2>")).toBe(true);
  });
});

describe("readingUnitsOf", () => {
  it("turns a book with an outline into units of reading size", () => {
    const chapters = Array.from({ length: 6 }, (_, i) => [
      head(`Chapter ${i + 1}`, i * 3 + 1),
      ...Array.from({ length: 6 }, () => para(500, i * 3 + 2)),
    ]).flat();
    const outline = Array.from({ length: 6 }, (_, i) => ({
      title: `Chapter ${i + 1}`,
      depth: 0,
      page: i * 3 + 1,
    }));
    const { units, basis } = readingUnitsOf(chapters, outline);
    expect(basis).toBe("outline");
    expect(units.length).toBeGreaterThanOrEqual(6);
    expect(units[0].title).toBe("Chapter 1");
    for (const unit of units)
      expect(unit.estimatedReadMinutes).toBeGreaterThan(0);
  });
});

describe("a block of any kind", () => {
  it("is cut to fit a unit, as a last resort at sentences and then words", () => {
    const sentence = "A heading that was really a long run of lines. ";
    const big: Block = { kind: "h2", text: sentence.repeat(26_000), page: 1 };
    expect(big.text.length).toBeGreaterThan(1_200_000);
    const { units } = readingUnitsOf([big], []);
    expect(units.length).toBeGreaterThan(1);
    for (const u of units)
      expect(u.content.length + u.contentHtml.length).toBeLessThan(
        MAX_UNIT_BYTES,
      );
    // nothing is lost but spacing
    const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
    expect(
      units.reduce((n, u) => n + words(u.content), 0),
    ).toBeGreaterThanOrEqual(words(big.text));
  });

  it("is cut at words when it has no sentence ends", () => {
    const pieces = splitText("word ".repeat(5000), 8000);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(8000);
      expect(p.endsWith("word")).toBe(true);
    }
  });
});
