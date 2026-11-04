import { strToU8, type Zippable, zipSync } from "fflate";
import { expect, it } from "vitest";
import { resolveEpubHref } from "./archive";
import { parseEpub } from "./parse";

function encodedPath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

it.each([
  { directory: "", chapter: "chapter%20one.xhtml" },
  { directory: "text%20/", chapter: "chapter.xhtml" },
  { directory: "text%2f/", chapter: "chapter%25.xhtml" },
  { directory: "résumé%20/", chapter: "chapter%.xhtml" },
])("preserves canonical percent paths in $directory$chapter", ({
  directory,
  chapter,
}) => {
  const chapterPath = `${directory}${chapter}`;
  const notesPath = `${directory}notes.xhtml`;
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
        `<package><metadata/><manifest><item id="chapter" href="${encodedPath(chapterPath)}" media-type="application/xhtml+xml"/><item id="notes" href="${encodedPath(notesPath)}" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
      ),
    ],
    [
      chapterPath,
      strToU8(
        '<html><body><h1>Generated chapter</h1><p id="reference"><a href="#local-note">Local note</a> <a href="notes.xhtml#linked-note">Linked note</a></p><aside id="local-note">A local note.</aside></body></html>',
      ),
    ],
    [
      notesPath,
      strToU8(
        `<html><body><p id="linked-note">A linked note. <a href="${encodeURIComponent(chapter)}#reference">Return</a></p></body></html>`,
      ),
    ],
  ]);
  const entries: Zippable = {};
  for (const [path, bytes] of files)
    Object.defineProperty(entries, path, {
      value: [bytes, { level: path === "mimetype" ? 0 : 6 }],
      enumerable: true,
    });

  expect(resolveEpubHref(chapterPath, "#local-note")).toBe(
    `${chapterPath}#local-note`,
  );
  expect(resolveEpubHref(chapterPath, "notes.xhtml#linked-note")).toBe(
    `${notesPath}#linked-note`,
  );
  expect(resolveEpubHref(chapterPath, "images/chart.png")).toBe(
    `${directory}images/chart.png`,
  );
  for (const input of [files, zipSync(entries)]) {
    const parsed = parseEpub(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("Generated fixture refused");
    expect(parsed.value.spine.map((item) => item.href)).toEqual([
      chapterPath,
      notesPath,
    ]);
    const html = parsed.value.units.map((unit) => unit.contentHtml).join("");
    expect(html).toContain('#epub-0-local-note"');
    expect(html).toContain('#epub-1-linked-note"');
    expect(html).toContain('#epub-0-reference"');
  }
});
