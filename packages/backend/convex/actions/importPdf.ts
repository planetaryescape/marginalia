"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { type ActionCtx, internalAction } from "../_generated/server";
import { excerptOf, fitsInStorage, ingestArticle } from "../lib/ingest";
import {
  type ExtractedPdf,
  extractPdf,
  PdfImportError,
} from "../lib/pdf/extract";
import { minutesFor, readingUnitsOf } from "../lib/pdf/sections";
import { blocksToHtml, blocksToText } from "../lib/pdf/structure";
import { titleOf } from "../lib/pdf/title";

// A batch of units per mutation keeps each write far under the 16 MiB limit
const UNITS_PER_WRITE = 20;

/** The reader left or the import expired: stop writing and clean up. */
class ImportStopped extends Error {}

/**
 * Reads an uploaded PDF into the library. A document that fits one article row
 * becomes an article; anything bigger becomes a book, its text stored by
 * reading unit. A refusal or a failure leaves no rows and no file behind.
 */
export const run = internalAction({
  args: { importId: v.id("documentImports") },
  handler: async (ctx, args): Promise<void> => {
    const row: Doc<"documentImports"> | null = await ctx.runMutation(
      internal.documentImports.claim,
      args,
    );
    if (!row || row.status !== "reading") return;
    let discardable: Id<"articles"> | null = null;
    try {
      const file = await ctx.storage.get(row.storageId);
      if (!file) throw new PdfImportError("unreadable");
      const doc = await extractPdf(new Uint8Array(await file.arrayBuffer()));
      const live: boolean = await ctx.runMutation(
        internal.documentImports.setProgress,
        { importId: args.importId, step: "sections", pages: doc.pageCount },
      );
      // The reader left, or the import expired: nothing more is written
      if (!live) return;

      const title = titleOf({
        declared: doc.title,
        blocks: doc.blocks,
        fileName: row.fileName,
      }).toWellFormed();
      const html = blocksToHtml(doc.blocks).toWellFormed();
      const text = blocksToText(doc.blocks).toWellFormed();

      if (fitsInStorage(html, text)) {
        const articleId = await ingestArticle(ctx, row.userId, {
          url: `upload:${args.importId}`,
          title,
          html,
          author: doc.author,
          uploadedFileName: row.fileName,
          pageCount: doc.pageCount,
          importId: args.importId,
        });
        if (!articleId) return;
        return;
      }

      await importBook(ctx, {
        importId: args.importId,
        userId: row.userId,
        fileName: row.fileName,
        title,
        doc,
        onCreated: (id) => {
          discardable = id;
        },
      });
      discardable = null;
    } catch (error) {
      if (discardable)
        await ctx.runMutation(internal.books.discardBook, {
          userId: row.userId,
          articleId: discardable,
          importId: args.importId,
        });
      if (error instanceof ImportStopped) return;
      const failure =
        error instanceof PdfImportError ? error.reason : "unreadable";
      if (failure === "unreadable") console.error("PDF import failed:", error);
      await ctx.runMutation(internal.documentImports.fail, {
        importId: args.importId,
        failure,
      });
    }
  },
});

async function importBook(
  ctx: ActionCtx,
  input: {
    importId: Id<"documentImports">;
    userId: string;
    fileName: string;
    title: string;
    doc: ExtractedPdf;
    onCreated: (articleId: Id<"articles">) => void;
  },
): Promise<Id<"articles">> {
  const { doc, userId, title } = input;
  const { units } = readingUnitsOf(doc.blocks, doc.outline);
  if (!units.length) throw new PdfImportError("empty");
  const live: boolean = await ctx.runMutation(
    internal.documentImports.setProgress,
    {
      importId: input.importId,
      step: "point",
      pages: doc.pageCount,
      units: units.length,
    },
  );
  if (!live) throw new ImportStopped();

  const wordCount = units.reduce((sum, u) => sum + u.wordCount, 0);
  const outline = units.map((u) => ({
    title: u.title.toWellFormed(),
    minutes: u.estimatedReadMinutes,
    chapter: u.chapter?.toWellFormed(),
  }));
  const created: Id<"articles"> | null = await ctx.runMutation(
    internal.books.createBookArticle,
    {
      importId: input.importId,
      userId,
      guid: `upload:${input.importId}`,
      title,
      author: doc.author?.toWellFormed(),
      excerpt: excerptOf(units[0].content.toWellFormed()),
      fileName: input.fileName,
      pageCount: doc.pageCount,
      wordCount,
      estimatedReadMinutes: minutesFor(wordCount),
      outline,
    },
  );
  if (!created) throw new ImportStopped();
  const articleId: Id<"articles"> = created;
  input.onCreated(articleId);

  for (let at = 0; at < units.length; at += UNITS_PER_WRITE) {
    const written: boolean = await ctx.runMutation(internal.books.addUnits, {
      importId: input.importId,
      userId,
      articleId,
      units: units.slice(at, at + UNITS_PER_WRITE).map((u, i) => ({
        index: at + i,
        title: u.title.toWellFormed(),
        chapter: u.chapter?.toWellFormed(),
        content: u.content.toWellFormed(),
        contentHtml: u.contentHtml.toWellFormed(),
        wordCount: u.wordCount,
        estimatedReadMinutes: u.estimatedReadMinutes,
      })),
    });
    if (!written) throw new ImportStopped();
  }

  const finished: boolean = await ctx.runMutation(internal.books.finishBook, {
    importId: input.importId,
    userId,
    articleId,
    title,
    pages: doc.pageCount,
    units: units.length,
    firstUnitTitle: outline[0].title,
    firstUnitMinutes: outline[0].minutes,
  });
  if (!finished) throw new ImportStopped();
  return articleId;
}
