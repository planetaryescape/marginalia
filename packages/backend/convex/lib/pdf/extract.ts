"use node";
// Reads a PDF with pdf.js (through unpdf) one page at a time, so memory stays
// near one page's text rather than the whole book (spike S7: 259 MB against
// 386 MB for extractText on a 501-page book, inside Convex's 512 MiB).
import { getDocumentProxy } from "unpdf";
import type { OutlineEntry } from "./sections";
import {
  type Block,
  buildBlocks,
  type Line,
  looksScanned,
  type PdfTextItem,
  pageToLines,
} from "./structure";

/** Past this the import is refused: nothing larger has been measured. */
export const MAX_PDF_PAGES = 1_500;
// Outline entries deeper than 1 are never used, and a broken outline can be huge
const MAX_OUTLINE_ENTRIES = 5_000;

export type PdfFailure = "scanned" | "too_long" | "unreadable" | "empty";

export class PdfImportError extends Error {
  constructor(readonly reason: PdfFailure) {
    super(reason);
  }
}

export interface ExtractedPdf {
  pageCount: number;
  blocks: Block[];
  outline: OutlineEntry[];
  /** The title the PDF declares, if any */
  title?: string;
  author?: string;
}

type Proxy = Awaited<ReturnType<typeof getDocumentProxy>>;
type OutlineNode = Awaited<ReturnType<Proxy["getOutline"]>>[number];

async function pageOf(pdf: Proxy, node: OutlineNode): Promise<number | null> {
  try {
    const dest =
      typeof node.dest === "string"
        ? await pdf.getDestination(node.dest)
        : node.dest;
    if (!dest) return null;
    const ref = dest[0];
    // A destination is a page reference, or already a 0-based page number
    return typeof ref === "number"
      ? ref + 1
      : (await pdf.getPageIndex(ref)) + 1;
  } catch {
    return null;
  }
}

async function readOutline(pdf: Proxy): Promise<OutlineEntry[]> {
  const entries: OutlineEntry[] = [];
  const walk = async (nodes: readonly OutlineNode[], depth: number) => {
    for (const node of nodes) {
      if (entries.length >= MAX_OUTLINE_ENTRIES) return;
      const title = node.title?.replace(/\s+/g, " ").trim();
      const page = title ? await pageOf(pdf, node) : null;
      if (title && page)
        entries.push({ title: title.replace(/[-]/g, ""), depth, page });
      if (depth < 1 && node.items?.length) await walk(node.items, depth + 1);
    }
  };
  try {
    await walk((await pdf.getOutline()) ?? [], 0);
  } catch {
    // An outline that can't be read is the same as none: headings take over
    return [];
  }
  return entries;
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractedPdf> {
  // Every PDF opens with this, so anything else is refused before pdf.js sees it
  if (new TextDecoder().decode(bytes.subarray(0, 1024)).indexOf("%PDF-") === -1)
    throw new PdfImportError("unreadable");
  let pdf: Proxy;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch {
    // Encrypted, truncated or not a PDF at all
    throw new PdfImportError("unreadable");
  }
  try {
    if (pdf.numPages > MAX_PDF_PAGES) throw new PdfImportError("too_long");
    const lines: Line[] = [];
    const pageChars: number[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      try {
        const [, , width, height] = page.view;
        const content = await page.getTextContent();
        const pageLines = pageToLines({
          number,
          width,
          height,
          // The items carry `str` only when they are text, not marked-content markers
          items: content.items.filter(
            (item): item is typeof item & PdfTextItem => "str" in item,
          ),
        });
        pageChars.push(pageLines.reduce((sum, l) => sum + l.text.length, 0));
        lines.push(...pageLines);
      } finally {
        page.cleanup();
      }
    }
    if (looksScanned(pageChars)) throw new PdfImportError("scanned");

    const blocks = buildBlocks(lines, pdf.numPages);
    if (!blocks.length) throw new PdfImportError("empty");
    let title: string | undefined;
    let author: string | undefined;
    try {
      const { info } = (await pdf.getMetadata()) as {
        info?: { Title?: unknown; Author?: unknown };
      };
      title = typeof info?.Title === "string" ? info.Title.trim() : undefined;
      author =
        typeof info?.Author === "string" ? info.Author.trim() : undefined;
    } catch {
      // Metadata is optional
    }
    return {
      pageCount: pdf.numPages,
      blocks,
      outline: await readOutline(pdf),
      title: title || undefined,
      author: author || undefined,
    };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
