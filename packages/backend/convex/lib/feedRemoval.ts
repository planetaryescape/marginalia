import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { removeFromQueueStats } from "../readingQueue";
import { unlinkArticleTags } from "../tags";
import { bumpFeedArticleCount } from "./feedArticleCount";

/** What happens to a feed's articles when the reader unsubscribes. */
export const feedArticlesChoice = v.union(
  v.literal("keep"),
  v.literal("unread"),
  v.literal("all"),
);
export type FeedArticlesChoice = "keep" | "unread" | "all";

export interface ArticleUse {
  /** Highlights, notes, Ask threads, impressions or answered reflections */
  marked: boolean;
  /** Opened, finished, saved or loved */
  opened: boolean;
}

export async function articleUse(
  ctx: QueryCtx,
  article: Doc<"articles">,
): Promise<ArticleUse> {
  const byArticle = (
    table: "highlights" | "userNotes" | "companionThreads" | "impressions",
  ) =>
    ctx.db
      .query(table)
      .withIndex("by_article", (q) => q.eq("articleId", article._id))
      .first();
  const byUserArticle = (
    table: "savedArticles" | "lovedArticles" | "readingActivity",
  ) =>
    ctx.db
      .query(table)
      .withIndex("by_user_article", (q) =>
        q.eq("userId", article.userId).eq("articleId", article._id),
      )
      .first();
  const interaction = (action: "opened" | "finished") =>
    ctx.db
      .query("articleInteractions")
      .withIndex("by_user_article_action", (q) =>
        q
          .eq("userId", article.userId)
          .eq("articleId", article._id)
          .eq("action", action),
      )
      .first();

  const [highlight, note, thread, impression, reflections] = await Promise.all([
    byArticle("highlights"),
    byArticle("userNotes"),
    byArticle("companionThreads"),
    byArticle("impressions"),
    ctx.db
      .query("reflections")
      .withIndex("by_article", (q) => q.eq("articleId", article._id))
      .collect(),
  ]);
  const marked =
    !!(highlight || note || thread || impression) ||
    reflections.some((r) => r.userResponse !== undefined);

  const opened =
    article.finishedAt !== undefined ||
    (
      await Promise.all([
        interaction("opened"),
        interaction("finished"),
        byUserArticle("readingActivity"),
        byUserArticle("savedArticles"),
        byUserArticle("lovedArticles"),
      ])
    ).some(Boolean);

  return { marked, opened };
}

export function removes(choice: FeedArticlesChoice, use: ArticleUse): boolean {
  if (choice === "keep" || use.marked) return false;
  return choice === "all" || !use.opened;
}

/**
 * Deletes an article and what was generated for it. Reading history stays so
 * statistics don't change; it holds only the ID, which readers already skip
 * when the article is gone.
 */
export async function deleteArticle(
  ctx: MutationCtx,
  article: Doc<"articles">,
): Promise<void> {
  const generated = await Promise.all(
    (["annotations", "summaries", "reflections"] as const).map((table) =>
      ctx.db
        .query(table)
        .withIndex("by_article", (q) => q.eq("articleId", article._id))
        .collect(),
    ),
  );
  const marks = await Promise.all(
    (["savedArticles", "lovedArticles"] as const).map((table) =>
      ctx.db
        .query(table)
        .withIndex("by_user_article", (q) =>
          q.eq("userId", article.userId).eq("articleId", article._id),
        )
        .collect(),
    ),
  );
  for (const row of [...generated.flat(), ...marks.flat()])
    await ctx.db.delete(row._id);
  // Looked-up words are the reader's own and stay; only their link goes. Done
  // in its own transactions, because a feed removal deletes many articles in
  // one and each can have hundreds of lookups.
  await ctx.scheduler.runAfter(0, internal.lookups.markArticleGone, {
    userId: article.userId,
    articleId: article._id,
  });
  await unlinkArticleTags(ctx, article._id);
  await removeFromQueueStats(ctx, article);
  await ctx.db.delete("articles", article._id);
  await bumpFeedArticleCount(ctx, article.feedId, article.userId, -1);
  // A deleted article only removes a candidate connection, which adds nothing
  // for the margin to read, so it deliberately doesn't move the fingerprint.
}
