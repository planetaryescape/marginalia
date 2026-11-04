"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { WORDS_PER_MINUTE } from "../lib/constants";
import type { EpubDiagnostic } from "../lib/epub/diagnostics";
import { rasterType, replaceEpubImages } from "../lib/epub/images";
import { parseEpub } from "../lib/epub/parse";
import {
  excerptOf,
  fitsInStorage,
  MAX_STORED_BYTES,
} from "../lib/importContent";
import { unexpectedImportDiagnostic } from "../lib/importDiagnostics";

export const run = internalAction({
  args: { importId: v.id("documentImports") },
  handler: async (ctx, args): Promise<void> => {
    const row: Doc<"documentImports"> | null = await ctx.runMutation(
      internal.documentImports.claim,
      args,
    );
    if (!row || row.format !== "epub") return;
    let articleId: Id<"articles"> | null = null;
    let stage: EpubDiagnostic["stage"] = "archive";
    try {
      const file = await ctx.storage.get(row.storageId);
      const preview: { title?: string; author?: string } = {};
      const parsed = file
        ? parseEpub(new Uint8Array(await file.arrayBuffer()), {
            onStage: (value) => {
              stage = value;
            },
            onDiagnostic: (diagnostic) => {
              console.info(
                JSON.stringify({
                  event: "epub_navigation_fallback",
                  importId: args.importId,
                  stage: diagnostic.stage,
                  code: diagnostic.code,
                }),
              );
            },
            onMetadata: (metadata) => {
              preview.title = metadata.title.slice(0, 500).toWellFormed();
              preview.author =
                metadata.creators.join(", ").slice(0, 500).toWellFormed() ||
                undefined;
            },
          })
        : null;
      if (preview.title) {
        const live: boolean = await ctx.runMutation(
          internal.documentImports.setProgress,
          {
            ...args,
            step: "text",
            ...preview,
          },
        );
        if (!live) return;
      }
      if (!parsed?.ok) {
        await ctx.runMutation(internal.documentImports.fail, {
          importId: args.importId,
          failure: parsed?.reason ?? "unreadable",
          diagnostic: parsed?.diagnostic ?? {
            stage: "archive",
            code: "invalid_archive",
          },
        });
        return;
      }
      const book = parsed.value;
      const first = book.units[0];
      if (!first) {
        await ctx.runMutation(internal.documentImports.fail, {
          ...args,
          failure: "empty",
          diagnostic: { stage: "units", code: "empty_text" },
        });
        return;
      }
      stage = "publish";
      const live: boolean = await ctx.runMutation(
        internal.documentImports.setProgress,
        {
          ...args,
          step: "sections",
          units: book.units.length,
        },
      );
      if (!live) return;
      const wordCount = book.units.reduce(
        (sum, unit) => sum + unit.wordCount,
        0,
      );
      const title = book.metadata.title.toWellFormed();
      const article = {
        ...args,
        userId: row.userId,
        guid: `upload:${args.importId}`,
        title,
        author: book.metadata.creators.join(", ").toWellFormed() || undefined,
        excerpt: excerptOf(first.content),
        fileName: row.fileName,
        wordCount,
        estimatedReadMinutes: Math.max(
          1,
          Math.ceil(wordCount / WORDS_PER_MINUTE),
        ),
        outline: book.units.map((unit) => ({
          title: unit.title,
          minutes: unit.estimatedReadMinutes,
        })),
      };
      const articleBytes = new TextEncoder().encode(
        JSON.stringify(article),
      ).length;
      if (articleBytes >= MAX_STORED_BYTES) {
        await ctx.runMutation(internal.documentImports.fail, {
          ...args,
          failure: "too_long",
          diagnostic: {
            stage,
            code: "storage_payload",
            observed: articleBytes,
            limit: MAX_STORED_BYTES,
          },
        });
        return;
      }
      articleId = await ctx.runMutation(
        internal.books.createBookArticle,
        article,
      );
      if (!articleId) return;
      const urls = new Map<string, string>();
      const referencedHrefs = new Set<string>();
      for (const unit of book.units)
        for (const match of unit.contentHtml.matchAll(
          /data-epub-image="([^"]*)"/gu,
        ))
          if (match[1] !== undefined)
            referencedHrefs.add(decodeURIComponent(match[1]));
      stage = "images";
      for (const image of book.images) {
        if (!referencedHrefs.has(image.href)) continue;
        const type = rasterType(image.bytes, image.mediaType);
        if (!type) continue;
        const storageId = await ctx.storage.store(
          new Blob([Uint8Array.from(image.bytes)], { type }),
        );
        let url: string | null;
        try {
          url = await ctx.runMutation(internal.bookImages.register, {
            ...args,
            articleId,
            storageId,
            href: image.href,
          });
        } catch (error) {
          await ctx.storage.delete(storageId);
          throw error;
        }
        if (!url) {
          await ctx.storage.delete(storageId);
          await ctx.runMutation(internal.documentImports.fail, {
            ...args,
            failure: "unreadable",
          });
          await ctx.runMutation(internal.books.discardBook, {
            ...args,
            userId: row.userId,
            articleId,
          });
          return;
        }
        urls.set(image.href, url);
      }
      stage = "publish";
      for (let at = 0; at < book.units.length; at += 1) {
        const units = book.units.slice(at, at + 1).map((unit, index) => ({
          ...unit,
          index: at + index,
          sourceSpans: [...unit.sourceSpans],
          contentHtml: replaceEpubImages(unit.contentHtml, urls),
        }));
        const encoder = new TextEncoder();
        const oversized = units.find(
          (unit) => !fitsInStorage(unit.contentHtml, unit.content),
        );
        const payloadBytes = encoder.encode(JSON.stringify(units)).length;
        if (oversized || payloadBytes >= 950_000) {
          await ctx.runMutation(internal.documentImports.fail, {
            ...args,
            failure: "too_long",
            diagnostic: {
              stage,
              code: "storage_payload",
              observed: oversized
                ? encoder.encode(oversized.contentHtml).length +
                  encoder.encode(oversized.content).length
                : payloadBytes,
              limit: oversized ? MAX_STORED_BYTES : 950_000,
            },
          });
          return;
        }
        const written: boolean = await ctx.runMutation(
          internal.books.addUnits,
          {
            ...args,
            userId: row.userId,
            articleId,
            units,
          },
        );
        if (!written) {
          await ctx.runMutation(internal.books.discardBook, {
            ...args,
            userId: row.userId,
            articleId,
          });
          return;
        }
      }
      const finished: boolean = await ctx.runMutation(
        internal.books.finishBook,
        {
          ...args,
          userId: row.userId,
          articleId,
          title,
          units: book.units.length,
          firstUnitTitle: first.title,
          firstUnitMinutes: first.estimatedReadMinutes,
        },
      );
      if (!finished)
        await ctx.runMutation(internal.books.discardBook, {
          ...args,
          userId: row.userId,
          articleId,
        });
      else
        console.info(
          JSON.stringify({
            event: "epub_import_completed",
            importId: args.importId,
            units: book.units.length,
            images: urls.size,
          }),
        );
    } catch (error) {
      await ctx.runMutation(internal.documentImports.fail, {
        ...args,
        failure: "unreadable",
        diagnostic: unexpectedImportDiagnostic(stage, error),
      });
      if (articleId)
        await ctx.runMutation(internal.books.discardBook, {
          ...args,
          userId: row.userId,
          articleId,
        });
    }
  },
});
