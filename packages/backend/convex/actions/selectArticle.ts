"use node";
import { v } from "convex/values";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { action } from "../functions";
import { WORDS_PER_MINUTE } from "../lib/constants";

interface ArticleCandidate {
  _id: Id<"articles">;
  title: string;
  author?: string;
  url: string;
  imageUrl?: string;
  estimatedReadMinutes?: number;
  publishedAt?: number;
  excerpt?: string;
  feedId?: Id<"feeds">;
  reason: string;
}

export const select = action({
  args: { requestedMinutes: v.number() },
  handler: async (ctx, args): Promise<ArticleCandidate[]> => {
    const targetMinutes = args.requestedMinutes;
    if (
      !Number.isFinite(targetMinutes) ||
      targetMinutes <= 0 ||
      targetMinutes > 180
    ) {
      throw new Error("Choose a reading window between 1 and 180 minutes.");
    }

    // Get all annotated articles
    const articles: Doc<"articles">[] = await ctx.runQuery(
      api.articles.listAnnotated,
    );

    // Get user's interactions to exclude already-read articles
    const interactions: Doc<"articleInteractions">[] = await ctx.runQuery(
      api.sessions.listRecentInteractions,
    );
    const openedIds = new Set(
      interactions
        .filter((i) => i.action === "opened" || i.action === "finished")
        .map((i) => i.articleId),
    );

    // Filter out already-read articles
    const unread = articles.filter((a) => !openedIds.has(a._id));

    if (unread.length === 0) return [];

    // Score each article: prefer articles close to target time, then recency
    const scored = unread.map((a) => {
      const wc = a.wordCount ?? 0;
      const readMin =
        a.estimatedReadMinutes ?? (Math.ceil(wc / WORDS_PER_MINUTE) || 1);

      // Time fit score: 0 (perfect match) to negative (further away)
      const timeDiff = Math.abs(readMin - targetMinutes);
      const timeFit = -timeDiff;

      // Recency score
      let recency = 0;
      if (a.publishedAt) {
        const daysOld = (Date.now() - a.publishedAt) / (1000 * 60 * 60 * 24);
        recency = Math.max(0, 10 - daysOld * 0.1);
      }

      return {
        ...a,
        readMin,
        timeFit,
        score: timeFit * 2 + recency,
        fitsWindow: readMin <= targetMinutes * 1.3,
      };
    });

    // Sort by score (best fit first)
    scored.sort((a, b) => b.score - a.score);

    // Take top 3
    const top = scored.slice(0, 3);

    return top.map((a) => ({
      _id: a._id,
      title: a.title,
      author: a.author,
      url: a.url,
      imageUrl: a.imageUrl,
      estimatedReadMinutes: a.readMin,
      publishedAt: a.publishedAt,
      excerpt: a.excerpt,
      feedId: a.feedId,
      reason: generateReason(a.readMin, targetMinutes, a.fitsWindow),
    }));
  },
});

function generateReason(
  readMin: number,
  targetMinutes: number,
  fitsWindow: boolean,
): string {
  if (fitsWindow && Math.abs(readMin - targetMinutes) <= 2) {
    return `Fits your ${targetMinutes}-minute window`;
  }
  if (fitsWindow) {
    return `${readMin} min read — within your window`;
  }
  if (readMin < targetMinutes) {
    return `${readMin} min — shorter than requested, but worth your time`;
  }
  return `${readMin} min — longer than requested`;
}
