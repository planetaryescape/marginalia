// @vitest-environment happy-dom
import { strToU8, type Zippable, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readEpubMetadata } from "./epub-metadata";

const CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container";
const PACKAGE_NS = "http://www.idpf.org/2007/opf";
const DC_NS = "http://purl.org/dc/elements/1.1/";

function container(path = "OEBPS/content.opf") {
  return `<container xmlns="${CONTAINER_NS}" version="1.0"><rootfiles><rootfile full-path="${path}" media-type="application/oebps-package+xml"/></rootfiles></container>`;
}

function opf(
  metadata = "<dc:title>A Book</dc:title><dc:creator>A Writer</dc:creator>",
  version = "3.0",
) {
  return `<package xmlns="${PACKAGE_NS}" version="${version}"><metadata xmlns:dc="${DC_NS}">${metadata}</metadata><manifest/><spine/></package>`;
}

function epub(
  options: {
    path?: string;
    container?: string;
    opf?: string;
    entries?: Zippable;
    level?: 0 | 6;
  } = {},
) {
  const path = options.path ?? "OEBPS/content.opf";
  return zipSync(
    {
      "META-INF/container.xml": strToU8(options.container ?? container(path)),
      [path]: strToU8(options.opf ?? opf()),
      ...options.entries,
    },
    { level: options.level ?? 6 },
  );
}

function blob(data: Uint8Array) {
  return new Blob([Uint8Array.from(data)]);
}

function centralEntries(data: Uint8Array): number[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = data.length - 22;
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const offsets: number[] = [];
  for (let index = 0; index < count; index++) {
    offsets.push(cursor);
    cursor +=
      46 +
      view.getUint16(cursor + 28, true) +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true);
  }
  return offsets;
}

describe("readEpubMetadata", () => {
  it.each(["2.0", "3.0"])("reads EPUB %s metadata", async (version) => {
    expect(
      await readEpubMetadata(blob(epub({ opf: opf(undefined, version) }))),
    ).toEqual({
      title: "A Book",
      author: "A Writer",
    });
  });

  it.each([
    "",
    "\uFEFF",
  ])("reads XML declarations with UTF-8 BOM prefix %j", async (prefix) => {
    const declaration = `${prefix}<?xml version="1.0" encoding="UTF-8"?>\n`;
    const data = epub({
      container: `${declaration}${container()}`,
      opf: `${declaration}${opf()}`,
    });
    expect(await readEpubMetadata(blob(data))).toEqual({
      title: "A Book",
      author: "A Writer",
    });
  });

  it.each([
    "book.opf",
    "Books/Nested/BOOK.OPF",
    "Books/My Book.opf",
  ])("uses the exact referenced package location %s", async (path) => {
    expect(await readEpubMetadata(blob(epub({ path })))).toEqual({
      title: "A Book",
      author: "A Writer",
    });
  });

  it("normalizes whitespace and decodes built-in XML entities", async () => {
    const data = epub({
      opf: opf(
        "<dc:title> \n A &amp; B\t Book </dc:title><dc:creator>\t Jane \n Doe </dc:creator>",
      ),
    });
    expect(await readEpubMetadata(blob(data))).toEqual({
      title: "A & B Book",
      author: "Jane Doe",
    });
  });

  it("resolves URI-encoded package paths without changing archive entry names", async () => {
    expect(
      await readEpubMetadata(
        blob(
          epub({
            path: "Books/My Book.opf",
            container: container("Books/My%20Book.opf"),
          }),
        ),
      ),
    ).toEqual({ title: "A Book", author: "A Writer" });
  });

  it.each([
    "Books/%2e%2e/content.opf",
    "Books/%invalid.opf",
  ])("rejects unsafe or invalid encoded metadata references: %s", async (path) => {
    expect(
      await readEpubMetadata(blob(epub({ container: container(path) }))),
    ).toBeNull();
  });

  it("accepts title-only metadata and skips empty fields", async () => {
    expect(
      await readEpubMetadata(
        blob(
          epub({
            opf: opf(
              "<dc:title> </dc:title><dc:title>Useful</dc:title><dc:creator> </dc:creator>",
            ),
          }),
        ),
      ),
    ).toEqual({ title: "Useful" });
  });

  it("accepts a title without a creator element", async () => {
    expect(
      await readEpubMetadata(
        blob(epub({ opf: opf("<dc:title>Useful</dc:title>") })),
      ),
    ).toEqual({ title: "Useful" });
  });

  it("bounds normalized title and author lengths", async () => {
    const data = epub({
      opf: opf(
        `<dc:title>${"T".repeat(600)}</dc:title><dc:creator>${"A".repeat(600)}</dc:creator>`,
      ),
    });
    expect(await readEpubMetadata(blob(data))).toEqual({
      title: "T".repeat(500),
      author: "A".repeat(500),
    });
  });

  it("accepts equivalent namespace prefixes", async () => {
    const data = epub({
      container: `<c:container xmlns:c="${CONTAINER_NS}"><c:rootfiles><c:rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></c:rootfiles></c:container>`,
      opf: `<o:package xmlns:o="${PACKAGE_NS}"><o:metadata xmlns:d="${DC_NS}"><d:title>Prefixed</d:title></o:metadata></o:package>`,
    });
    expect(await readEpubMetadata(blob(data))).toEqual({ title: "Prefixed" });
  });

  it.each([
    opf(""),
    opf("<dc:title> \t </dc:title>"),
    opf("<title xmlns='urn:wrong'>Wrong namespace</title>"),
    opf().replace(PACKAGE_NS, "urn:wrong"),
    opf().replace("<package", "<wrong").replace("</package>", "</wrong>"),
    opf().replace("</dc:title>", "</dc:creator>"),
    "<package>",
    "not XML",
  ])("returns null for absent or invalid metadata: %s", async (value) => {
    expect(await readEpubMetadata(blob(epub({ opf: value })))).toBeNull();
  });

  it.each([
    container().replace(CONTAINER_NS, "urn:wrong"),
    container().replace("application/oebps-package+xml", "text/html"),
    container("missing.opf"),
    container("oebps/content.opf"),
    container("../content.opf"),
    container("https://example.com/book.opf"),
    "<container>",
  ])("rejects invalid container references: %s", async (value) => {
    expect(await readEpubMetadata(blob(epub({ container: value })))).toBeNull();
  });

  it.each([
    `<!DOCTYPE package [<!ENTITY name "unsafe">]>${opf("<dc:title>&name;</dc:title>")}`,
    `<!DOCTYPE package SYSTEM "https://example.com/evil.dtd">${opf()}`,
    `<!ENTITY name SYSTEM "file:///etc/passwd">${opf()}`,
  ])("rejects declarations without resolving them", async (value) => {
    expect(await readEpubMetadata(blob(epub({ opf: value })))).toBeNull();
  });

  it("rejects a doctype in the container", async () => {
    expect(
      await readEpubMetadata(
        blob(epub({ container: `<!DOCTYPE container>${container()}` })),
      ),
    ).toBeNull();
  });

  it("never needs chapter or image decompression", async () => {
    const data = epub({
      entries: {
        "OEBPS/chapter.xhtml": strToU8("chapter"),
        "OEBPS/cover.jpg": new Uint8Array([1, 2, 3]),
      },
    });
    const view = new DataView(data.buffer);
    for (const offset of centralEntries(data).slice(2))
      view.setUint16(offset + 10, 99, true);
    expect(await readEpubMetadata(blob(data))).toEqual({
      title: "A Book",
      author: "A Writer",
    });
  });

  it("rejects archives larger than 32 MiB", async () => {
    expect(
      await readEpubMetadata(
        blob(
          epub({
            level: 0,
            entries: { "chapter.xhtml": new Uint8Array(32 * 1024 * 1024) },
          }),
        ),
      ),
    ).toBeNull();
  });

  it.each([
    "container",
    "package",
  ])("rejects oversized %s XML before expansion", async (part) => {
    const padding = " ".repeat(1024 * 1024 + 1);
    const data = epub(
      part === "container"
        ? { container: `${container()}${padding}` }
        : { opf: `${opf()}${padding}` },
    );
    expect(await readEpubMetadata(blob(data))).toBeNull();
  });

  it("rejects a ZIP bomb using directory sizes without inflating it", async () => {
    const data = epub({ entries: { "bomb.bin": new Uint8Array(1) } });
    const offsets = centralEntries(data);
    const bomb = offsets[2];
    if (bomb === undefined) throw new Error("Missing generated bomb entry");
    new DataView(data.buffer).setUint32(bomb + 24, 64 * 1024 * 1024, true);
    expect(await readEpubMetadata(blob(data))).toBeNull();
  });

  it("rejects lying metadata expanded sizes with bounded streaming inflation", async () => {
    const data = epub({ opf: `${opf()}${" ".repeat(2 * 1024 * 1024)}` });
    const packageOffset = centralEntries(data)[1];
    if (packageOffset === undefined)
      throw new Error("Missing generated package");
    const view = new DataView(data.buffer);
    const local = view.getUint32(packageOffset + 42, true);
    view.setUint32(packageOffset + 24, 100, true);
    view.setUint32(local + 22, 100, true);
    expect(await readEpubMetadata(blob(data))).toBeNull();
  });

  it("rejects more than 4096 entries", async () => {
    const entries: Zippable = {};
    for (let i = 0; i < 4095; i++) entries[`item-${i}`] = new Uint8Array();
    expect(await readEpubMetadata(blob(epub({ entries })))).toBeNull();
  });

  it("rejects duplicate names in the directory", async () => {
    const data = epub({
      entries: { "same-a": new Uint8Array(), "same-b": new Uint8Array() },
    });
    const last = centralEntries(data).at(-1);
    if (last === undefined) throw new Error("Missing generated duplicate");
    data.set(strToU8("same-a"), last + 46);
    expect(await readEpubMetadata(blob(data))).toBeNull();
  });

  it.each([
    "../evil",
    "/evil",
    "a/../../evil",
    "a\\evil",
    "a/./evil",
    "a//evil",
    "C:/evil",
    "a\u0000evil",
  ])("rejects unsafe entry path %s", async (name) => {
    expect(
      await readEpubMetadata(
        blob(epub({ entries: { [name]: new Uint8Array() } })),
      ),
    ).toBeNull();
  });

  it("requires exact container filename casing", async () => {
    const data = zipSync({
      "meta-inf/container.xml": strToU8(container()),
      "OEBPS/content.opf": strToU8(opf()),
    });
    expect(await readEpubMetadata(blob(data))).toBeNull();
  });

  it.each([
    new Uint8Array(),
    strToU8("not a zip"),
    epub().subarray(0, 80),
  ])("returns null for invalid ZIP data", async (data) => {
    expect(await readEpubMetadata(blob(data))).toBeNull();
  });

  it("accepts stored metadata entries", async () => {
    expect(await readEpubMetadata(blob(epub({ level: 0 })))).toEqual({
      title: "A Book",
      author: "A Writer",
    });
  });
});
