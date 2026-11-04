import {
  DOMParser,
  type Document,
  type Element,
  type Node,
} from "@xmldom/xmldom";
import type { EpubDiagnostic } from "./diagnostics";
import type { EpubResult } from "./types";

export function parseEpubXml(
  bytes: Uint8Array | undefined,
  stage: EpubDiagnostic["stage"] = "package",
): EpubResult<Document> {
  const code =
    stage === "spine"
      ? "invalid_spine"
      : stage === "navigation"
        ? "invalid_navigation"
        : stage === "encryption"
          ? "invalid_encryption"
          : "invalid_package";
  if (!bytes)
    return { ok: false, reason: "not_epub", diagnostic: { code, stage } };
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/<!ENTITY\b/iu.test(source))
      return { ok: false, reason: "unreadable", diagnostic: { code, stage } };
    const bounded = checkXmlBounds(source, stage);
    if (!bounded.ok) return bounded;
    let invalid = false;
    const doc = new DOMParser({
      onError: () => {
        invalid = true;
      },
    }).parseFromString(source, "application/xml");
    if (invalid || !doc.documentElement)
      return { ok: false, reason: "unreadable", diagnostic: { code, stage } };
    const pending: { node: Node; depth: number }[] = [
      { node: doc.documentElement, depth: 0 },
    ];
    let count = 0;
    while (pending.length) {
      const entry = pending.pop();
      if (!entry) break;
      if (entry.depth > 128)
        return {
          ok: false,
          reason: "too_long",
          diagnostic: {
            code: "xml_depth",
            stage,
            observed: entry.depth,
            limit: 128,
          },
        };
      if (++count > 100_000)
        return {
          ok: false,
          reason: "too_long",
          diagnostic: {
            code: "xml_nodes",
            stage,
            observed: count,
            limit: 100_000,
          },
        };
      for (let child = entry.node.firstChild; child; child = child.nextSibling)
        pending.push({
          node: child,
          depth: entry.depth + (child.nodeType === 1 ? 1 : 0),
        });
    }
    return { ok: true, value: doc };
  } catch {
    return { ok: false, reason: "unreadable", diagnostic: { code, stage } };
  }
}

function checkXmlBounds(
  source: string,
  stage: EpubDiagnostic["stage"],
): EpubResult<null> {
  let depth = -1;
  let count = 0;
  let offset = 0;
  while (offset < source.length) {
    if (source[offset] !== "<") {
      const next = source.indexOf("<", offset);
      offset = next < 0 ? source.length : next;
      count++;
    } else if (
      source.startsWith("<!--", offset) ||
      source.startsWith("<![CDATA[", offset) ||
      source.startsWith("<?", offset)
    ) {
      const terminator = source.startsWith("<!--", offset)
        ? "-->"
        : source.startsWith("<?", offset)
          ? "?>"
          : "]]>";
      const end = source.indexOf(terminator, offset + 2);
      if (end < 0) return { ok: false, reason: "unreadable" };
      offset = end + terminator.length;
      count++;
    } else {
      const start = offset;
      const startTag = source[start + 1] !== "/" && source[start + 1] !== "!";
      let quote = "";
      for (offset++; offset < source.length; offset++) {
        const char = source[offset];
        if (quote) {
          if (char === quote) quote = "";
        } else if (char === '"' || char === "'") quote = char;
        else if (char === "=" && startTag) {
          if (++count > 100_000)
            return {
              ok: false,
              reason: "too_long",
            };
        } else if (char === ">") break;
        else if (
          char === "[" &&
          /^<!DOCTYPE\b/iu.test(source.slice(start, start + 10))
        )
          return { ok: false, reason: "unreadable" };
      }
      if (offset >= source.length) return { ok: false, reason: "unreadable" };
      if (source[start + 1] === "/") depth--;
      else if (source[start + 1] !== "!") {
        count++;
        depth++;
        if (depth > 128)
          return {
            ok: false,
            reason: "too_long",
            diagnostic: {
              code: "xml_depth",
              stage,
              observed: depth,
              limit: 128,
            },
          };
        if (source[offset - 1] === "/") depth--;
      }
      offset++;
    }
    if (count > 100_000)
      return {
        ok: false,
        reason: "too_long",
        diagnostic: {
          code: "xml_nodes",
          stage,
          observed: count,
          limit: 100_000,
        },
      };
  }
  return { ok: true, value: null };
}

export function elements(
  node: Document | Element,
  localName: string,
): Element[] {
  return Array.from(node.getElementsByTagNameNS("*", localName));
}

export function childElements(node: Node): Element[] {
  return Array.from(node.childNodes).filter(
    (child): child is Element => child.nodeType === 1,
  );
}

export function xmlText(node: Node | undefined): string {
  return (node?.textContent ?? "").replace(/\s+/gu, " ").trim();
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}
