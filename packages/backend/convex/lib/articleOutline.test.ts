import { describe, expect, it } from "vitest";
import {
  headingsWithOffsets,
  MAX_OUTLINE_CHARS,
  MAX_OUTLINE_HEADINGS,
  outlineAfterWindow,
} from "./articleOutline";
import { htmlToPlainText } from "./ingest";

const WINDOW = 1_000;

/** Stored articles hold both: the HTML, and the plain text htmlToPlainText makes of it. */
function article(html: string) {
  return { content: htmlToPlainText(html), contentHtml: html };
}

function paragraphs(count: number, words = 40) {
  return Array.from(
    { length: count },
    (_, i) =>
      `<p>${Array.from({ length: words }, (_, w) => `w${i}x${w}`).join(" ")}.</p>`,
  ).join("");
}

describe("headingsWithOffsets", () => {
  it("places each heading where it sits in the stored plain text", () => {
    const html = `<h2>Opening</h2><p>First words here.</p><h3>Detail</h3><p>More words.</p>`;
    const { content, contentHtml } = article(html);
    const headings = headingsWithOffsets(contentHtml, content);
    expect(headings?.map((h) => h.title)).toEqual(["Opening", "Detail"]);
    for (const heading of headings ?? [])
      expect(
        content.slice(heading.start, heading.start + heading.title.length),
      ).toBe(heading.title);
    expect(headings?.[0].words).toBe(3);
    expect(headings?.[1].words).toBe(2);
  });

  it("returns null when the HTML and the stored text disagree", () => {
    expect(
      headingsWithOffsets("<h2>Opening</h2><p>Text</p>", "Something else"),
    ).toBeNull();
  });

  it("reads h1 to h3 and skips h4 and deeper", () => {
    const html = "<h1>One</h1><p>a</p><h4>Four</h4><p>b</p><h3>Three</h3>";
    const { content, contentHtml } = article(html);
    expect(
      headingsWithOffsets(contentHtml, content)?.map((h) => h.title),
    ).toEqual(["One", "Three"]);
  });
});

describe("outlineAfterWindow", () => {
  it("lists the headings past the window, in order, with rough sizes", () => {
    const html = `${paragraphs(30)}<h2>Later one</h2>${paragraphs(5, 300)}<h2>Later two</h2>${paragraphs(2, 12)}`;
    const { content, contentHtml } = article(html);
    const outline = outlineAfterWindow({ content, contentHtml }, WINDOW);
    const lines = outline?.split("\n") ?? [];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- Later one \(about \d+0 words\)$/);
    expect(lines[0]).toContain("(about 1500 words)");
    expect(lines[1]).toBe("- Later two (about 20 words)");
  });

  it("returns null when no heading lies past the window", () => {
    const html = `<h2>Early</h2>${paragraphs(30)}`;
    const { content, contentHtml } = article(html);
    expect(outlineAfterWindow({ content, contentHtml }, WINDOW)).toBeNull();
  });

  it("returns null for an article that has no HTML to read headings from", () => {
    const { content } = article(`${paragraphs(30)}<h2>Late</h2><p>x</p>`);
    expect(outlineAfterWindow({ content }, WINDOW)).toBeNull();
    expect(outlineAfterWindow({ content, contentHtml: "" }, WINDOW)).toBeNull();
  });

  it("returns null for a short article, which fits the window whole", () => {
    const html = `<h2>Only</h2><p>${"word ".repeat(50)}</p><h2>Second</h2><p>end</p>`;
    const { content, contentHtml } = article(html);
    expect(content.length).toBeLessThan(WINDOW);
    expect(outlineAfterWindow({ content, contentHtml }, 120_000)).toBeNull();
  });

  it("stays within the heading and character bounds for a long piece", () => {
    const sections = Array.from(
      { length: 300 },
      (_, i) =>
        `<h3>Section ${i} ${"long title ".repeat(20)}</h3><p>${"body ".repeat(40)}</p>`,
    ).join("");
    const { content, contentHtml } = article(`${paragraphs(40)}${sections}`);
    const outline = outlineAfterWindow({ content, contentHtml }, WINDOW) ?? "";
    const lines = outline.split("\n");
    const listed = lines.filter((line) => line.startsWith("- "));
    expect(listed.length).toBeLessThanOrEqual(MAX_OUTLINE_HEADINGS);
    expect(outline.length).toBeLessThanOrEqual(MAX_OUTLINE_CHARS);
    expect(lines.at(-1)).toMatch(/^… and \d+ more headings not listed$/);
  });

  it("spreads the headings it lists across the whole remainder", () => {
    const sections = Array.from(
      { length: 200 },
      (_, i) => `<h2>Part ${i}</h2><p>${"x ".repeat(20)}</p>`,
    ).join("");
    const { content, contentHtml } = article(`${paragraphs(40)}${sections}`);
    const listed = (outlineAfterWindow({ content, contentHtml }, WINDOW) ?? "")
      .split("\n")
      .filter((line) => line.startsWith("- "));
    expect(listed.at(-1)).toContain("Part 1");
    expect(listed.some((line) => /Part 1\d\d /.test(line))).toBe(true);
  });
});
