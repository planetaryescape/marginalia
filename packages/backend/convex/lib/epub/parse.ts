import { EPUB_LIMITS, openEpubArchive } from "./archive";
import { parseEpubOutline } from "./outline";
import { checkEpubEncryption, parseEpubPackage } from "./package";
import { parseEpubSpineItem } from "./structure";
import type { EpubResult, EpubSpineItem, ParsedEpub } from "./types";
import { epubUnits } from "./units";

export function parseEpub(
  input: Uint8Array | ReadonlyMap<string, Uint8Array>,
): EpubResult<ParsedEpub> {
  const opened = openEpubArchive(input);
  if (!opened.ok) return opened;
  const files = opened.value;
  const parsed = parseEpubPackage(files);
  if (!parsed.ok) return parsed;
  const book = parsed.value;
  const encryption = checkEpubEncryption(files, book.manifest);
  if (!encryption.ok) return encryption;
  const outline = parseEpubOutline(files, book);
  if (!outline.ok) return outline;
  const spine: EpubSpineItem[] = [];
  const titlesByHref = new Map<string, string>();
  for (const entry of outline.value) {
    const href = entry.href.split("#")[0];
    if (href && !titlesByHref.has(href)) titlesByHref.set(href, entry.title);
  }
  const readingItems = [...book.spine];
  const readingHrefs = new Set(readingItems.map((item) => item.href));
  const manifestByHref = new Map(
    book.manifest.map((item) => [item.href, item]),
  );
  for (const [readingIndex, item] of readingItems.entries()) {
    const index = spine.length;
    const optional = readingIndex >= book.spine.length;
    const bytes = files.get(item.href);
    if (!bytes && optional) continue;
    if (!bytes) return { ok: false, reason: "not_epub" };
    const parsed = parseEpubSpineItem(bytes, item.href, index);
    if (!parsed.ok && optional && parsed.reason !== "too_long") continue;
    if (!parsed.ok) return parsed;
    for (const block of parsed.value.blocks) {
      for (const match of block.html.matchAll(/ data-epub-href="([^"]+)"/gu)) {
        const href = decodeURIComponent(match[1] ?? "").split("#")[0];
        const target = href ? manifestByHref.get(href) : undefined;
        if (
          target?.mediaType === "application/xhtml+xml" &&
          !target.properties.includes("nav") &&
          !readingHrefs.has(target.href)
        ) {
          if (readingItems.length >= EPUB_LIMITS.spineItems)
            return {
              ok: false,
              reason: "too_long",
            };
          readingItems.push(target);
          readingHrefs.add(target.href);
        }
      }
    }
    spine.push({
      ...parsed.value,
      title: titlesByHref.get(item.href) ?? parsed.value.title,
    });
  }
  const units = epubUnits(spine);
  if (!units.ok) return units;
  const images: { href: string; mediaType: string; bytes: Uint8Array }[] = [];
  const imageTypes = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ]);
  const seen = new Set<string>();
  for (const item of book.manifest) {
    const bytes = files.get(item.href);
    if (bytes && imageTypes.has(item.mediaType) && !seen.has(item.href)) {
      images.push({ href: item.href, mediaType: item.mediaType, bytes });
      seen.add(item.href);
    }
  }
  return {
    ok: true,
    value: {
      metadata: {
        title: book.title,
        creators: book.creators,
        identifier: book.identifier,
        language: book.language,
      },
      manifest: book.manifest,
      images,
      spine,
      outline: outline.value.length
        ? outline.value
        : spine.slice(0, book.spine.length).map((item) => ({
            title: item.title,
            href: item.href,
            depth: 0,
          })),
      units: units.value,
    },
  };
}
