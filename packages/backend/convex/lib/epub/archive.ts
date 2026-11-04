import { unzipSync } from "fflate";
import type { EpubDiagnostic } from "./diagnostics";
import type { EpubResult } from "./types";

export const EPUB_LIMITS = {
  archiveBytes: 32 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  entryBytes: 8 * 1024 * 1024,
  files: 4096,
  spineItems: 2000,
  units: 2000,
  unitWords: 4000,
  unitBytes: 400_000,
  shortItemWords: 100,
};

export function resolveEpubHref(
  base: string,
  href: string,
): string | undefined {
  if (
    !href ||
    /[\\\p{Cc}\s]/u.test(href) ||
    /^[a-z][a-z\d+.-]*:|^\/\//iu.test(href)
  )
    return undefined;
  try {
    const encodedBase = base.split("/").map(encodeURIComponent).join("/");
    const url = new URL(href, `https://epub.invalid/${encodedBase}`);
    if (url.origin !== "https://epub.invalid") return undefined;
    const path = decodeURIComponent(url.pathname.slice(1));
    decodeURIComponent(url.hash.slice(1));
    if (!safeArchivePath(path)) return undefined;
    return `${path}${url.hash}`;
  } catch {
    return undefined;
  }
}

function safeArchivePath(path: string): boolean {
  return (
    !!path &&
    path !== "__proto__" &&
    !/[\\\p{Cc}?#]/u.test(path) &&
    !path.startsWith("/") &&
    !path.split("/").some((part) => part === ".." || part === ".")
  );
}

export function openEpubArchive(
  input: Uint8Array | ReadonlyMap<string, Uint8Array>,
): EpubResult<ReadonlyMap<string, Uint8Array>> {
  if (!(input instanceof Uint8Array)) return checkEntries(input);
  if (input.byteLength > EPUB_LIMITS.archiveBytes)
    return {
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "archive_bytes",
        stage: "archive",
        observed: input.byteLength,
        limit: EPUB_LIMITS.archiveBytes,
      },
    };
  try {
    let total = 0;
    let count = 0;
    let oversized: EpubDiagnostic | undefined;
    const header = new DataView(
      input.buffer,
      input.byteOffset,
      input.byteLength,
    );
    const markerOffset =
      input.length >= 30 ? 38 + header.getUint16(28, true) : 0;
    let invalid =
      input.length < 58 ||
      header.getUint32(0, true) !== 0x04034b50 ||
      header.getUint16(8, true) !== 0 ||
      header.getUint16(26, true) !== 8 ||
      new TextDecoder().decode(input.subarray(30, 38)) !== "mimetype" ||
      new TextDecoder().decode(
        input.subarray(markerOffset, markerOffset + 20),
      ) !== "application/epub+zip";
    const names = new Set<string>();
    unzipSync(input, {
      filter: (entry) => {
        total += entry.originalSize;
        count++;
        oversized ??= entryLimitDiagnostic(entry.originalSize, total, count);
        invalid ||=
          !safeArchivePath(entry.name) ||
          names.has(entry.name) ||
          (entry.name === "mimetype" && entry.compression !== 0) ||
          (entry.compression === 0 && entry.size !== entry.originalSize);
        names.add(entry.name);
        return false;
      },
    });
    if (oversized)
      return { ok: false, reason: "too_long", diagnostic: oversized };
    if (invalid)
      return {
        ok: false,
        reason: "not_epub",
        diagnostic: { code: "invalid_archive", stage: "archive" },
      };
    return checkEntries(new Map(Object.entries(unzipSync(input))));
  } catch {
    return {
      ok: false,
      reason: "unreadable",
      diagnostic: { code: "invalid_archive", stage: "archive" },
    };
  }
}

function checkEntries(
  entries: ReadonlyMap<string, Uint8Array>,
): EpubResult<ReadonlyMap<string, Uint8Array>> {
  let total = 0;
  let count = 0;
  let invalid = false;
  let oversized: EpubDiagnostic | undefined;
  for (const [path, bytes] of entries) {
    invalid ||= !safeArchivePath(path);
    total += bytes.byteLength;
    count++;
    oversized ??= entryLimitDiagnostic(bytes.byteLength, total, count);
  }
  if (oversized)
    return { ok: false, reason: "too_long", diagnostic: oversized };
  if (
    invalid ||
    !entries.has("META-INF/container.xml") ||
    entries.get("mimetype")?.byteLength !== 20 ||
    new TextDecoder().decode(entries.get("mimetype")) !== "application/epub+zip"
  )
    return {
      ok: false,
      reason: "not_epub",
      diagnostic: { code: "invalid_archive", stage: "archive" },
    };
  return { ok: true, value: entries };
}

function entryLimitDiagnostic(
  entryBytes: number,
  expandedBytes: number,
  count: number,
): EpubDiagnostic | undefined {
  if (entryBytes > EPUB_LIMITS.entryBytes)
    return {
      code: "entry_bytes",
      stage: "archive",
      observed: entryBytes,
      limit: EPUB_LIMITS.entryBytes,
    };
  if (expandedBytes > EPUB_LIMITS.expandedBytes)
    return {
      code: "expanded_bytes",
      stage: "archive",
      observed: expandedBytes,
      limit: EPUB_LIMITS.expandedBytes,
    };
  if (count > EPUB_LIMITS.files)
    return {
      code: "archive_entries",
      stage: "archive",
      observed: EPUB_LIMITS.files + 1,
      limit: EPUB_LIMITS.files,
    };
  return undefined;
}
