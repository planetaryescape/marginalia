"use node";
import type { FunctionArgs } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { ingestArticle } from "../lib/ingest";
import {
  createHighlight,
  deleteDocument,
  listDocumentPage,
  moveDocument,
  type ReaderDocument,
  type ReaderLocation,
  ReadwiseRateLimitError,
  readwiseTokenFor,
} from "../lib/readwise";

// Unread queues only: the RSS Feed tab and Archive stay in Reader
const LOCATIONS: ReaderLocation[] = ["new", "later", "shortlist"];
// Text documents Marginalia can annotate; PDFs, EPUBs, tweets and videos are skipped
const IMPORTABLE = new Set(["article", "email", "rss"]);
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
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<void> => {
    const readwise = await readwiseTokenFor(ctx, userId);
    if (!readwise) return;
    await ctx.scheduler.runAfter(0, internal.readingQueue.initialize, {
      userId,
    });
    const token = crypto.randomUUID();
    const state: Doc<"readwiseSyncState"> | null = await ctx.runMutation(
      internal.readwiseSyncState.claim,
      { userId, token },
    );
    if (!state) return;
    try {
      const highlightPhase = state.phase === LOCATIONS.length;
      const archivePhase = state.phase === LOCATIONS.length + 1;
      // A first import has nothing archived to catch up on: archived documents
      // are never imported, and walking a whole Reader archive takes hours.
      if (archivePhase && !state.updatedAfter) {
        await ctx.runMutation(internal.readwiseSyncState.completePage, {
          userId,
          token,
          nextPageCursor: null,
        });
        return;
      }
      const page = await listDocumentPage(readwise, {
        location: archivePhase
          ? "archive"
          : highlightPhase
            ? undefined
            : LOCATIONS[state.phase],
        category: highlightPhase ? "highlight" : undefined,
        updatedAfter: state.updatedAfter,
        pageCursor: state.pageCursor,
        withHtmlContent: !highlightPhase && !archivePhase,
        limit: highlightPhase || archivePhase ? 20 : 5,
      });
      let imported = 0;
      const processed = new Set(state.pageProcessedIds);
      const record = async (
        documentId: string,
        outcome: FunctionArgs<
          typeof internal.readwiseSyncState.recordDocument
        >["outcome"],
      ) => {
        await ctx.runMutation(internal.readwiseSyncState.recordDocument, {
          userId,
          token,
          documentId,
          outcome,
        });
        processed.add(documentId);
      };
      for (const doc of page.results) {
        if (processed.has(doc.id)) continue;
        if (archivePhase) {
          const article: Doc<"articles"> | null = doc.parent_id
            ? null
            : await ctx.runQuery(internal.readwise.findArticle, {
                userId,
                readerDocumentId: doc.id,
                url: doc.source_url || doc.url,
              });
          const archived: boolean = article
            ? await ctx.runMutation(internal.readwise.markArchived, {
                userId,
                articleId: article._id,
              })
            : false;
          await record(doc.id, archived ? "existing" : "ignored");
          continue;
        }
        if (highlightPhase) {
          const text = doc.content?.trim();
          if (!doc.parent_id || !text) {
            await record(doc.id, "ignored");
            continue;
          }
          const article: Doc<"articles"> | null = await ctx.runQuery(
            internal.readwise.findArticle,
            { userId, readerDocumentId: doc.parent_id },
          );
          if (!article) {
            await record(doc.id, "ignored");
            continue;
          }
          const added: boolean = await ctx.runMutation(
            internal.readwise.importHighlight,
            {
              userId,
              articleId: article._id,
              readerHighlightId: doc.id,
              text,
            },
          );
          await record(doc.id, added ? "highlight" : "ignored");
        } else {
          if (doc.parent_id || !IMPORTABLE.has(doc.category)) {
            await record(doc.id, "skipped");
            continue;
          }
          const url = doc.source_url || doc.url;
          const existing: Doc<"articles"> | null = await ctx.runQuery(
            internal.readwise.findArticle,
            { userId, readerDocumentId: doc.id, url },
          );
          if (existing) {
            if (!existing.readerDocumentId) {
              await ctx.runMutation(internal.readwise.linkArticle, {
                articleId: existing._id,
                readerDocumentId: doc.id,
              });
            }
            await record(
              doc.id,
              existing.readerDocumentId ? "existing" : "linked",
            );
            continue;
          }
          if (!doc.html_content?.trim()) {
            await record(doc.id, "skipped");
            continue;
          }
          const articleId = await ingestArticle(
            ctx,
            userId,
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
          await record(doc.id, articleId ? "imported" : "skipped");
        }
      }
      await ctx.runMutation(internal.readwiseSyncState.completePage, {
        userId,
        token,
        nextPageCursor: page.nextPageCursor,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Readwise sync failed:", message);
      await ctx.runMutation(internal.readwiseSyncState.fail, {
        userId,
        token,
        error: message.slice(0, 300),
        retryAfterMs:
          error instanceof ReadwiseRateLimitError
            ? error.retryAfterMs
            : undefined,
      });
    }
  },
});

/** Sends a highlighter or pen mark made in Marginalia to Reader. */
export const pushHighlight = internalAction({
  args: { highlightId: v.id("highlights") },
  handler: async (ctx, args): Promise<void> => {
    const row: Doc<"highlights"> | null = await ctx.runQuery(
      internal.highlights.getByIdInternal,
      args,
    );
    if (!row || row.source === "reader" || row.readerHighlightId) return;
    const readwise = await readwiseTokenFor(ctx, row.userId);
    if (!readwise) return;
    const parentId: string | null = await ctx.runQuery(
      internal.readwise.getArticleReaderId,
      {
        articleId: row.articleId,
        userId: row.userId,
      },
    );
    if (!parentId) return;
    try {
      const readerHighlightId = await createHighlight(
        readwise,
        parentId,
        row.text,
      );
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
  args: { userId: v.string(), readerHighlightId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const readwise = await readwiseTokenFor(ctx, args.userId);
    if (!readwise) return;
    try {
      await deleteDocument(readwise, args.readerHighlightId);
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
  args: { userId: v.string(), articleId: v.id("articles") },
  handler: async (ctx, args): Promise<void> => {
    const readwise = await readwiseTokenFor(ctx, args.userId);
    if (!readwise) return;
    const readerId: string | null = await ctx.runQuery(
      internal.readwise.getArticleReaderId,
      args,
    );
    if (!readerId) return;
    try {
      await moveDocument(readwise, readerId, "archive");
    } catch (error) {
      console.error(`Couldn't archive ${args.articleId} in Reader:`, error);
    }
  },
});

/** Moves a restored article back to Reader's Later list. */
export const unarchiveArticle = internalAction({
  args: { userId: v.string(), articleId: v.id("articles") },
  handler: async (ctx, args): Promise<void> => {
    const readwise = await readwiseTokenFor(ctx, args.userId);
    if (!readwise) return;
    const readerId: string | null = await ctx.runQuery(
      internal.readwise.getArticleReaderId,
      args,
    );
    if (!readerId) return;
    try {
      await moveDocument(readwise, readerId, "later");
    } catch (error) {
      console.error(`Couldn't restore ${args.articleId} in Reader:`, error);
    }
  },
});
