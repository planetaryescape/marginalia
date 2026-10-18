import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, query } from "./functions";
import {
  ownedArticleCard,
  syncArticleMetadata,
  syncBookPartCard,
} from "./lib/articleMetadata";
import {
  countMembership,
  metadataLibraryActive,
  metadataLibraryRetained,
  shelfCounts,
} from "./lib/shelfCounts";

/** Same heading DTO as articles.headers; the old endpoint remains untouched. */
export const headers = query({
  args: { articleIds: v.array(v.id("articles")) },
  handler: async (ctx, { articleIds }) => {
    if (articleIds.length > 8) throw new Error("Too many article headers");
    return Promise.all(
      [...new Set(articleIds)].map(async (articleId) => {
        const article = await ownedArticleCard(ctx, articleId, ctx.readerId);
        return {
          articleId,
          article: article ? { title: article.title, url: article.url } : null,
        };
      }),
    );
  },
});

export const counts = query({
  args: {},
  handler: async (ctx) => {
    const row = await shelfCounts(ctx, ctx.readerId);
    return {
      ready: row?.ready ?? false,
      saved: row?.ready ? row.saved : null,
      loved: row?.ready ? row.loved : null,
    };
  },
});

/** Explicit admin-driven, one bounded transaction per call. No deploy hook or jobs. */
export const backfill = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    if (!(await metadataLibraryActive(ctx, userId)))
      return { complete: false, inactive: true, phase: null };
    let state = await ctx.db
      .query("libraryMetadataState")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!state) {
      const id = await ctx.db.insert("libraryMetadataState", {
        userId,
        articlesReady: false,
        phase: "articles",
        cursor: null,
      });
      state = await ctx.db.get(id);
    }
    if (!state) throw new Error("Metadata migration state missing");
    const { phase, cursor } = state;
    if (phase === "done") return { complete: true, inactive: false, phase };
    let isDone: boolean;
    let continueCursor: string;
    if (phase === "articles" || phase === "parts") {
      // Eight near-limit documents plus trigger reads stay below 16 MiB.
      if (phase === "articles") {
        const page = await ctx.db
          .query("articles")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .paginate({ cursor, numItems: 6, maximumBytesRead: 6_000_000 });
        for (const row of page.page) await syncArticleMetadata(ctx, null, row);
        ({ isDone, continueCursor } = page);
      } else {
        const page = await ctx.db
          .query("bookUnits")
          .withIndex("by_userId_and_articleId_and_index", (q) =>
            q.eq("userId", userId),
          )
          .paginate({ cursor, numItems: 6, maximumBytesRead: 6_000_000 });
        for (const row of page.page) {
          // Do not recreate a part card whose parent was concurrently removed.
          const parent = await ctx.db
            .query("articleMetadata")
            .withIndex("by_articleId", (q) => q.eq("articleId", row.articleId))
            .unique();
          if (parent?.userId === userId) await syncBookPartCard(ctx, null, row);
        }
        ({ isDone, continueCursor } = page);
      }
    } else {
      const page = await ctx.db
        .query(phase === "saved" ? "savedArticles" : "lovedArticles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .paginate({ cursor, numItems: 128, maximumBytesRead: 128_000 });
      // Markers are changed through a raw writer only by the trigger helper;
      // patches here don't change ownership and hence don't recount.
      for (const row of page.page)
        await countMembership(
          ctx,
          phase === "saved" ? "savedArticles" : "lovedArticles",
          row,
        );
      ({ isDone, continueCursor } = page);
    }
    const next =
      phase === "articles"
        ? "parts"
        : phase === "parts"
          ? "saved"
          : phase === "saved"
            ? "loved"
            : "done";
    await ctx.db.patch(state._id, {
      phase: isDone ? next : phase,
      cursor: isDone ? null : continueCursor,
      articlesReady: state.articlesReady || (phase === "articles" && isDone),
    });
    if (isDone && phase === "loved") {
      const counts = await shelfCounts(ctx, userId);
      if (counts) await ctx.db.patch(counts._id, { ready: true });
      else
        await ctx.db.insert("shelfCounts", {
          userId,
          saved: 0,
          loved: 0,
          ready: true,
        });
    }
    return {
      complete: isDone && next === "done",
      inactive: false,
      phase: isDone ? next : phase,
    };
  },
});

/** Run alongside the existing metadata purge step; keep numeric step IDs stable. */
export async function purgeArticleMetadata(
  ctx: MutationCtx,
  userId: string,
): Promise<number> {
  if (await metadataLibraryRetained(ctx, userId))
    throw new Error("Cannot purge metadata from a retained library");
  const tables = [
    "articleMetadata",
    "bookPartCards",
    "libraryMetadataState",
    "shelfCounts",
  ] as const;
  for (const table of tables) {
    const rows =
      table === "bookPartCards"
        ? await ctx.db
            .query(table)
            .withIndex("by_userId_and_articleId_and_index", (q) =>
              q.eq("userId", userId),
            )
            .take(64)
        : table === "articleMetadata"
          ? await ctx.db
              .query(table)
              .withIndex("by_user", (q) => q.eq("userId", userId))
              .take(64)
          : await ctx.db
              .query(table)
              .withIndex("by_userId", (q) => q.eq("userId", userId))
              .take(64);
    if (rows.length) {
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
  }
  return 0;
}
