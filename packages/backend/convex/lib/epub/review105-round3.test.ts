import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { EPUB_LIMITS, openEpubArchive } from "./archive";
import { parseEpub } from "./parse";

class BoundedEntries extends Map<string, Uint8Array> {
  visited = 0;

  override *[Symbol.iterator]() {
    for (const entry of super[Symbol.iterator]()) {
      if (++this.visited > EPUB_LIMITS.files + 1)
        throw new Error("Traversed beyond the archive entry ceiling");
      yield entry;
    }
    return undefined;
  }
}

describe("PR105 round-three regressions", () => {
  it("stops Map traversal at the first failure without changing precedence", () => {
    for (const oversizedFirst of [false, true]) {
      const files = new BoundedEntries();
      if (oversizedFirst)
        files.set("large", new Uint8Array(EPUB_LIMITS.entryBytes + 1));
      for (let index = 0; index < EPUB_LIMITS.files + 100; index++)
        files.set(`entry-${index}`, new Uint8Array());
      expect(openEpubArchive(files)).toMatchObject({
        ok: false,
        reason: "too_long",
        diagnostic: {
          code: oversizedFirst ? "entry_bytes" : "archive_entries",
          stage: "archive",
          observed: oversizedFirst
            ? EPUB_LIMITS.entryBytes + 1
            : EPUB_LIMITS.files + 1,
          limit: oversizedFirst ? EPUB_LIMITS.entryBytes : EPUB_LIMITS.files,
        },
      });
      expect(files.visited).toBe(oversizedFirst ? 1 : EPUB_LIMITS.files + 1);
    }
  });

  it("identifies the spine item whose linked destination exceeds the item ceiling", () => {
    const files = new Map([
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
          `<package><metadata/><manifest><item id="first" href="first.xhtml" media-type="application/xhtml+xml"/><item id="second" href="second.xhtml" media-type="application/xhtml+xml"/><item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="first"/>${'<itemref idref="second"/>'.repeat(EPUB_LIMITS.spineItems - 1)}</spine></package>`,
        ),
      ],
      ["first.xhtml", strToU8("<html><body><p>First.</p></body></html>")],
      [
        "second.xhtml",
        strToU8(
          '<html><body><p><a href="notes.xhtml#note">Note</a></p></body></html>',
        ),
      ],
      [
        "notes.xhtml",
        strToU8('<html><body><p id="note">Note.</p></body></html>'),
      ],
    ]);
    expect(parseEpub(files)).toEqual({
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "spine_items",
        stage: "spine",
        observed: EPUB_LIMITS.spineItems + 1,
        limit: EPUB_LIMITS.spineItems,
        spineIndex: 1,
      },
    });
  });
});
