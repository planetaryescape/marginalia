import { strToU8, type Zippable, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { EPUB_LIMITS, openEpubArchive } from "./archive";
import { parseEpubSpineItem } from "./structure";
import { epubUnits } from "./units";

function spine(body: string) {
  const result = parseEpubSpineItem(
    strToU8(`<html><body>${body}</body></html>`),
    "chapter.xhtml",
    0,
  );
  if (!result.ok) throw new Error(`Fixture refused: ${result.reason}`);
  return result.value;
}

function archive(files: ReadonlyMap<string, Uint8Array>) {
  const entries: Zippable = {};
  for (const [path, bytes] of files)
    Object.defineProperty(entries, path, {
      value: [bytes, { level: path === "mimetype" ? 0 : 6 }],
      enumerable: true,
    });
  return zipSync(entries);
}

function files() {
  return new Map([
    ["mimetype", strToU8("application/epub+zip")],
    ["META-INF/container.xml", strToU8("<container/>")],
  ]);
}

describe("PR105 parser review regressions", () => {
  it("retains an empty list-containing blockquote anchor and resolves its link", () => {
    const item = spine(
      '<p><a href="#empty">Jump</a></p><blockquote id="empty"><ul hidden="hidden"><li>Hidden</li></ul></blockquote><p>Destination.</p>',
    );
    expect(item.blocks[1]).toEqual({
      html: '<span id="epub-0-empty"></span>',
      text: "",
      start: 6,
      end: 6,
    });
    const units = epubUnits([item]);
    expect(units.ok).toBe(true);
    if (!units.ok) throw new Error("Fixture units refused");
    expect(units.value[0]?.contentHtml).toContain(
      'href="?unit=0#epub-0-empty"',
    );
    expect(
      units.value[0]?.contentHtml.match(/id="epub-0-empty"/gu),
    ).toHaveLength(1);
    for (const block of item.blocks)
      expect(item.text.slice(block.start, block.end)).toBe(block.text);
  });

  it("splits many short list items at the exact word boundary", () => {
    const item = spine(`<ol>${"<li>é</li>\n".repeat(8001)}</ol>`);
    expect(item.blocks.map((block) => block.text.split(/\s+/u).length)).toEqual(
      [4000, 4000, 1],
    );
    expect(item.blocks[1]?.html).toMatch(/^<ol start="4001">/u);
    expect(item.blocks[2]?.html).toMatch(/^<ol start="8001">/u);
    for (const block of item.blocks) {
      expect(item.text.slice(block.start, block.end)).toBe(block.text);
      expect(
        new TextEncoder().encode(block.html + block.text).length,
      ).toBeLessThanOrEqual(EPUB_LIMITS.unitBytes);
    }
  });

  it.each([
    false,
    true,
  ])("counts multibyte list bytes and whitespace precisely, preformatted=%s", (preformatted) => {
    const content = preformatted
      ? `<pre>  ${"é".repeat(1000)}\n </pre>`
      : "é".repeat(1000);
    const item = spine(`<ul>${`<li>${content}</li>\n`.repeat(150)}</ul>`);
    expect(item.blocks).toHaveLength(2);
    const first = item.blocks[0];
    const second = item.blocks[1];
    if (!first || !second) throw new Error("Missing list chunks");
    expect(first.html.match(/<li>/gu)).toHaveLength(99);
    expect(second.html.match(/<li>/gu)).toHaveLength(51);
    for (const block of item.blocks) {
      expect(item.text.slice(block.start, block.end)).toBe(block.text);
      expect(
        new TextEncoder().encode(block.html + block.text).length,
      ).toBeLessThanOrEqual(EPUB_LIMITS.unitBytes);
    }
  });

  it.each([
    "entry",
    "expanded",
    "count-first",
    "entry-at-count",
  ])("uses identical ZIP and Map limit precedence for %s", (scenario) => {
    const entries = files();
    const full = new Uint8Array(EPUB_LIMITS.entryBytes);
    const oversized = new Uint8Array(EPUB_LIMITS.entryBytes + 1);
    if (scenario === "entry") entries.set("large", oversized);
    if (scenario === "expanded")
      for (let index = 0; index < 9; index++)
        entries.set(`large-${index}`, full);
    while (entries.size < EPUB_LIMITS.files + 1)
      entries.set(`entry-${entries.size}`, new Uint8Array());
    if (scenario === "entry-at-count")
      entries.set(`entry-${EPUB_LIMITS.files}`, oversized);
    if (scenario === "count-first") entries.set("large", oversized);
    const expected = {
      code:
        scenario === "entry" || scenario === "entry-at-count"
          ? "entry_bytes"
          : scenario === "expanded"
            ? "expanded_bytes"
            : "archive_entries",
      stage: "archive",
      observed:
        scenario === "entry" || scenario === "entry-at-count"
          ? EPUB_LIMITS.entryBytes + 1
          : scenario === "expanded"
            ? EPUB_LIMITS.entryBytes * 8 + 32
            : EPUB_LIMITS.files + 1,
      limit:
        scenario === "entry" || scenario === "entry-at-count"
          ? EPUB_LIMITS.entryBytes
          : scenario === "expanded"
            ? EPUB_LIMITS.expandedBytes
            : EPUB_LIMITS.files,
    };
    expect(openEpubArchive(entries)).toEqual({
      ok: false,
      reason: "too_long",
      diagnostic: expected,
    });
    expect(openEpubArchive(archive(entries))).toEqual({
      ok: false,
      reason: "too_long",
      diagnostic: expected,
    });
  });
});
