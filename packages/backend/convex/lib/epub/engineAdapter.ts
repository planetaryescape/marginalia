import {
  EpubError,
  inspectEpubHeader,
  inspectEpubNavigation,
  inspectEpubPackage,
  openEpubArchive,
  packEpubReadingUnits,
  planEpubReadingDocument,
  projectEpubReadingDocument,
  UnitThresholdError,
} from "@planetaryescape/epub-engine";
import type { EpubDiagnostic } from "./diagnostics";

const encode = (text: string) => new TextEncoder().encode(text);
const maxWords = 4000;
const maxCombinedBytes = 400_000;
const documentOutputBytes = 8 * 1024 * 1024;
const maxUnits = 2000;
const shortChapterWords = 100;
const separator = "\n\n";
const anchorMarker = / data-epub-anchor="([^"]+)"/gu;
const linkMarker = / data-epub-link="([^"]+)"/gu;
const anchorId = (spineIndex: number, fragment: string) =>
  `epub-${spineIndex}-${fragment}`;

function importUnit(
  spineIndex: number,
  start: number,
  end: number,
  title: string,
  content: string,
  contentHtml: string,
  wordCount: number,
  combinedBytes: number,
) {
  return {
    title,
    content,
    contentHtml,
    sourceSpans: [{ spineIndex, start, end }],
    wordCount,
    combinedBytes,
  };
}

function firstHeading(
  document: Awaited<ReturnType<typeof projectEpubReadingDocument>>,
  plan: ReturnType<typeof planEpubReadingDocument>,
) {
  for (const { selection, range } of plan.blocks) {
    if (!range) continue;
    let children = document.content;
    for (const step of selection.parentPath) {
      const parent = children[step];
      if (parent?.kind !== "element")
        throw new EpubError("internal_error", undefined, "document");
      children = parent.children;
    }
    const heading = children[selection.start];
    if (heading?.kind === "element" && /^h[1-6]$/u.test(heading.name))
      return plan.view.text.slice(range.start, range.end);
  }
  return "";
}

function importMetadata(book: Awaited<ReturnType<typeof inspectEpubPackage>>) {
  return {
    title: book.metadata.titles[0] || "Untitled book",
    creators: book.metadata.creators,
    identifier: book.metadata.identifiers.find(
      (id) => id.id === book.metadata.uniqueIdentifierId,
    )?.value,
    language: book.metadata.languages[0],
  };
}

function blockDiagnostic(error: UnitThresholdError, spineIndex: number) {
  return Object.freeze({
    stage: "units",
    code: error.unitLimit.budget === "words" ? "block_words" : "block_bytes",
    observed: error.unitLimit.observed,
    limit: error.unitLimit.limit,
    spineIndex,
    blockIndex: error.blocks?.start ?? 0,
  });
}

async function projectMarginaliaImport(
  bytes: Uint8Array,
  onMetadata?: (metadata: ReturnType<typeof importMetadata>) => void,
  onBlockLimit?: (diagnostic: ReturnType<typeof blockDiagnostic>) => void,
  onStage?: (stage: EpubDiagnostic["stage"]) => void,
  onNavigationFallback?: () => void,
) {
  const source = { kind: "zip", bytes } satisfies Parameters<
    typeof inspectEpubPackage
  >[0];
  onStage?.("package");
  const book = await inspectEpubPackage(source);
  const metadata = importMetadata(book);
  onMetadata?.(metadata);
  onStage?.("encryption");
  if (book.protection.kind === "protected")
    throw new EpubError("protected_publication", undefined, "package");
  onStage?.("navigation");
  const navigation = await inspectEpubNavigation(source, { fallback: "ncx" });
  if (navigation.diagnostics?.length) onNavigationFallback?.();
  const titles = new Map<string, string>();
  if (navigation.kind !== "absent") {
    const pending = [...navigation.entries].reverse();
    while (pending.length) {
      const entry = pending.pop();
      if (!entry) break;
      if (
        entry.target?.kind === "local" &&
        !titles.has(entry.target.resourcePath)
      ) {
        titles.set(entry.target.resourcePath, entry.label);
      }
      for (const child of [...entry.children].reverse()) pending.push(child);
    }
  }
  const spine = [];
  const units: ReturnType<typeof importUnit>[] = [];
  const spineByPath = new Map<string, number>();
  const localDocuments = new Map(
    book.manifest.flatMap((item) =>
      item.target.kind === "local" &&
      item.target.availability === "present" &&
      item.mediaType === "application/xhtml+xml" &&
      !item.properties.includes("nav")
        ? [[encodeURIComponent(item.target.path), item.id]]
        : [],
    ),
  );
  const readingIds = book.spine.map((item) => item.idref);
  const enqueued = new Set(readingIds);
  for (const [spineIndex, id] of readingIds.entries()) {
    onStage?.("spine");
    const reading = await projectEpubReadingDocument(source, id, {
      policy: "safe-semantic-preserve-text-v1",
      includeImages: true,
      allowMissingHead: true,
      documentOutputBytes,
      packageLimits: { xmlTokenUnits: 262_144 },
    });
    onStage?.("units");
    const plan = planEpubReadingDocument(reading, {
      policy: "semantic-block-plan-v1",
      splitListItems: true,
      documentOutputBytes,
    });
    const openUnit = units.at(-1);
    let packed: ReturnType<typeof packEpubReadingUnits>;
    try {
      packed = packEpubReadingUnits(reading, plan, {
        policy: "balanced-block-pack-v1",
        maxWords,
        maxCombinedBytes,
        maxUnits,
        documentOutputBytes,
        includeLinkMetadata: true,
        preferLongestPrefix: true,
        ...(openUnit && openUnit.wordCount < shortChapterWords
          ? {
              firstUnitCapacity: {
                maxWords: maxWords - openUnit.wordCount,
                maxCombinedBytes: Math.max(
                  0,
                  maxCombinedBytes - openUnit.combinedBytes - separator.length,
                ),
              },
            }
          : {}),
      });
    } catch (error) {
      if (error instanceof UnitThresholdError)
        onBlockLimit?.(blockDiagnostic(error, spineIndex));
      throw error;
    }
    const path = encodeURIComponent(reading.source.identity.resourcePath);
    if (!spineByPath.has(path)) spineByPath.set(path, spineIndex);
    const title =
      titles.get(reading.source.identity.resourcePath) ??
      (firstHeading(reading, plan) || `Part ${spineIndex + 1}`);
    spine.push({
      text: plan.view.text,
      href: reading.source.identity.resourcePath,
      title,
    });
    for (const [
      index,
      { range, text, html, wordCount, combinedBytes },
    ] of packed.units.entries()) {
      for (const match of html.matchAll(linkMarker)) {
        const path = match[1]?.split("#", 1)[0];
        const linked =
          path === undefined ? undefined : localDocuments.get(path);
        if (!linked || enqueued.has(linked)) continue;
        if (readingIds.length === 2000)
          throw new EpubError("limit_exceeded", undefined, "document");
        enqueued.add(linked);
        readingIds.push(linked);
      }
      if (!text.trim()) continue;
      if (!range) throw new EpubError("internal_error", undefined, "document");
      const { start, end } = range;
      if (plan.view.text.slice(start, end) !== text)
        throw new EpubError("internal_error", undefined, "document");
      const sourceSpan = { spineIndex, start, end };
      const anchoredHtml = html.replace(
        anchorMarker,
        (_marker, fragments: string) =>
          ` id="${anchorId(spineIndex, fragments.split(" ", 1)[0] ?? "")}"`,
      );
      const prior = units.at(-1);
      const mergedBytes =
        (prior?.combinedBytes ?? 0) + separator.length + combinedBytes;
      if (
        index === 0 &&
        prior &&
        prior.wordCount < shortChapterWords &&
        prior.wordCount + wordCount <= maxWords &&
        mergedBytes <= maxCombinedBytes
      ) {
        prior.title = title;
        prior.content += separator + text;
        prior.contentHtml += anchoredHtml;
        prior.sourceSpans.push(sourceSpan);
        prior.wordCount += wordCount;
        prior.combinedBytes = mergedBytes;
      } else {
        if (units.length === maxUnits)
          throw new EpubError("limit_exceeded", undefined, "document");
        units.push(
          importUnit(
            spineIndex,
            start,
            end,
            title,
            text,
            anchoredHtml,
            wordCount,
            combinedBytes,
          ),
        );
      }
    }
  }
  const firstUnitBySpine = new Map<number, number>();
  const unitByAnchor = new Map<string, number>();
  for (const [index, unit] of units.entries()) {
    for (const { spineIndex } of unit.sourceSpans) {
      if (!firstUnitBySpine.has(spineIndex))
        firstUnitBySpine.set(spineIndex, index);
    }
    for (const match of unit.contentHtml.matchAll(/ id="([^"]+)"/gu)) {
      const id = match[1];
      if (id && !unitByAnchor.has(id)) unitByAnchor.set(id, index);
    }
  }
  for (const unit of units) {
    unit.contentHtml = unit.contentHtml.replace(
      linkMarker,
      (_marker, target: string) => {
        const [path, fragment] = target.split("#");
        const spineIndex =
          path === undefined ? undefined : spineByPath.get(path);
        if (spineIndex === undefined) return "";
        if (!fragment) {
          const index = firstUnitBySpine.get(spineIndex);
          return index === undefined ? "" : ` href="?unit=${index}"`;
        }
        const id = anchorId(spineIndex, fragment);
        const index = unitByAnchor.get(id);
        return index === undefined
          ? ""
          : ` href="?unit=${index}#${encodeURIComponent(id)}"`;
      },
    );
    if (
      encode(unit.contentHtml).length + encode(unit.content).length >
      maxCombinedBytes
    ) {
      throw new EpubError("limit_exceeded", undefined, "document");
    }
  }
  const paths = new Set<string>();
  for (const unit of units) {
    for (const match of unit.contentHtml.matchAll(
      / data-epub-image="([^"]+)"/gu,
    )) {
      if (match[1]) paths.add(decodeURIComponent(match[1]));
    }
  }
  onStage?.("images");
  const images = [];
  if (paths.size) {
    const archive = await openEpubArchive(source);
    try {
      for (const item of book.manifest) {
        if (item.target.kind !== "local" || !paths.has(item.target.path))
          continue;
        images.push({
          href: item.target.path,
          mediaType: item.mediaType,
          bytes: await archive.read(item.target.path),
        });
      }
    } finally {
      await archive.close();
    }
  }
  return {
    metadata,
    spine,
    images,
    units: units.map((unit) => ({
      title: unit.title,
      content: unit.content,
      contentHtml: unit.contentHtml,
      wordCount: unit.wordCount,
      sourceSpans: unit.sourceSpans,
      estimatedReadMinutes: Math.max(1, Math.ceil(unit.wordCount / 220)),
    })),
  };
}

export async function parseMarginaliaImport(
  bytes: Uint8Array,
  onMetadata?: Parameters<typeof projectMarginaliaImport>[1],
  onStage?: (stage: EpubDiagnostic["stage"]) => void,
  onNavigationFallback?: () => void,
) {
  let diagnostic: ReturnType<typeof blockDiagnostic> | undefined;
  try {
    const value = await projectMarginaliaImport(
      bytes,
      onMetadata,
      (value) => {
        diagnostic = value;
      },
      onStage,
      onNavigationFallback,
    );
    if (!value.units.length)
      return Object.freeze({
        ok: false,
        reason: "empty",
        diagnostic: undefined,
      });
    return Object.freeze({ ok: true, value });
  } catch (error) {
    if (
      !(error instanceof EpubError) ||
      error.code === "internal_error" ||
      error.code === "cancelled"
    )
      throw error;
    switch (error.code) {
      case "limit_exceeded":
        return Object.freeze({ ok: false, reason: "too_long", diagnostic });
      case "protected_publication":
        return Object.freeze({
          ok: false,
          reason: "protected",
          diagnostic: undefined,
        });
      case "invalid_header":
      case "invalid_mimetype":
      case "invalid_container":
      case "invalid_package":
      case "invalid_spine":
      case "unsafe_path":
      case "duplicate_entry":
        return Object.freeze({
          ok: false,
          reason: "not_epub",
          diagnostic: undefined,
        });
      case "invalid_archive":
        if (bytes.length >= 30) {
          try {
            await inspectEpubHeader(bytes);
          } catch (header) {
            if (
              header instanceof EpubError &&
              (header.code === "invalid_header" ||
                header.code === "invalid_mimetype")
            ) {
              return Object.freeze({
                ok: false,
                reason: "not_epub",
                diagnostic: undefined,
              });
            }
          }
        }
        return Object.freeze({
          ok: false,
          reason: "unreadable",
          diagnostic: undefined,
        });
      default:
        return Object.freeze({
          ok: false,
          reason: "unreadable",
          diagnostic: undefined,
        });
    }
  }
}
