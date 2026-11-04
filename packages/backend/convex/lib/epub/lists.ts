import type { Element, Node } from "@xmldom/xmldom";
import { EPUB_LIMITS } from "./archive";
import type { EpubBlock } from "./types";

const normalize = (text: string) =>
  text
    .replace(/[^\S\n]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .trim();
const words = (text: string) =>
  text.trim() ? text.trim().split(/\s+/u).length : 0;
const fits = (html: string, text: string) =>
  words(text) <= EPUB_LIMITS.unitWords &&
  new TextEncoder().encode(html + text).length <= EPUB_LIMITS.unitBytes;

type TextTotals = {
  bytes: number;
  words: number;
  whitespace: boolean;
  newlines: number;
};

const emptyTotals = (): TextTotals => ({
  bytes: 0,
  words: 0,
  whitespace: true,
  newlines: 0,
});

function addText(
  previous: TextTotals,
  text: string,
  preformatted: boolean,
): TextTotals {
  const totals = { ...previous };
  const encoder = new TextEncoder();
  if (preformatted) totals.bytes += encoder.encode(text).length;
  for (const [token] of text.matchAll(/\s+|\S+/gu)) {
    if (/^\s/u.test(token)) {
      totals.whitespace = true;
      if (!preformatted) totals.newlines += token.match(/\n/gu)?.length ?? 0;
    } else {
      if (totals.whitespace) totals.words++;
      if (!preformatted) {
        if (totals.bytes && totals.whitespace)
          totals.bytes += totals.newlines || 1;
        totals.bytes += encoder.encode(token).length;
      }
      totals.whitespace = false;
      totals.newlines = 0;
    }
  }
  return totals;
}

function integer(value: string | null): number | undefined {
  if (!value || !/^[+-]?\d+$/u.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

export function epubListAttributes(element: Element): string {
  const tag = (element.localName ?? element.tagName).toLowerCase();
  if (tag !== "ol" && tag !== "li") return "";
  const name = tag === "ol" ? "start" : "value";
  const value = integer(element.getAttribute(name));
  const type = element.getAttribute("type");
  return `${value === undefined ? "" : ` ${name}="${value}"`}${tag === "ol" && type && /^[1aAiI]$/u.test(type) ? ` type="${type}"` : ""}${tag === "ol" && element.hasAttribute("reversed") ? ' reversed="reversed"' : ""}`;
}

export function splitEpubList(
  element: Element,
  block: EpubBlock,
  render: (node: Node) => { html: string; text: string },
  preformatted = false,
): readonly EpubBlock[] {
  if (fits(block.html, block.text)) return [block];
  const tag = (element.localName ?? element.tagName).toLowerCase();
  if (tag !== "ol" && tag !== "ul") return [block];
  const children = Array.from(element.childNodes);
  if (
    children.some((node) =>
      isElement(node)
        ? (node.localName ?? node.tagName).toLowerCase() !== "li"
        : render(node).text.trim().length > 0,
    )
  )
    return [block];
  const items: { element: Element; html: string; text: string }[] = [];
  let leadingHtml = "";
  let leadingText = "";
  for (const child of children) {
    const rendered = render(child);
    if (isElement(child)) {
      if (!rendered.html) continue;
      items.push({
        element: child,
        html: leadingHtml + rendered.html,
        text: leadingText + rendered.text,
      });
      leadingHtml = "";
      leadingText = "";
    } else {
      leadingHtml += rendered.html;
      leadingText += rendered.text;
    }
  }
  const originalOpening = block.html.match(/^<[^>]+>/u)?.[0];
  if (!originalOpening || !items.length) return [block];
  const reversed = element.hasAttribute("reversed");
  const opening =
    tag === "ol" &&
    reversed &&
    integer(element.getAttribute("start")) === undefined
      ? originalOpening.replace(/>$/u, ` start="${items.length}">`)
      : originalOpening;
  const contentOf = preformatted ? (text: string) => text : normalize;
  let ordinal =
    integer(element.getAttribute("start")) ?? (reversed ? items.length : 1);
  const result: EpubBlock[] = [];
  let html = "";
  let plain = "";
  let wrapper = opening;
  const encoder = new TextEncoder();
  const closingBytes = encoder.encode(`</${tag}>`).length;
  let wrapperBytes = encoder.encode(wrapper).length;
  let htmlBytes = 0;
  let totals = emptyTotals();
  let offset = 0;
  const close = () => {
    const text = contentOf(plain);
    const start = block.text.indexOf(text, offset);
    if (start < 0 || block.text.slice(offset, start).trim()) return false;
    result.push({
      html: `${wrapper}${html}</${tag}>`,
      text,
      start: block.start + start,
      end: block.start + start + text.length,
    });
    offset = start + text.length;
    html = "";
    plain = "";
    htmlBytes = 0;
    totals = emptyTotals();
    return true;
  };
  for (const item of items) {
    ordinal = integer(item.element.getAttribute("value")) ?? ordinal;
    const rendered = item;
    const itemBytes = encoder.encode(rendered.html).length;
    let nextTotals = addText(totals, rendered.text, preformatted);
    const nextWrapper = opening
      .replace(/ id="[^"]*"/u, "")
      .replace(/ start="[^"]*"/u, "")
      .replace(/>$/u, tag === "ol" ? ` start="${ordinal}">` : ">");
    if (
      html &&
      (nextTotals.words > EPUB_LIMITS.unitWords ||
        wrapperBytes + htmlBytes + itemBytes + closingBytes + nextTotals.bytes >
          EPUB_LIMITS.unitBytes)
    ) {
      if (!close()) return [block];
      wrapper = nextWrapper;
      wrapperBytes = encoder.encode(wrapper).length;
      nextTotals = addText(totals, rendered.text, preformatted);
    }
    html += rendered.html;
    plain += rendered.text;
    htmlBytes += itemBytes;
    totals = nextTotals;
    ordinal += reversed ? -1 : 1;
    if (!Number.isSafeInteger(ordinal)) return [block];
  }
  if (html && !close()) return [block];
  if (block.text.slice(offset).trim()) return [block];
  if (preformatted) {
    const last = result.at(-1);
    if (last)
      result[result.length - 1] = {
        ...last,
        text: block.text.slice(last.start - block.start),
        end: block.end,
      };
  }
  if (result.some((part) => !part.text.trim())) return [block];
  return result;
}
