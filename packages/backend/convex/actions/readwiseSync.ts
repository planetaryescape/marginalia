"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { ingestArticle } from "../lib/ingest";
import {
  createHighlight,
  deleteDocument,
  listDocuments,
  moveDocument,
  type ReaderDocument,
  type ReaderLocation,
  readwiseToken,
} from "../lib/readwise";

// Unread queues only: the RSS Feed tab and Archive stay in Reader
const LOCATIONS: ReaderLocation[] = ["new", "later", "shortlist"];
// Text documents Marginalia can annotate; PDFs, EPUBs, tweets and videos are skipped
const IMPORTABLE = new Set(["article", "email", "rss"]);
// The first sync takes only the most recently updated documents, so connecting
// a large library doesn't queue thousands of annotation runs at once
const FIRST_SYNC_LIMIT = 100;
// Overlap each incremental sync slightly so nothing updated mid-run is missed
const OVERLAP_MS = 2 * 60 * 1000;
// Spread annotation runs out rather than starting them all together
const ANNOTATION_SPACING_MS = 8_000;

function publishedAt(
  value: ReaderDocument["published_date"],
): number | undefined {
  if (value === null || value === undefined) return undefined;
  const time = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    if (!readwiseToken()) return;
    const startedAt = Date.now();
    const { syncedAt }: { syncedAt: number | null } = await ctx.runQuery(
      internal.readwise.getSyncState,
      {},
    );
    const updatedAfter = syncedAt
      ? new Date(syncedAt - OVERLAP_MS).toISOString()
      : undefined;

    try {
      // 1. Documents
      let candidates: ReaderDocument[] = [];
      for (const location of LOCATIONS) {
        for await (const doc of listDocuments({
          location,
          updatedAfter,
          withHtmlContent: true,
          maxPages: syncedAt ? 10 : 30,
        })) {
          if (doc.parent_id || !IMPORTABLE.has(doc.category)) continue;
          candidates.push(doc);
          if (!syncedAt && candidates.length > FIRST_SYNC_LIMIT * 2) {
            // Keep memory bounded on a first sync of a big library
            candidates.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
            candidates = candidates.slice(0, FIRST_SYNC_LIMIT);
          }
        }
      }
      if (!syncedAt) {
        candidates.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        candidates = candidates.slice(0, FIRST_SYNC_LIMIT);
      }

      let imported = 0;
      let linked = 0;
      let failed = 0;
      for (const doc of candidates) {
        try {
          const url = doc.source_url || doc.url;
          const existing: Doc<"articles"> | null = await ctx.runQuery(
            internal.readwise.findArticle,
            { readerDocumentId: doc.id, url },
          );
          if (existing) {
            if (!existing.readerDocumentId) {
              await ctx.runMutation(internal.readwise.linkArticle, {
                articleId: existing._id,
                readerDocumentId: doc.id,
              });
              linked++;
            }
            continue;
          }
          if (!doc.html_content?.trim()) continue;
          const articleId = await ingestArticle(
            ctx,
            {
              url,
              title: doc.title || url,
              html: doc.html_content,
              author: doc.author ?? undefined,
              publishedAt: publishedAt(doc.published_date),
              imageUrl: doc.image_url ?? undefined,
              readerDocumentId: doc.id,
            },
            { annotateAfterMs: 500 + imported * ANNOTATION_SPACING_MS },
          );
          if (articleId) imported++;
          else failed++;
        } catch (error) {
          // One bad document shouldn't stop the rest of the sync
          failed++;
          console.error(`Readwise: couldn't import "${doc.title}":`, error);
        }
      }

      // 2. Highlights made in Reader, on articles Marginalia has
      let highlights = 0;
      for await (const doc of listDocuments({
        category: "highlight",
        updatedAfter,
        maxPages: syncedAt ? 10 : 20,
      })) {
        const text = doc.content?.trim();
        if (!doc.parent_id || !text) continue;
        const article: Doc<"articles"> | null = await ctx.runQuery(
          internal.readwise.findArticle,
          { readerDocumentId: doc.parent_id },
        );
        if (!article) continue;
        const added: boolean = await ctx.runMutation(
          internal.readwise.importHighlight,
          {
            articleId: article._id,
            readerHighlightId: doc.id,
            text,
          },
        );
        if (added) highlights++;
      }

      await ctx.runMutation(internal.readwise.recordSync, {
        syncedAt: startedAt,
      });
      console.log(
        `Readwise sync: ${imported} imported, ${linked} linked, ${failed} skipped, ${highlights} highlights` +
          (syncedAt ? "" : " (first sync)"),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Readwise sync failed:", message);
      await ctx.runMutation(internal.readwise.recordSync, {
        error: message.slice(0, 300),
      });
    }
  },
});

/** Sends a highlighter or pen mark made in Marginalia to Reader. */
export const pushHighlight = internalAction({
  args: { highlightId: v.id("highlights") },
  handler: async (ctx, args): Promise<void> => {
    if (!readwiseToken()) return;
    const row: Doc<"highlights"> | null = await ctx.runQuery(
      internal.highlights.getByIdInternal,
      args,
    );
    if (!row || row.source === "reader" || row.readerHighlightId) return;
    const parentId: string | null = await ctx.runQuery(
      internal.readwise.getArticleReaderId,
      {
        articleId: row.articleId,
      },
    );
    if (!parentId) return;
    try {
      const readerHighlightId = await createHighlight(parentId, row.text);
      await ctx.runMutation(internal.readwise.setHighlightReaderId, {
        highlightId: args.highlightId,
        readerHighlightId,
      });
    } catch (error) {
      // Usually Reader couldn't find the passage in its copy of the text
      console.error(
        `Couldn't send highlight ${args.highlightId} to Reader:`,
        error,
      );
    }
  },
});

export const deleteHighlight = internalAction({
  args: { readerHighlightId: v.string() },
  handler: async (_ctx, args): Promise<void> => {
    if (!readwiseToken()) return;
    try {
      await deleteDocument(args.readerHighlightId);
    } catch (error) {
      console.error(
        `Couldn't delete highlight ${args.readerHighlightId} in Reader:`,
        error,
      );
    }
  },
});

/** Archives the article in Reader when it's finished in Marginalia. */
export const archiveArticle = internalAction({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args): Promise<void> => {
    if (!readwiseToken()) return;
    const readerId: string | null = await ctx.runQuery(
      internal.readwise.getArticleReaderId,
      args,
    );
    if (!readerId) return;
    try {
      await moveDocument(readerId, "archive");
    } catch (error) {
      console.error(`Couldn't archive ${args.articleId} in Reader:`, error);
    }
  },
});
