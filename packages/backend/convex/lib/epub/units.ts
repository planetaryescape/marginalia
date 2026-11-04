import { WORDS_PER_MINUTE } from "../constants";
import { EPUB_LIMITS } from "./archive";
import { epubAnchor } from "./structure";
import type { EpubResult, EpubSpineItem, EpubUnit, SourceSpan } from "./types";

const wordsOf = (text: string) =>
  text.trim() ? text.trim().split(/\s+/u).length : 0;
const bytesOf = (html: string, text: string) =>
  new TextEncoder().encode(html).length + new TextEncoder().encode(text).length;

export function epubUnits(
  spine: readonly EpubSpineItem[],
): EpubResult<readonly EpubUnit[]> {
  const units: EpubUnit[] = [];
  const targets = new Map<string, number>();
  let html = "";
  let text = "";
  let title = "";
  let sourceSpans: SourceSpan[] = [];
  let pendingTargets = new Set<string>();
  const close = () => {
    if (text.trim()) {
      for (const target of pendingTargets) {
        if (!targets.has(target)) targets.set(target, units.length);
      }
      units.push({
        title,
        content: text,
        contentHtml: html,
        wordCount: wordsOf(text),
        estimatedReadMinutes: Math.max(
          1,
          Math.ceil(wordsOf(text) / WORDS_PER_MINUTE),
        ),
        sourceSpans,
      });
    }
    html = "";
    text = "";
    title = "";
    sourceSpans = [];
    pendingTargets = new Set();
  };
  for (const [spineIndex, item] of spine.entries()) {
    if (wordsOf(text) >= EPUB_LIMITS.shortItemWords) close();
    if (!title || wordsOf(text) < EPUB_LIMITS.shortItemWords)
      title = item.title;
    for (const [blockIndex, block] of item.blocks.entries()) {
      const observedWords = wordsOf(block.text);
      const observedBytes = bytesOf(block.html, block.text);
      if (observedWords > EPUB_LIMITS.unitWords)
        return {
          ok: false,
          reason: "too_long",
          diagnostic: {
            code: "block_words",
            stage: "units",
            observed: observedWords,
            limit: EPUB_LIMITS.unitWords,
            spineIndex,
            blockIndex,
          },
        };
      if (observedBytes > EPUB_LIMITS.unitBytes)
        return {
          ok: false,
          reason: "too_long",
          diagnostic: {
            code: "block_bytes",
            stage: "units",
            observed: observedBytes,
            limit: EPUB_LIMITS.unitBytes,
            spineIndex,
            blockIndex,
          },
        };
      const previousSpan = sourceSpans.at(-1);
      const separator = html
        ? previousSpan?.spineIndex === spineIndex
          ? item.text.slice(previousSpan.end, block.start)
          : "\n\n"
        : "";
      if (
        html &&
        (wordsOf(`${text}${separator}${block.text}`) > EPUB_LIMITS.unitWords ||
          bytesOf(html + block.html, `${text}${separator}${block.text}`) >
            EPUB_LIMITS.unitBytes)
      ) {
        close();
        title = item.title;
      }
      pendingTargets.add(item.href);
      for (const match of block.html.matchAll(/ id="([^"]+)"/gu)) {
        const id = match[1];
        if (id) pendingTargets.add(id);
      }
      const previous = sourceSpans.at(-1);
      if (previous?.spineIndex === spineIndex)
        sourceSpans[sourceSpans.length - 1] = {
          spineIndex,
          start: previous.start,
          end: block.end,
        };
      else sourceSpans.push({ spineIndex, start: block.start, end: block.end });
      text += `${html ? separator : ""}${block.text}`;
      html += block.html;
      if (units.length >= EPUB_LIMITS.units)
        return {
          ok: false,
          reason: "too_long",
          diagnostic: {
            code: "unit_count",
            stage: "units",
            observed: units.length + 1,
            limit: EPUB_LIMITS.units,
            spineIndex,
            blockIndex,
          },
        };
    }
  }
  close();
  if (units.length > EPUB_LIMITS.units)
    return {
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "unit_count",
        stage: "units",
        observed: units.length,
        limit: EPUB_LIMITS.units,
      },
    };
  if (!units.some((unit) => unit.content.trim()))
    return {
      ok: false,
      reason: "empty",
      diagnostic: { code: "empty_text", stage: "units" },
    };
  const mapped = units.map((unit) => ({
    ...unit,
    contentHtml: unit.contentHtml.replace(
      / data-epub-href="([^"]+)"/gu,
      (_match, encoded: string) => {
        const target = decodeURIComponent(encoded);
        const [href, fragment] = target.split("#");
        const spineIndex = spine.findIndex((item) => item.href === href);
        const anchor =
          fragment && spineIndex >= 0
            ? epubAnchor(spineIndex, decodeURIComponent(fragment))
            : undefined;
        const index = targets.get(anchor ?? href ?? "");
        return index === undefined
          ? ""
          : ` href="?unit=${index}${anchor ? `#${encodeURIComponent(anchor)}` : ""}"`;
      },
    ),
  }));
  const oversized = mapped.find(
    (unit) => bytesOf(unit.contentHtml, unit.content) > EPUB_LIMITS.unitBytes,
  );
  if (oversized)
    return {
      ok: false,
      reason: "too_long",
      diagnostic: {
        code: "unit_bytes",
        stage: "units",
        observed: bytesOf(oversized.contentHtml, oversized.content),
        limit: EPUB_LIMITS.unitBytes,
      },
    };
  return { ok: true, value: mapped };
}
