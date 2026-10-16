import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

// Data access for the "Ask your library" endpoint (lib/library.ts). Every
// lookup is scoped to the caller's library, including vector search hits.

export const recentActivity = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const [impressions, interactions] = await Promise.all([
      ctx.db
        .query("impressions")
        .withIndex("by_user_updated", (q) => q.eq("userId", args.userId))
        .order("desc")
        .take(60),
      ctx.db
        .query("articleInteractions")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .order("desc")
        .take(1000),
    ]);
    return { impressions, interactions };
  },
});

export const loadMatches = internalQuery({
  args: {
    userId: v.string(),
    impressionIds: v.array(v.id("impressions")),
    noteIds: v.array(v.id("userNotes")),
    highlightIds: v.array(v.id("highlights")),
    threadIds: v.array(v.id("companionThreads")),
  },
  handler: async (ctx, args) => {
    const present = <T extends { userId: string }>(rows: (T | null)[]) =>
      rows.filter((row): row is T => row?.userId === args.userId);
    const [impressions, notes, highlights, threads] = await Promise.all([
      Promise.all(
        args.impressionIds.map((id) => ctx.db.get("impressions", id)),
      ),
      Promise.all(args.noteIds.map((id) => ctx.db.get("userNotes", id))),
      Promise.all(args.highlightIds.map((id) => ctx.db.get("highlights", id))),
      Promise.all(
        args.threadIds.map((id) => ctx.db.get("companionThreads", id)),
      ),
    ]);
    return {
      impressions: present(impressions),
      notes: present(notes),
      highlights: present(highlights),
      threads: present(threads),
    };
  },
});

export const loadArticles = internalQuery({
  args: { userId: v.string(), articleIds: v.array(v.id("articles")) },
  handler: async (ctx, args) => {
    const rows = await Promise.all(
      args.articleIds.map((id) => ctx.db.get("articles", id)),
    );
    // Only what the librarian needs; article bodies stay out of the prompt
    return rows.map((row) =>
      row?.userId === args.userId
        ? {
            ...row,
            content: undefined,
            contentHtml: undefined,
            embedding: undefined,
          }
        : null,
    );
  },
});

/**
 * The search-only path's lookup: each article with its read status. Scoped to
 * the caller's library even though the ids came from a filtered vector search.
 */
export const findArticles = internalQuery({
  args: { userId: v.string(), articleIds: v.array(v.id("articles")) },
  handler: async (ctx, args) => {
    const rows = await Promise.all(
      args.articleIds.map(async (id) => {
        const article = await ctx.db.get("articles", id);
        if (article?.userId !== args.userId) return null;
        const did = async (action: "finished" | "opened") =>
          (await ctx.db
            .query("articleInteractions")
            .withIndex("by_user_article_action", (q) =>
              q
                .eq("userId", args.userId)
                .eq("articleId", id)
                .eq("action", action),
            )
            .first()) !== null;
        const [finished, opened] = await Promise.all([
          did("finished"),
          did("opened"),
        ]);
        return {
          articleId: article._id,
          title: article.title,
          url: article.url,
          author: article.author ?? null,
          minutes: article.estimatedReadMinutes ?? null,
          status: finished ? "Read" : opened ? "Started" : "Unread",
        };
      }),
    );
    return rows.filter((row) => row !== null);
  },
});
