import { EPUB_LIMITS, openEpubArchive } from "./archive";
import type { EpubDiagnostic } from "./diagnostics";
import { parseEpubOutline } from "./outline";
import { checkEpubEncryption, parseEpubPackage } from "./package";
import { parseEpubSpineItem } from "./structure";
import type { EpubResult, EpubSpineItem, ParsedEpub } from "./types";
import { epubUnits } from "./units";

export function parseEpub(
  input: Uint8Array | ReadonlyMap<string, Uint8Array>,
  options: {
    readonly onMetadata?: (metadata: ParsedEpub["metadata"]) => void;
    readonly onStage?: (stage: EpubDiagnostic["stage"]) => void;
    readonly onDiagnostic?: (diagnostic: EpubDiagnostic) => void;
  } = {},
): EpubResult<ParsedEpub> {
  options.onStage?.("archive");
  const opened = openEpubArchive(input);
  if (!opened.ok)
    return withDiagnostic(opened, {
      code: "invalid_archive",
      stage: "archive",
    });
  const files = opened.value;
  options.onStage?.("package");
  const parsed = parseEpubPackage(files);
  if (!parsed.ok)
    return withDiagnostic(parsed, {
      code: "invalid_package",
      stage: "package",
    });
  const book = parsed.value;
  const metadata: ParsedEpub["metadata"] = {
    title: book.title,
    creators: book.creators,
    identifier: book.identifier,
    language: book.language,
  };
  options.onMetadata?.(metadata);
  options.onStage?.("encryption");
  const encryption = checkEpubEncryption(files, book.manifest);
  if (!encryption.ok)
    return withDiagnostic(encryption, {
      code: "protected_content",
      stage: "encryption",
    });
  options.onStage?.("navigation");
  const outline = parseEpubOutline(files, book, options.onDiagnostic);
  if (!outline.ok)
    return withDiagnostic(outline, {
      code: "invalid_navigation",
      stage: "navigation",
    });
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
  options.onStage?.("spine");
  for (const [readingIndex, item] of readingItems.entries()) {
    const index = spine.length;
    const optional = readingIndex >= book.spine.length;
    const bytes = files.get(item.href);
    if (!bytes && optional) continue;
    if (!bytes)
      return {
        ok: false,
        reason: "not_epub",
        diagnostic: {
          code: "invalid_spine",
          stage: "spine",
          spineIndex: index,
        },
      };
    const parsed = parseEpubSpineItem(bytes, item.href, index);
    if (!parsed.ok && optional && parsed.reason !== "too_long") continue;
    if (!parsed.ok)
      return withDiagnostic(parsed, {
        code: "invalid_spine",
        stage: "spine",
        spineIndex: index,
      });
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
              diagnostic: {
                code: "spine_items",
                stage: "spine",
                observed: readingItems.length + 1,
                limit: EPUB_LIMITS.spineItems,
              },
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
  options.onStage?.("units");
  const units = epubUnits(spine);
  if (!units.ok)
    return withDiagnostic(units, {
      code: "unexpected_failure",
      stage: "units",
    });
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
      metadata,
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

function withDiagnostic(
  failure: Extract<EpubResult<never>, { ok: false }>,
  fallback: EpubDiagnostic,
): Extract<EpubResult<never>, { ok: false }> {
  return { ...failure, diagnostic: { ...fallback, ...failure.diagnostic } };
}
