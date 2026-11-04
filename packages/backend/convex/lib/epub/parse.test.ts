import { strToU8, type Zippable, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { EPUB_LIMITS } from "./archive";
import { parseEpub } from "./parse";
import { epubUnits } from "./units";

function fixture({
  bodies = ["<h1>First chapter</h1><p>A quiet beginning.</p>"],
  nav = "",
  ncx = "",
  encryption = "",
  extra = new Map<string, string | Uint8Array>(),
}: {
  bodies?: readonly string[];
  nav?: string;
  ncx?: string;
  encryption?: string;
  extra?: ReadonlyMap<string, string | Uint8Array>;
} = {}) {
  const files = new Map<string, Uint8Array>();
  files.set("mimetype", strToU8("application/epub+zip"));
  files.set(
    "META-INF/container.xml",
    strToU8(
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
  );
  files.set(
    "OPS/package.opf",
    strToU8(
      `<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="edition" version="${ncx ? "2.0" : "3.0"}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A &amp; B</dc:title><dc:creator>First Author</dc:creator><dc:creator>Second Author</dc:creator><dc:identifier id="other">not-this</dc:identifier><dc:identifier id="edition">urn:fixture:edition</dc:identifier><dc:language>en</dc:language></metadata><manifest>${bodies.map((_, index) => `<item id="chapter-${index}" href="text/chapter-${index}.xhtml" media-type="application/xhtml+xml"/>`).join("")}${nav ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ""}${ncx ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : ""}<item id="image" href="images/chart.png" media-type="image/png"/><item id="font" href="fonts/book.otf" media-type="font/otf"/></manifest><spine${ncx ? ' toc="ncx"' : ""}>${bodies.map((_, index) => `<itemref idref="chapter-${index}"/>`).join("")}</spine></package>`,
    ),
  );
  for (const [index, body] of bodies.entries())
    files.set(
      `OPS/text/chapter-${index}.xhtml`,
      strToU8(
        `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ignored title</title></head><body>${body}</body></html>`,
      ),
    );
  if (nav)
    files.set(
      "OPS/nav.xhtml",
      strToU8(
        `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>${nav}</body></html>`,
      ),
    );
  if (ncx) files.set("OPS/toc.ncx", strToU8(ncx));
  if (encryption) files.set("META-INF/encryption.xml", strToU8(encryption));
  for (const [path, data] of extra)
    files.set(path, typeof data === "string" ? strToU8(data) : data);
  return files;
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

function parsed(files = fixture()) {
  const result = parseEpub(archive(files));
  if (!result.ok) throw new Error(`Fixture refused: ${result.reason}`);
  return result.value;
}

describe("parser review regressions", () => {
  it("requires the ZIP marker to be stored in the physical first entry", () => {
    const files = fixture();
    expect(parseEpub(archive(files)).ok).toBe(true);
    expect(
      parseEpub(zipSync(Object.fromEntries(files), { level: 6 })),
    ).toMatchObject({ ok: false, reason: "not_epub" });
    const marker = files.get("mimetype");
    if (!marker) throw new Error("Missing marker");
    files.delete("mimetype");
    files.set("mimetype", marker);
    expect(parseEpub(archive(files))).toMatchObject({
      ok: false,
      reason: "not_epub",
    });
  });

  it("refuses duplicate resolved manifest hrefs before font obfuscation", () => {
    for (const duplicateFirst of [false, true]) {
      const files = fixture({
        encryption:
          '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherData><CipherReference URI="OPS/text/chapter-0.xhtml"/></CipherData></EncryptedData></encryption>',
      });
      const duplicate =
        '<item id="duplicate-font" href="text/./chapter-0.xhtml" media-type="font/otf"/>';
      const source = new TextDecoder().decode(files.get("OPS/package.opf"));
      files.set(
        "OPS/package.opf",
        strToU8(
          duplicateFirst
            ? source.replace("<manifest>", `<manifest>${duplicate}`)
            : source.replace("</manifest>", `${duplicate}</manifest>`),
        ),
      );
      expect(parseEpub(files)).toMatchObject({ ok: false, reason: "not_epub" });
    }
  });

  it("counts attributes against the XML budget without counting quoted equals signs", () => {
    const attributes = Array.from(
      { length: 100_001 },
      (_, index) => ` a${index}="x"`,
    ).join("");
    expect(
      parseEpub(fixture({ bodies: [`<p${attributes}>Readable.</p>`] })),
    ).toMatchObject({
      ok: false,
      reason: "too_long",
    });
    expect(
      parsed(
        fixture({
          bodies: [`<p title="${"=".repeat(100_001)}">Readable.</p>`],
        }),
      ).units[0]?.content,
    ).toBe("Readable.");
  });

  it("propagates depth and node ceilings from optional nav and NCX sources", () => {
    for (const oversized of [
      "<span/>".repeat(100_001),
      `${"<div>".repeat(130)}x${"</div>".repeat(130)}`,
    ]) {
      for (const source of ["nav", "ncx"]) {
        const files = fixture({ nav: "<broken>", ncx: "<ncx/>" });
        files.set(
          source === "nav" ? "OPS/nav.xhtml" : "OPS/toc.ncx",
          strToU8(`<root>${oversized}</root>`),
        );
        expect(parseEpub(files)).toMatchObject({
          ok: false,
          reason: "too_long",
        });
      }
    }
  });

  it("skips missing or malformed linked non-spine files while preserving later notes and indices", () => {
    for (const invalid of [undefined, "<html><broken></html>"]) {
      const files = fixture({
        bodies: [
          '<p>Main <a href="broken.xhtml#note">broken</a><a href="notes.xhtml#note">valid</a></p>',
        ],
      });
      files.set(
        "OPS/package.opf",
        strToU8(
          new TextDecoder()
            .decode(files.get("OPS/package.opf"))
            .replace(
              "</manifest>",
              '<item id="broken" href="text/broken.xhtml" media-type="application/xhtml+xml"/><item id="notes" href="text/notes.xhtml" media-type="application/xhtml+xml"/></manifest>',
            ),
        ),
      );
      if (invalid) files.set("OPS/text/broken.xhtml", strToU8(invalid));
      files.set(
        "OPS/text/notes.xhtml",
        strToU8(
          '<html><body><p id="note">Note <a href="chapter-0.xhtml">back</a></p></body></html>',
        ),
      );
      const book = parsed(files);
      expect(book.spine).toHaveLength(2);
      const html = book.units.map((unit) => unit.contentHtml).join("");
      expect(html).toContain("<a>broken</a>");
      expect(html).toContain('id="epub-1-note"');
      expect(html).toContain('#epub-1-note"');
      for (const unit of book.units)
        expect(unit.content).toBe(
          unit.sourceSpans
            .map((span) =>
              book.spine[span.spineIndex]?.text.slice(span.start, span.end),
            )
            .join("\n\n"),
        );
      for (const oversized of [
        "<span/>".repeat(100_001),
        `${"<div>".repeat(130)}x${"</div>".repeat(130)}`,
        "x".repeat(EPUB_LIMITS.entryBytes + 1),
      ]) {
        files.set(
          "OPS/text/broken.xhtml",
          strToU8(`<html><body>${oversized}</body></html>`),
        );
        expect(parseEpub(files)).toMatchObject({
          ok: false,
          reason: "too_long",
        });
      }
    }
  });

  it("reports an oversized list item's own byte count without its sibling", () => {
    const text = "é".repeat(100_001);
    expect(
      parseEpub(
        fixture({ bodies: [`<ul><li>short</li><li>${text}</li></ul>`] }),
      ),
    ).toMatchObject({
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "block_bytes",
        observed: new TextEncoder().encode(`<ul><li>${text}</li></ul>${text}`)
          .length,
        blockIndex: 1,
      },
    });
  });
  it("splits quoted lists while retaining quote markup, IDs and exact source spans", () => {
    const book = parsed(
      fixture({
        bodies: [
          `<blockquote id="quote"><p>Before.</p><ol>${Array.from({ length: 5 }, (_, index) => `<li>${index} ${"word ".repeat(1500)}</li>`).join("")}</ol><p>After.</p></blockquote>`,
        ],
      }),
    );
    expect(book.units.length).toBeGreaterThan(1);
    const html = book.units.map((unit) => unit.contentHtml).join("");
    expect(html.match(/id="epub-0-quote"/gu)).toHaveLength(1);
    expect(html).toContain("<blockquote><ol");
    for (const unit of book.units) {
      expect(unit.wordCount).toBeLessThanOrEqual(4000);
      expect(unit.content).toBe(
        unit.sourceSpans
          .map((span) =>
            book.spine[span.spineIndex]?.text.slice(span.start, span.end),
          )
          .join("\n\n"),
      );
      expect((unit.contentHtml.match(/<blockquote\b/gu) ?? []).length).toBe(
        (unit.contentHtml.match(/<\/blockquote>/gu) ?? []).length,
      );
    }
  });

  it("reports the same first-excess archive count for byte and directory input", () => {
    const files = fixture();
    for (let index = 0; index < EPUB_LIMITS.files + 10; index++)
      files.set(`extra-${index}`, new Uint8Array());
    const expected = {
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "archive_entries",
        stage: "archive",
        observed: EPUB_LIMITS.files + 1,
        limit: EPUB_LIMITS.files,
      },
    };
    expect(parseEpub(files)).toEqual(expected);
    expect(parseEpub(archive(files))).toEqual(expected);
  });

  it("classifies malformed encryption XML separately from DRM", () => {
    expect(
      parseEpub(fixture({ encryption: "<encryption><broken></encryption>" })),
    ).toMatchObject({
      ok: false,
      reason: "unreadable",
      diagnostic: { code: "invalid_encryption", stage: "encryption" },
    });
  });

  it("requires the exact EPUB marker for both input forms and rejects prototype entries", () => {
    for (const marker of [
      undefined,
      "application/epub+zip\n",
      "\uFEFFapplication/epub+zip",
      "text/plain",
    ]) {
      const files = fixture();
      if (marker === undefined) files.delete("mimetype");
      else files.set("mimetype", strToU8(marker));
      expect(parseEpub(files)).toMatchObject({ ok: false, reason: "not_epub" });
      expect(parseEpub(archive(files))).toMatchObject({
        ok: false,
        reason: "not_epub",
      });
    }
    const files = fixture();
    files.set("__proto__", strToU8("not an entry to lose"));
    expect(parseEpub(files)).toMatchObject({ ok: false, reason: "not_epub" });
    files.delete("__proto__");
    files.set("__pr0to__", strToU8("not an entry to lose"));
    const bytes = archive(files);
    for (let index = 0; index < bytes.length - 8; index++) {
      if (
        new TextDecoder().decode(bytes.slice(index, index + 9)) === "__pr0to__"
      )
        bytes[index + 4] = 111;
    }
    expect(parseEpub(bytes)).toMatchObject({ ok: false, reason: "not_epub" });
  });

  it("falls back through malformed and missing optional outline sources", () => {
    const ncx =
      '<ncx><navMap><navPoint><navPoint><navLabel><text>Child only</text></navLabel><content src="text/chapter-0.xhtml"/></navPoint></navPoint></navMap></ncx>';
    for (const missing of [false, true]) {
      const files = fixture({ nav: "<broken>", ncx });
      if (missing) files.delete("OPS/nav.xhtml");
      expect(parsed(files).outline).toEqual([
        { title: "Child only", href: "OPS/text/chapter-0.xhtml", depth: 1 },
      ]);
      files.set("OPS/toc.ncx", strToU8("<broken>"));
      expect(parsed(files).outline[0]?.title).toBe("First chapter");
    }
  });

  it("does not invent a declared identifier", () => {
    const files = fixture();
    files.set(
      "OPS/package.opf",
      strToU8(
        new TextDecoder()
          .decode(files.get("OPS/package.opf"))
          .replace(' unique-identifier="edition"', "")
          .replace(' id="edition"', ""),
      ),
    );
    expect(parsed(files).metadata.identifier).toBeUndefined();
  });

  it("separates nested containers and trims only non-preformatted edges", () => {
    const book = parsed(
      fixture({
        bodies: [
          "<ul><li><div>A</div><section>B</section></li></ul><blockquote>  <pre>  preserved  </pre>  </blockquote>",
        ],
      }),
    );
    expect(book.spine[0]?.blocks[0]?.text).toBe("A\nB");
    expect(book.spine[0]?.blocks[1]?.text).toBe("  preserved  ");
  });

  it("refuses undeclared named HTML entities explicitly while accepting numeric equivalents", () => {
    expect(parseEpub(fixture({ bodies: ["<p>A&nbsp;B</p>"] }))).toMatchObject({
      ok: false,
      reason: "unreadable",
    });
    expect(
      parsed(fixture({ bodies: ["<p>A&#160;B</p>"] })).units[0]?.content,
    ).toBe("A B");
  });

  it("bounds crafted DOCTYPE, node and depth input before DOM construction", () => {
    const internalSubset = fixture();
    internalSubset.set(
      "OPS/text/chapter-0.xhtml",
      strToU8(
        "<!DOCTYPE html [<!ELEMENT html ANY>]><html><body><p>Readable.</p></body></html>",
      ),
    );
    expect(parseEpub(internalSubset)).toMatchObject({
      ok: false,
      reason: "unreadable",
    });

    expect(
      parseEpub(fixture({ bodies: ["<!DOCTYPE".repeat(10_000)] })),
    ).toMatchObject({ ok: false, reason: "unreadable" });
    expect(
      parseEpub(fixture({ bodies: ["<span/>".repeat(100_001)] })),
    ).toMatchObject({
      ok: false,
      reason: "too_long",
      diagnostic: { code: "xml_nodes" },
    });
    expect(
      parseEpub(
        fixture({ bodies: [`${"<div>".repeat(130)}x${"</div>".repeat(130)}`] }),
      ),
    ).toMatchObject({
      ok: false,
      reason: "too_long",
      diagnostic: { code: "xml_depth" },
    });
  });

  it("preserves forward noterefs, aside notes, non-spine notes, encoded IDs and return links", () => {
    const files = fixture({
      bodies: [
        '<p xmlns:epub="http://www.idpf.org/2007/ops" id="return space">Read <a epub:type="noteref" href="#note%20space">one</a> and <a href="notes%20file.xhtml#n%25ote">two</a>. <a href="https://example.invalid/path?q=1&amp;x=2">External</a></p><aside id="note space"><p>Aside note <a href="#return%20space">return</a></p></aside>',
      ],
    });
    files.set(
      "OPS/package.opf",
      strToU8(
        new TextDecoder()
          .decode(files.get("OPS/package.opf"))
          .replace(
            "</manifest>",
            '<item id="notes" href="text/notes%20file.xhtml" media-type="application/xhtml+xml"/></manifest>',
          ),
      ),
    );
    files.set(
      "OPS/text/notes file.xhtml",
      strToU8(
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><aside id="n%ote"><p>Non-spine note <a href="chapter-0.xhtml#return%20space">Back</a></p></aside></body></html>',
      ),
    );
    const book = parsed(files);
    const html = book.units.map((unit) => unit.contentHtml).join("");
    expect(html).toContain('id="epub-0-note%20space"');
    expect(html).toContain('#epub-0-note%2520space"');
    expect(html).toContain('#epub-0-return%2520space"');
    expect(html).toContain('id="epub-1-n%25ote"');
    expect(html).toContain('#epub-1-n%2525ote"');
    expect(html).toContain('href="https://example.invalid/path?q=1&amp;x=2"');
    expect(book.units.map((unit) => unit.content).join(" ")).toContain(
      "Non-spine note Back",
    );
    for (const unit of book.units) {
      const source = unit.sourceSpans
        .map((span) =>
          book.spine[span.spineIndex]?.text.slice(span.start, span.end),
        )
        .join("\n\n");
      expect(unit.content).toBe(source);
    }
  });
});

describe("EPUB metadata and outline", () => {
  it("reads the declared edition identifier, creators and spine from original bytes", () => {
    const bytes = archive(fixture());
    const before = bytes.slice();
    const result = parseEpub(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.metadata).toEqual({
      title: "A & B",
      creators: ["First Author", "Second Author"],
      identifier: "urn:fixture:edition",
      language: "en",
    });
    expect(result.value.outline).toEqual([
      { title: "First chapter", href: "OPS/text/chapter-0.xhtml", depth: 0 },
    ]);
    expect(result.value.spine[0]?.xhtml).toContain("A quiet beginning.");
    expect(bytes).toEqual(before);
  });

  it("accepts an in-memory unpacked directory with the same result as its ZIP", () => {
    const files = fixture();
    expect(parseEpub(files).ok).toBe(true);
    expect(parseEpub(archive(files)).ok).toBe(true);
    expect(parseEpub(files)).toEqual(parseEpub(archive(files)));
  });

  it("normalizes case-insensitive media types before resolving content and images", () => {
    const files = fixture({
      extra: new Map([
        ["OPS/images/chart.png", new Uint8Array([137, 80, 78, 71])],
      ]),
    });
    const bytes = files.get("OPS/package.opf");
    if (!bytes) throw new Error("Missing fixture package");
    files.set(
      "OPS/package.opf",
      strToU8(
        new TextDecoder()
          .decode(bytes)
          .replaceAll("image/png", "IMAGE/PNG")
          .replaceAll("application/xhtml+xml", "APPLICATION/XHTML+XML"),
      ),
    );
    const book = parsed(files);
    expect(book.images).toEqual([
      {
        href: "OPS/images/chart.png",
        mediaType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      },
    ]);
    expect(
      book.manifest.find((item) => item.id === "chapter-0")?.mediaType,
    ).toBe("application/xhtml+xml");
  });

  it("uses nested EPUB 3 navigation before NCX and filters non-spine destinations", () => {
    const book = parsed(
      fixture({
        bodies: [
          "<h1>One</h1><p>Start.</p>",
          '<h1 id="detail">Two</h1><p>Continue.</p>',
        ],
        nav: '<nav epub:type="toc"><ol><li><a href="text/chapter-0.xhtml">Opening</a><ol><li><a href="text/chapter-1.xhtml#detail">Detail</a></li></ol></li><li><a href="https://example.invalid">Offsite</a></li></ol></nav>',
        ncx: '<ncx><navMap><navPoint><navLabel><text>Wrong source</text></navLabel><content src="text/chapter-0.xhtml"/></navPoint></navMap></ncx>',
      }),
    );
    expect(book.outline).toEqual([
      { title: "Opening", href: "OPS/text/chapter-0.xhtml", depth: 0 },
      { title: "Detail", href: "OPS/text/chapter-1.xhtml#detail", depth: 1 },
    ]);
  });

  it("reads EPUB 2 NCX navigation and falls back from a nav without a toc", () => {
    const book = parsed(
      fixture({
        nav: '<nav epub:type="landmarks"/>',
        ncx: '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint><navLabel><text>From NCX</text></navLabel><content src="text/chapter-0.xhtml"/><navPoint><navLabel><text>Nested</text></navLabel><content src="text/chapter-0.xhtml#end"/></navPoint></navPoint></navMap></ncx>',
      }),
    );
    expect(book.outline.map((entry) => [entry.title, entry.depth])).toEqual([
      ["From NCX", 0],
      ["Nested", 1],
    ]);
  });

  it("does not lose spine order when filenames sort differently", () => {
    const files = fixture({
      bodies: ["<h1>Zebra</h1><p>First.</p>", "<h1>Apple</h1><p>Second.</p>"],
    });
    const packageBytes = files.get("OPS/package.opf");
    if (!packageBytes) throw new Error("Missing fixture package");
    files.set(
      "OPS/package.opf",
      strToU8(
        new TextDecoder()
          .decode(packageBytes)
          .replace(
            '<itemref idref="chapter-0"/><itemref idref="chapter-1"/>',
            '<itemref idref="chapter-1"/><itemref idref="chapter-0"/>',
          ),
      ),
    );
    expect(parsed(files).spine.map((item) => item.title)).toEqual([
      "Apple",
      "Zebra",
    ]);
  });
});

describe("EPUB reading content", () => {
  it("keeps structure and image references without executing or loading publication resources", () => {
    const book = parsed(
      fixture({
        bodies: [
          '<section id="start"><h1 onclick="evil()">Structure</h1><p style="color:red" class="publisher">A <em>quiet</em> &amp; <strong>clear</strong> sentence.<script>evil()</script></p><blockquote><p>A quotation.</p></blockquote><ul><li>One</li><li>Two</li></ul><table><tr><th>Head</th><td colspan="2">Cell</td></tr></table><figure><img src="../images/chart.png" alt="Chart"/><figcaption>A figure.</figcaption></figure><p>Verse<br/>Another line<sup>1</sup><sub>2</sub></p><hr/><aside>A note.</aside><form><p>Not reading text.</p></form><iframe src="https://tracking.invalid"/><svg><script>evil()</script></svg><div hidden="hidden"><p>Hidden text.</p></div></section>',
        ],
        extra: new Map([
          ["OPS/images/chart.png", new Uint8Array([137, 80, 78, 71])],
        ]),
      }),
    );
    const html = book.units.map((unit) => unit.contentHtml).join("");
    expect(html).toContain("<blockquote><p>A quotation.</p></blockquote>");
    expect(html).toContain('<td colspan="2">Cell</td>');
    expect(html).toContain(
      '<img data-epub-image="OPS%2Fimages%2Fchart.png" alt="Chart">',
    );
    expect(html).toContain("Verse<br>Another line<sup>1</sup><sub>2</sub>");
    expect(html).toContain("<aside>A note.</aside>");
    expect(html).not.toMatch(
      /script|onclick|style=|class=|iframe|svg|form|src=|Hidden text|Not reading text/u,
    );
    expect(book.images).toEqual([
      {
        href: "OPS/images/chart.png",
        mediaType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      },
    ]);
  });

  it("drops unsafe links and remote images, and escapes literal markup", () => {
    const html = parsed(
      fixture({
        bodies: [
          '<p>&lt;script&gt;literal&lt;/script&gt; <a href="javascript:evil()">bad</a><a href="data:text/html,evil">bad too</a><a href="https://example.invalid/path?a=1&amp;b=2">safe</a><img src="https://tracking.invalid/pixel" alt="Remote figure"/></p>',
        ],
      }),
    ).units[0]?.contentHtml;
    expect(html).toContain("&lt;script&gt;literal&lt;/script&gt;");
    expect(html).toContain(
      '<a href="https://example.invalid/path?a=1&amp;b=2">safe</a>',
    );
    expect(html).not.toMatch(/javascript:|data:|tracking\.invalid|src=/u);
    expect(html).toContain("Remote figure");
  });

  it("keeps inline runs together rather than turning emphasis into separate paragraphs", () => {
    const unit = parsed(
      fixture({
        bodies: ["Before <em>emphasis</em> after.<p>Next paragraph.</p>"],
      }),
    ).units[0];
    expect(unit?.contentHtml).toBe(
      "<p>Before <em>emphasis</em> after.</p><p>Next paragraph.</p>",
    );
    expect(unit?.content).toBe("Before emphasis after.\n\nNext paragraph.");
  });

  it("preserves preformatted whitespace through nested inline markup and source ranges", () => {
    const pre = "\n  const café = 1;\n\t  return café &amp; value;\n\n";
    const book = parsed(
      fixture({
        bodies: [
          `<pre>\n  const <code>café</code> = 1;\n\t  return café &amp; value;\n\n</pre><blockquote><pre>${pre}</pre></blockquote><p>Ordinary   prose.</p>`,
        ],
      }),
    );
    expect(book.units[0]?.contentHtml).toContain(
      "<pre>\n  const <code>café</code> = 1;\n\t  return café &amp; value;\n\n</pre>",
    );
    expect(book.units[0]?.contentHtml).toContain(
      `<blockquote><pre>${pre}</pre></blockquote>`,
    );
    expect(book.units[0]?.content).toContain(
      "\n  const café = 1;\n\t  return café & value;\n\n",
    );
    expect(book.spine[0]?.blocks[0]?.text).toBe(
      "\n  const café = 1;\n\t  return café & value;\n\n",
    );
    for (const unit of book.units) {
      expect(
        unit.sourceSpans
          .map((span) =>
            book.spine[span.spineIndex]?.text.slice(span.start, span.end),
          )
          .join("\n\n"),
      ).toBe(unit.content);
    }
  });

  it("drops trailing blank units and makes their destinations inert without shifting valid links", () => {
    const book = parsed(
      fixture({
        bodies: [
          `<p>${"word ".repeat(150)}<a href="chapter-3.xhtml#blank">Blank</a><a href="chapter-3.xhtml">Empty chapter</a><a href="chapter-2.xhtml#last">Last</a></p>`,
          `<p>${"word ".repeat(150)}</p>`,
          `<p id="last">${"word ".repeat(150)}</p>`,
          '<section id="blank"><hr/></section>',
        ],
      }),
    );
    expect(book.units).toHaveLength(3);
    expect(book.units.every((unit) => unit.content.trim().length > 0)).toBe(
      true,
    );
    expect(book.units[0]?.contentHtml).toContain("<a>Blank</a>");
    expect(book.units[0]?.contentHtml).toContain("<a>Empty chapter</a>");
    expect(book.units[0]?.contentHtml).toContain('href="?unit=2#epub-2-last"');
  });

  it("discards blank split candidates without assigning their anchors to a later unit", () => {
    const book = parsed(
      fixture({
        bodies: [
          `<pre id="blank">${" ".repeat(199_000)}</pre><p id="last">${"x".repeat(150_000)}<a href="#blank">Missing</a><a href="#last">Last</a></p>`,
        ],
      }),
    );
    expect(book.units).toHaveLength(1);
    expect(book.units[0]?.contentHtml).toContain("<a>Missing</a>");
    expect(book.units[0]?.contentHtml).toContain('href="?unit=0#epub-0-last"');
  });

  it("rewrites internal references after splitting, including fragments in later units", () => {
    const paragraph = "word ".repeat(2100).trim();
    const book = parsed(
      fixture({
        bodies: [
          `<h1>Long</h1><p><a href="#end">Jump</a></p><p>${paragraph}</p><p id="end">${paragraph}</p><p><a href="chapter-1.xhtml">Next chapter</a></p>`,
          "<h1>Last</h1><p>The end.</p>",
        ],
      }),
    );
    expect(book.units).toHaveLength(3);
    expect(book.units[0]?.contentHtml).toContain('href="?unit=1#epub-0-end"');
    expect(book.units[1]?.contentHtml).toContain('href="?unit=2"');
    expect(book.units[1]?.contentHtml).toContain('id="epub-0-end"');
    expect(
      book.units.every((unit) => unit.wordCount <= EPUB_LIMITS.unitWords),
    ).toBe(true);
  });

  it("merges short front matter into its neighbour with ranges for both spine items", () => {
    const book = parsed(
      fixture({
        bodies: [
          "<p>For the reader.</p>",
          `<h1>Chapter</h1><p>${"word ".repeat(150)}</p>`,
        ],
      }),
    );
    expect(book.units).toHaveLength(1);
    expect(book.units[0]?.title).toBe("Chapter");
    expect(book.units[0]?.sourceSpans.map((span) => span.spineIndex)).toEqual([
      0, 1,
    ]);
    expect(book.units[0]?.content).toContain("For the reader.");
  });

  it("keeps short trailing matter separate instead of merging it backward", () => {
    const book = parsed(
      fixture({
        bodies: [
          `<h1>Chapter</h1><p>${"word ".repeat(150)}</p>`,
          "<p>Colophon.</p>",
        ],
      }),
    );
    expect(book.units).toHaveLength(2);
    expect(book.units[1]?.content).toBe("Colophon.");
    expect(book.units[1]?.sourceSpans).toEqual([
      { spineIndex: 1, start: 0, end: 9 },
    ]);
  });

  it("keeps source ranges in UTF-16 text coordinates without losing split paragraphs", () => {
    const paragraphs = Array.from(
      { length: 8 },
      (_, index) => `<p>${index} café 😀 ${"word ".repeat(800)}</p>`,
    );
    const book = parsed(
      fixture({ bodies: [`<h1>Ranges</h1>${paragraphs.join("")}`] }),
    );
    const spans = book.units.flatMap((unit) => unit.sourceSpans);
    expect(spans[0]?.start).toBe(0);
    expect(spans.at(-1)?.end).toBe(book.spine[0]?.text.length);
    for (const unit of book.units) {
      expect(
        unit.sourceSpans
          .map((span) =>
            book.spine[span.spineIndex]?.text.slice(span.start, span.end),
          )
          .join("\n\n"),
      ).toBe(unit.content);
      expect(
        new TextEncoder().encode(unit.content + unit.contentHtml).byteLength,
      ).toBeLessThanOrEqual(EPUB_LIMITS.unitBytes);
    }
    expect(book.units.map((unit) => unit.content).join("\n\n")).toBe(
      book.spine[0]?.text,
    );
  });

  it("leaves a missing or malformed fragment inert instead of guessing a destination", () => {
    const html = parsed(
      fixture({
        bodies: [
          '<p><a href="#missing">Missing</a><a href="#%ZZ">Malformed</a></p>',
        ],
      }),
    ).units[0]?.contentHtml;
    expect(html).not.toContain("href=");
  });

  it("keeps source ranges exact when empty anchors precede reading text", () => {
    const book = parsed(
      fixture({
        bodies: [
          '<section id="chapter"><p><a id="start"/></p><h1>Chapter</h1><p>Reading text. <a href="#start">Back</a></p><hr/></section>',
        ],
      }),
    );
    expect(book.units[0]?.contentHtml).toContain('id="epub-0-start"');
    expect(book.units[0]?.contentHtml).toContain('href="?unit=0#epub-0-start"');
    for (const unit of book.units) {
      const source = unit.sourceSpans
        .map((span) =>
          book.spine[span.spineIndex]?.text.slice(span.start, span.end),
        )
        .join("\n\n");
      expect(unit.content).toBe(source);
    }
  });
});

describe("EPUB list splitting and diagnostics", () => {
  it.each([
    "ol",
    "ul",
  ])("splits a generated 14208-word %s without losing text, items, markup, anchors or spans", (tag) => {
    const paragraphs = Array.from(
      { length: 96 },
      (_, index) => `${`entry${index} `.repeat(146)}emphasized jump`,
    );
    const body = `<${tag} id="list"${tag === "ol" ? ' start="7" type="a"' : ""}>${paragraphs.map((_, index) => `<li id="item-${index}">${`entry${index} `.repeat(146)}<em><strong>emphasized</strong></em> <a href="#item-95">jump</a></li>`).join("\n  ")}</${tag}>`;
    const book = parsed(fixture({ bodies: [body] }));
    expect(book.units).toHaveLength(4);
    expect(book.spine[0]?.text).toBe(paragraphs.join("\n"));
    expect(book.units.reduce((sum, unit) => sum + unit.wordCount, 0)).toBe(
      14208,
    );
    expect(book.units.map((unit) => unit.content).join("\n")).toBe(
      paragraphs.join("\n"),
    );
    const html = book.units.map((unit) => unit.contentHtml).join("");
    expect(
      Array.from(html.matchAll(/<li id="epub-0-item-(\d+)"/gu), (match) =>
        Number(match[1]),
      ),
    ).toEqual(Array.from({ length: 96 }, (_, index) => index));
    expect(html.match(/id="epub-0-list"/gu)).toHaveLength(1);
    expect(html.match(/<em><strong>emphasized<\/strong><\/em>/gu)).toHaveLength(
      96,
    );
    expect(html.match(/href="\?unit=3#epub-0-item-95"/gu)).toHaveLength(96);
    if (tag === "ol") {
      expect(
        Array.from(html.matchAll(/<ol[^>]* start="(\d+)"/gu), (match) =>
          Number(match[1]),
        ),
      ).toEqual([7, 34, 61, 88]);
      expect(html.match(/type="a"/gu)).toHaveLength(4);
    }
    for (const unit of book.units) {
      expect(unit.wordCount).toBeLessThanOrEqual(EPUB_LIMITS.unitWords);
      expect(
        new TextEncoder().encode(unit.contentHtml + unit.content).length,
      ).toBeLessThanOrEqual(EPUB_LIMITS.unitBytes);
      expect(unit.content).toBe(
        unit.sourceSpans
          .map((span) =>
            book.spine[span.spineIndex]?.text.slice(span.start, span.end),
          )
          .join("\n\n"),
      );
    }
  });

  it.each([
    false,
    true,
  ])("continues reversed numbering and explicit li resets, explicit start=%s", (explicit) => {
    const body = `<ol reversed="reversed" type="I"${explicit ? ' start="100"' : ""}>${Array.from({ length: 5 }, (_, index) => `<li${index === 2 ? ' value="50"' : ""}>${`item${index} `.repeat(1500)}</li>`).join("")}</ol>`;
    const book = parsed(fixture({ bodies: [body] }));
    const html = book.units.map((unit) => unit.contentHtml).join("");
    expect(book.units).toHaveLength(3);
    expect(
      Array.from(html.matchAll(/<ol[^>]* start="(\d+)"/gu), (match) =>
        Number(match[1]),
      ),
    ).toEqual([explicit ? 100 : 5, 50, 48]);
    expect(html.match(/reversed="reversed"/gu)).toHaveLength(3);
    expect(html.match(/type="I"/gu)).toHaveLength(3);
    expect(html).toContain('<li value="50">');
  });

  it("splits at byte limits while keeping nested lists and preformatted item markup intact", () => {
    const item = `${"é".repeat(55_000)}<ul><li><pre>nested  text\nnext</pre></li></ul>`;
    const book = parsed(
      fixture({
        bodies: [
          `<ul> ${Array.from({ length: 4 }, () => `<li>${item}</li>`).join("\n  ")} </ul>`,
        ],
      }),
    );
    expect(book.units).toHaveLength(4);
    for (const unit of book.units) {
      expect(unit.contentHtml).toContain(
        "<ul><li><pre>nested  text\nnext</pre></li></ul>",
      );
      expect(unit.content).toBe(
        unit.sourceSpans
          .map((span) =>
            book.spine[span.spineIndex]?.text.slice(span.start, span.end),
          )
          .join("\n\n"),
      );
    }
  });

  it("does not split malformed lists with text outside list items", () => {
    expect(
      parseEpub(
        fixture({
          bodies: [
            `<ul>outside <li>${"word ".repeat(3000)}</li><li>${"word ".repeat(3000)}</li></ul>`,
          ],
        }),
      ),
    ).toMatchObject({
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "block_words",
        stage: "units",
        observed: 6001,
        limit: 4000,
      },
    });
  });

  it("continues numbering using only list items retained by sanitization", () => {
    const book = parsed(
      fixture({
        bodies: [
          `<ol reversed="reversed"><li hidden="hidden">hidden</li>${Array.from({ length: 5 }, () => `<li>${"word ".repeat(1500)}</li>`).join("")}</ol>`,
        ],
      }),
    );
    const html = book.units.map((unit) => unit.contentHtml).join("");
    expect(
      Array.from(html.matchAll(/<ol[^>]* start="(\d+)"/gu), (match) =>
        Number(match[1]),
      ),
    ).toEqual([5, 3, 1]);
    expect(html).not.toContain("hidden");
  });

  it("reports byte, XML-node and unit-count limits precisely", () => {
    const oversized = `<p>${"é".repeat(100_001)}</p>`;
    expect(parseEpub(fixture({ bodies: [oversized] }))).toMatchObject({
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "block_bytes",
        stage: "units",
        observed: 400011,
        limit: EPUB_LIMITS.unitBytes,
        spineIndex: 0,
        blockIndex: 0,
      },
    });
    expect(
      parseEpub(fixture({ bodies: [`<p>${"<br/>".repeat(100_001)}</p>`] })),
    ).toMatchObject({
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "xml_nodes",
        stage: "spine",
        observed: 100001,
        limit: 100000,
        spineIndex: 0,
      },
    });
    const text = "word ".repeat(100).trim();
    const result = epubUnits(
      Array.from({ length: EPUB_LIMITS.units + 1 }, (_, index) => ({
        href: `item-${index}`,
        xhtml: "",
        title: "Part",
        text,
        blocks: [{ html: `<p>${text}</p>`, text, start: 0, end: text.length }],
      })),
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "unit_count",
        stage: "units",
        observed: EPUB_LIMITS.units + 1,
        limit: EPUB_LIMITS.units,
      },
    });
  });

  it("keeps navigation diagnostics at their own stage", () => {
    const stages: string[] = [];
    const diagnostics: unknown[] = [];
    const result = parseEpub(fixture({ nav: "<p>broken</wrong>" }), {
      onStage: (stage) => stages.push(stage),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    expect(result.ok).toBe(true);
    expect(diagnostics).toEqual([
      { code: "invalid_navigation", stage: "navigation" },
    ]);
    expect(stages).toEqual([
      "archive",
      "package",
      "encryption",
      "navigation",
      "spine",
      "units",
    ]);
  });

  it.each([
    "ol",
    "ul",
  ])("still refuses an oversized individual %s item", (tag) => {
    expect(
      parseEpub(
        fixture({
          bodies: [
            `<h1>Heading</h1><${tag}><li>${"word ".repeat(4001)}</li><li>short</li></${tag}>`,
          ],
        }),
      ),
    ).toMatchObject({
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "block_words",
        stage: "units",
        observed: 4001,
        limit: 4000,
        spineIndex: 0,
        blockIndex: 1,
      },
    });
  });

  it("reports verified metadata before a later failure and stages without exposing content", () => {
    const stages: string[] = [];
    const metadata: unknown[] = [];
    const result = parseEpub(
      fixture({ bodies: [`<p>${"private ".repeat(4001)}</p>`] }),
      {
        onStage: (stage) => stages.push(stage),
        onMetadata: (value) => {
          metadata.push(value);
          expect(stages).toEqual(["archive", "package"]);
        },
      },
    );
    expect(stages).toEqual([
      "archive",
      "package",
      "encryption",
      "navigation",
      "spine",
      "units",
    ]);
    expect(metadata).toEqual([
      {
        title: "A & B",
        creators: ["First Author", "Second Author"],
        identifier: "urn:fixture:edition",
        language: "en",
      },
    ]);
    expect(result).toEqual({
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "block_words",
        stage: "units",
        observed: 4001,
        limit: 4000,
        spineIndex: 0,
        blockIndex: 0,
      },
    });
    const invalidMetadata: unknown[] = [];
    parseEpub(new Uint8Array([1, 2, 3]), {
      onMetadata: (value) => invalidMetadata.push(value),
    });
    expect(invalidMetadata).toEqual([]);
  });
});

describe("EPUB refusals", () => {
  it("refuses a ZIP without the EPUB container or package", () => {
    expect(
      parseEpub(archive(new Map([["readme.txt", strToU8("not a book")]]))),
    ).toMatchObject({
      ok: false,
      reason: "not_epub",
      diagnostic: { code: "invalid_archive", stage: "archive" },
    });
    const files = fixture();
    files.delete("OPS/package.opf");
    expect(parseEpub(files)).toMatchObject({
      ok: false,
      reason: "not_epub",
      diagnostic: { code: "invalid_package", stage: "package" },
    });
  });

  it("refuses malformed bytes and XML without exposing document contents", () => {
    expect(parseEpub(new Uint8Array([1, 2, 3]))).toMatchObject({
      ok: false,
      reason: "unreadable",
    });
    const files = fixture();
    files.set(
      "OPS/text/chapter-0.xhtml",
      strToU8("<html><body><p>private text</body></html>"),
    );
    expect(parseEpub(files)).toMatchObject({
      ok: false,
      reason: "unreadable",
      diagnostic: { code: "invalid_spine", stage: "spine", spineIndex: 0 },
    });
  });

  it("rejects entity declarations and excessive XML depth", () => {
    const files = fixture();
    files.set(
      "OPS/text/chapter-0.xhtml",
      strToU8(
        '<!DOCTYPE html [<!ENTITY x SYSTEM "file:///etc/passwd">]><html><body><p>&x;</p></body></html>',
      ),
    );
    expect(parseEpub(files)).toMatchObject({
      ok: false,
      reason: "unreadable",
      diagnostic: { code: "invalid_spine", stage: "spine", spineIndex: 0 },
    });
    files.set(
      "OPS/text/chapter-0.xhtml",
      strToU8(
        `<html><body>${"<div>".repeat(130)}deep${"</div>".repeat(130)}</body></html>`,
      ),
    );
    expect(parseEpub(files)).toMatchObject({
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "xml_depth",
        stage: "spine",
        observed: 129,
        limit: 128,
        spineIndex: 0,
      },
    });
  });

  it("refuses encrypted publications but permits declared font obfuscation", () => {
    const encryption = (algorithm: string) =>
      `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="${algorithm}"/><CipherData><CipherReference URI="OPS/fonts/book.otf"/></CipherData></EncryptedData></encryption>`;
    expect(
      parseEpub(
        fixture({
          encryption: encryption("http://www.w3.org/2001/04/xmlenc#aes128-cbc"),
        }),
      ),
    ).toMatchObject({
      ok: false,
      reason: "protected",
      diagnostic: { code: "protected_content", stage: "encryption" },
    });
    expect(
      parseEpub(
        fixture({
          encryption: encryption("http://www.idpf.org/2008/embedding"),
        }),
      ).ok,
    ).toBe(true);
    expect(
      parseEpub(
        fixture({ encryption: encryption("http://ns.adobe.com/pdf/enc#RC") }),
      ).ok,
    ).toBe(true);
    expect(
      parseEpub(
        fixture({ encryption: "<encryption><EncryptedData/></encryption>" }),
      ),
    ).toMatchObject({
      ok: false,
      reason: "protected",
      diagnostic: { code: "protected_content", stage: "encryption" },
    });
    expect(
      parseEpub(
        fixture({
          encryption: encryption("http://www.idpf.org/2008/embedding").replace(
            "OPS/fonts/book.otf",
            "OPS/text/chapter-0.xhtml",
          ),
        }),
      ),
    ).toMatchObject({
      ok: false,
      reason: "protected",
      diagnostic: { code: "protected_content", stage: "encryption" },
    });
  });

  it("refuses a missing spine item, duplicate manifest ID and remote package", () => {
    const files = fixture();
    files.delete("OPS/text/chapter-0.xhtml");
    expect(parseEpub(files)).toMatchObject({
      ok: false,
      reason: "not_epub",
      diagnostic: { code: "invalid_spine", stage: "package" },
    });
    const duplicate = fixture();
    const bytes = duplicate.get("OPS/package.opf");
    if (!bytes) throw new Error("Missing fixture package");
    duplicate.set(
      "OPS/package.opf",
      strToU8(
        new TextDecoder().decode(bytes).replace('id="font"', 'id="image"'),
      ),
    );
    expect(parseEpub(duplicate)).toMatchObject({
      ok: false,
      reason: "not_epub",
      diagnostic: { code: "invalid_package", stage: "package" },
    });
    const remote = fixture();
    remote.set(
      "META-INF/container.xml",
      strToU8(
        '<container><rootfiles><rootfile full-path="https://example.invalid/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      ),
    );
    expect(parseEpub(remote)).toMatchObject({
      ok: false,
      reason: "not_epub",
      diagnostic: { code: "invalid_package", stage: "package" },
    });
  });

  it("refuses an empty spine or content with no readable text", () => {
    expect(parseEpub(fixture({ bodies: [] }))).toMatchObject({
      ok: false,
      reason: "empty",
      diagnostic: { code: "empty_text", stage: "units" },
    });
    expect(
      parseEpub(
        fixture({
          bodies: [
            '<script>not reading text</script><img src="../images/chart.png" alt=""/>',
          ],
        }),
      ),
    ).toMatchObject({
      ok: false,
      reason: "empty",
      diagnostic: { code: "empty_text", stage: "units" },
    });
  });

  it("bounds the input, expanded entries and entry count before parsing", () => {
    expect(
      parseEpub(new Uint8Array(EPUB_LIMITS.archiveBytes + 1)),
    ).toMatchObject({
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "archive_bytes",
        stage: "archive",
        observed: EPUB_LIMITS.archiveBytes + 1,
        limit: EPUB_LIMITS.archiveBytes,
      },
    });
    const oversized = fixture({
      extra: new Map([
        ["large.bin", new Uint8Array(EPUB_LIMITS.entryBytes + 1)],
      ]),
    });
    expect(parseEpub(archive(oversized))).toMatchObject({
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "entry_bytes",
        stage: "archive",
        observed: EPUB_LIMITS.entryBytes + 1,
        limit: EPUB_LIMITS.entryBytes,
      },
    });
    const crowded = fixture();
    for (let index = 0; index < EPUB_LIMITS.files; index++)
      crowded.set(`extra-${index}`, new Uint8Array());
    expect(parseEpub(crowded)).toMatchObject({
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "archive_entries",
        stage: "archive",
        observed: EPUB_LIMITS.files + 1,
        limit: EPUB_LIMITS.files,
      },
    });
  });

  it("bounds aggregate ZIP expansion independently of individual entry sizes", () => {
    const entry = new Uint8Array(EPUB_LIMITS.entryBytes);
    const extra = new Map<string, Uint8Array>();
    for (let index = 0; index < 9; index++)
      extra.set(`expanded-${index}.bin`, entry);
    const files = fixture({ extra });
    const bytes = archive(files);
    expect(bytes.byteLength).toBeLessThan(EPUB_LIMITS.archiveBytes);
    for (const input of [bytes, files]) {
      const result = parseEpub(input);
      expect(result).toMatchObject({
        ok: false,
        reason: "too_long",
        diagnostic: {
          code: "expanded_bytes",
          stage: "archive",
          limit: EPUB_LIMITS.expandedBytes,
        },
      });
      if (result.ok) throw new Error("Expected expansion refusal");
      expect(result.diagnostic?.observed).toBeGreaterThan(
        EPUB_LIMITS.expandedBytes,
      );
    }
  });

  it("rejects excessive spine references before trying to resolve them", () => {
    const files = fixture();
    const bytes = files.get("OPS/package.opf");
    if (!bytes) throw new Error("Missing fixture package");
    files.set(
      "OPS/package.opf",
      strToU8(
        new TextDecoder()
          .decode(bytes)
          .replace(
            '<itemref idref="chapter-0"/>',
            '<itemref idref="missing"/>'.repeat(EPUB_LIMITS.spineItems + 1),
          ),
      ),
    );
    expect(parseEpub(files)).toMatchObject({
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "spine_items",
        stage: "package",
        observed: EPUB_LIMITS.spineItems + 1,
        limit: EPUB_LIMITS.spineItems,
      },
    });
  });

  it("refuses output that exceeds the unit byte budget after link rewriting", () => {
    const files = fixture({
      bodies: [
        `<p>${"z".repeat(109_000)}<a id="x"/>${'<a href="#x"/>'.repeat(6000)}</p>`,
      ],
    });
    const bytes = files.get("OPS/package.opf");
    const chapter = files.get("OPS/text/chapter-0.xhtml");
    if (!bytes || !chapter)
      throw new Error("Missing fixture package or chapter");
    files.set(
      "OPS/package.opf",
      strToU8(
        new TextDecoder()
          .decode(bytes)
          .replace('href="text/chapter-0.xhtml"', 'href="../a"'),
      ),
    );
    files.set("a", chapter);
    expect(parseEpub(files)).toMatchObject({
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "unit_bytes",
        stage: "units",
        observed: 404028,
        limit: EPUB_LIMITS.unitBytes,
      },
    });
  });

  it("rejects archive traversal paths and paragraphs that cannot fit a unit", () => {
    const files = fixture({ extra: new Map([["../outside", "unsafe"]]) });
    expect(parseEpub(archive(files))).toMatchObject({
      ok: false,
      reason: "not_epub",
      diagnostic: { code: "invalid_archive", stage: "archive" },
    });
    expect(
      parseEpub(
        fixture({
          bodies: [`<p>${"word ".repeat(EPUB_LIMITS.unitWords + 1)}</p>`],
        }),
      ),
    ).toMatchObject({
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "block_words",
        stage: "units",
        observed: EPUB_LIMITS.unitWords + 1,
        limit: EPUB_LIMITS.unitWords,
        spineIndex: 0,
        blockIndex: 0,
      },
    });
  });

  it("returns a typed refusal for deterministic damaged ZIP inputs rather than throwing", () => {
    const bytes = archive(fixture());
    for (let length = 0; length < bytes.length; length += 31)
      expect(parseEpub(bytes.slice(0, length)).ok).toBe(false);
    for (let length = 0; length < 512; length += 17) {
      const garbage = Uint8Array.from(
        { length },
        (_, index) => (index * 73 + length) % 256,
      );
      expect(parseEpub(garbage).ok).toBe(false);
    }
  });
});
