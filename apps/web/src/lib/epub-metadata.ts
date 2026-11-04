import { Inflate } from "fflate";

const ARCHIVE_BYTES = 32 * 1024 * 1024;
const EXPANDED_BYTES = 64 * 1024 * 1024;
const METADATA_BYTES = 1024 * 1024;
const MAX_ENTRIES = 4096;
const CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container";
const PACKAGE_NS = "http://www.idpf.org/2007/opf";
const DC_NS = "http://purl.org/dc/elements/1.1/";
const decoder = new TextDecoder("utf-8", { fatal: true });

type Entry = {
  readonly name: string;
  readonly size: number;
  readonly expanded: number;
  readonly compression: number;
  readonly flags: number;
  readonly offset: number;
  readonly boundary: number;
};

function safePath(path: string): boolean {
  if (!path || /[\\\p{Cc}:?#]/u.test(path) || path.startsWith("/"))
    return false;
  const parts = path.replace(/\/$/u, "").split("/");
  return !parts.some((part) => !part || part === "." || part === "..");
}

async function bytes(file: Blob, start: number, length: number) {
  return new Uint8Array(await file.slice(start, start + length).arrayBuffer());
}

async function directory(file: Blob): Promise<Map<string, Entry> | null> {
  if (file.size < 22 || file.size > ARCHIVE_BYTES) return null;
  const tailStart = Math.max(0, file.size - 65557);
  const tail = await bytes(file, tailStart, file.size - tailStart);
  const footer = new DataView(tail.buffer);
  let end = tail.length - 22;
  while (
    end >= 0 &&
    (footer.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + footer.getUint16(end + 20, true) !== tail.length)
  )
    end--;
  if (end < 0) return null;
  const count = footer.getUint16(end + 10, true);
  const size = footer.getUint32(end + 12, true);
  const offset = footer.getUint32(end + 16, true);
  if (
    footer.getUint16(end + 4, true) !== 0 ||
    footer.getUint16(end + 6, true) !== 0 ||
    footer.getUint16(end + 8, true) !== count ||
    count > MAX_ENTRIES ||
    offset + size !== tailStart + end
  )
    return null;
  const data = await bytes(file, offset, size);
  const view = new DataView(data.buffer);
  const entries = new Map<string, Entry>();
  let cursor = 0;
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (
      cursor + 46 > data.length ||
      view.getUint32(cursor, true) !== 0x02014b50
    )
      return null;
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > data.length || view.getUint16(cursor + 34, true) !== 0)
      return null;
    const name = decoder.decode(
      data.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    const entry: Entry = {
      name,
      flags: view.getUint16(cursor + 8, true),
      compression: view.getUint16(cursor + 10, true),
      size: view.getUint32(cursor + 20, true),
      expanded: view.getUint32(cursor + 24, true),
      offset: view.getUint32(cursor + 42, true),
      boundary: offset,
    };
    total += entry.expanded;
    if (
      !safePath(name) ||
      entries.has(name) ||
      total > EXPANDED_BYTES ||
      (entry.flags & 1) !== 0 ||
      entry.offset + 30 + entry.size > offset ||
      (entry.compression === 0 && entry.size !== entry.expanded)
    )
      return null;
    entries.set(name, entry);
    cursor = next;
  }
  return cursor === data.length ? entries : null;
}

async function readXml(file: Blob, entry: Entry): Promise<Document | null> {
  if (
    entry.expanded > METADATA_BYTES ||
    entry.size > METADATA_BYTES ||
    (entry.compression !== 0 && entry.compression !== 8)
  )
    return null;
  const header = await bytes(file, entry.offset, 30);
  if (header.length !== 30) return null;
  const view = new DataView(header.buffer);
  const nameLength = view.getUint16(26, true);
  const start = entry.offset + 30 + nameLength + view.getUint16(28, true);
  if (
    view.getUint32(0, true) !== 0x04034b50 ||
    view.getUint16(6, true) !== entry.flags ||
    view.getUint16(8, true) !== entry.compression ||
    start + entry.size > entry.boundary ||
    ((entry.flags & 8) === 0 &&
      (view.getUint32(18, true) !== entry.size ||
        view.getUint32(22, true) !== entry.expanded))
  )
    return null;
  const name = decoder.decode(await bytes(file, entry.offset + 30, nameLength));
  if (name !== entry.name) return null;
  const compressed = await bytes(file, start, entry.size);
  let output = compressed;
  if (entry.compression === 8) {
    const chunks: Uint8Array[] = [];
    let length = 0;
    const inflate = new Inflate((chunk) => {
      length += chunk.length;
      if (length <= entry.expanded) chunks.push(chunk);
    });
    for (let offset = 0; offset < compressed.length; offset += 256) {
      inflate.push(
        compressed.subarray(offset, offset + 256),
        offset + 256 >= compressed.length,
      );
      if (length > entry.expanded) return null;
    }
    if (length !== entry.expanded) return null;
    output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
  }
  if (output.length !== entry.expanded) return null;
  const text = decoder.decode(output);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(text)) return null;
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (
    !document.documentElement ||
    document.doctype ||
    document.getElementsByTagNameNS("*", "parsererror").length
  )
    return null;
  return document;
}

function children(
  element: Element,
  namespace: string,
  name: string,
): Element[] {
  return Array.from(element.children).filter(
    (child) => child.namespaceURI === namespace && child.localName === name,
  );
}

function metadataText(element: Element, name: string): string | undefined {
  for (const child of children(element, DC_NS, name)) {
    const value = child.textContent?.replace(/\s+/gu, " ").trim();
    if (value) return value.slice(0, 500).trim().toWellFormed();
  }
  return undefined;
}

export async function readEpubMetadata(
  file: Blob,
): Promise<{ title: string; author?: string } | null> {
  try {
    const entries = await directory(file);
    const containerEntry = entries?.get("META-INF/container.xml");
    if (!entries || !containerEntry) return null;
    const container = await readXml(file, containerEntry);
    const root = container?.documentElement;
    if (root?.namespaceURI !== CONTAINER_NS || root.localName !== "container")
      return null;
    const rootfiles = children(root, CONTAINER_NS, "rootfiles")[0];
    if (!rootfiles) return null;
    const rootfile = children(rootfiles, CONTAINER_NS, "rootfile").find(
      (element) =>
        element.getAttribute("media-type") === "application/oebps-package+xml",
    );
    const reference = rootfile?.getAttribute("full-path");
    if (!reference) return null;
    const path = decodeURIComponent(reference);
    if (!safePath(path)) return null;
    const packageEntry = entries.get(path);
    if (!packageEntry) return null;
    const opf = await readXml(file, packageEntry);
    const packageRoot = opf?.documentElement;
    if (
      packageRoot?.namespaceURI !== PACKAGE_NS ||
      packageRoot.localName !== "package"
    )
      return null;
    const metadata = children(packageRoot, PACKAGE_NS, "metadata")[0];
    if (!metadata) return null;
    const title = metadataText(metadata, "title");
    if (!title) return null;
    const author = metadataText(metadata, "creator");
    return author ? { title, author } : { title };
  } catch {
    return null;
  }
}
