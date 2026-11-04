import { strToU8, type Zippable, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseEpub } from "./parse";
import { parseEpubXml } from "./xml";

function fixture() {
  return new Map([
    ["mimetype", strToU8("application/epub+zip")],
    [
      "META-INF/container.xml",
      strToU8(
        '<container><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      ),
    ],
    [
      "book.opf",
      strToU8(
        '<package><metadata/><manifest><item id="first" href="first.xhtml" media-type="application/xhtml+xml"/><item id="second" href="second.xhtml" media-type="application/xhtml+xml"/><item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/><item id="font" href="font.otf" media-type="font/otf"/></manifest><spine><itemref idref="second"/><itemref idref="first"/></spine></package>',
      ),
    ],
    ["first.xhtml", strToU8("<html><body><h1>First</h1></body></html>")],
    [
      "second.xhtml",
      strToU8(
        '<html><body><h1>Second</h1><p id="back"><a href="notes.xhtml#note">Note</a></p></body></html>',
      ),
    ],
    [
      "notes.xhtml",
      strToU8(
        '<html><body><p id="note">Footnote <a href="second.xhtml#back">Back</a></p></body></html>',
      ),
    ],
  ]);
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

describe("PR98 round-three regressions", () => {
  it("keeps linked notes as destinations without adding fallback chapters", () => {
    const files = fixture();
    for (const input of [files, archive(files)]) {
      const result = parseEpub(input);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Generated fixture refused");
      const book = result.value;
      expect(book.outline).toEqual([
        { title: "Second", href: "second.xhtml", depth: 0 },
        { title: "First", href: "first.xhtml", depth: 0 },
      ]);
      expect(book.spine.map((item) => item.href)).toEqual([
        "second.xhtml",
        "first.xhtml",
        "notes.xhtml",
      ]);
      const html = book.units.map((unit) => unit.contentHtml).join("");
      expect(html).toContain('#epub-2-note"');
      expect(html).toContain('id="epub-2-note"');
      expect(html).toContain('#epub-0-back"');
      for (const unit of book.units)
        expect(unit.content).toBe(
          unit.sourceSpans
            .map((span) =>
              book.spine[span.spineIndex]?.text.slice(span.start, span.end),
            )
            .join("\n\n"),
        );
    }
  });

  it("allows exactly one documented font method and one font reference", () => {
    const idpf = "http://www.idpf.org/2008/embedding";
    const adobe = "http://ns.adobe.com/pdf/enc#RC";
    const drm = "http://www.w3.org/2001/04/xmlenc#aes128-cbc";
    for (const { methods, targets, allowed } of [
      { methods: [idpf], targets: ["font.otf"], allowed: true },
      { methods: [adobe], targets: ["font.otf"], allowed: true },
      { methods: [idpf, drm], targets: ["font.otf"], allowed: false },
      { methods: [drm, idpf], targets: ["font.otf"], allowed: false },
      { methods: [idpf, adobe], targets: ["font.otf"], allowed: false },
      { methods: [], targets: ["font.otf"], allowed: false },
      { methods: [idpf], targets: [], allowed: false },
      { methods: [idpf], targets: ["first.xhtml"], allowed: false },
      {
        methods: [idpf],
        targets: ["font.otf", "first.xhtml"],
        allowed: false,
      },
      {
        methods: [idpf],
        targets: ["first.xhtml", "font.otf"],
        allowed: false,
      },
      {
        methods: [idpf],
        targets: ["font.otf", "font.otf"],
        allowed: false,
      },
    ]) {
      const files = fixture();
      files.set(
        "META-INF/encryption.xml",
        strToU8(
          `<encryption><EncryptedData>${methods.map((algorithm) => `<EncryptionMethod Algorithm="${algorithm}"/>`).join("")}<CipherData>${targets.map((uri) => `<CipherReference URI="${uri}"/>`).join("")}</CipherData></EncryptedData></encryption>`,
        ),
      );
      for (const input of [files, archive(files)]) {
        const result = parseEpub(input);
        if (allowed) expect(result.ok).toBe(true);
        else expect(result).toMatchObject({ ok: false, reason: "protected" });
      }
    }
  });

  it.each([
    "text",
    "<![CDATA[text]]>",
    "<!--text-->",
    "<?note text?>",
    "",
  ])("counts element depth consistently for deepest content %s", (content) => {
    for (const depth of [127, 128, 129]) {
      const result = parseEpubXml(
        strToU8(
          `${"<r>".repeat(depth + 1)}${content}${"</r>".repeat(depth + 1)}`,
        ),
      );
      if (depth <= 128) expect(result.ok).toBe(true);
      else expect(result).toMatchObject({ ok: false, reason: "too_long" });
    }
  });
});
