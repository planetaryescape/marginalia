import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";

const TIME_BUCKETS = [5, 10, 20, 30] as const;

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Everything the home page shows, without shipping article bodies to the client. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const [annotated, interactions, notes] = await Promise.all([
      ctx.db
        .query("articles")
        .withIndex("by_annotation_status", (q) =>
          q.eq("userId", DEFAULT_USER_ID).eq("annotationStatus", "annotated"),
        )
        .order("desc")
        .take(200),
      ctx.db
        .query("articleInteractions")
        .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
        .order("desc")
        .take(500),
      ctx.db
        .query("userNotes")
        .withIndex("by_user_recent", (q) => q.eq("userId", DEFAULT_USER_ID))
        .order("desc")
        .take(1),
    ]);

    const finished = new Set<Id<"articles">>(
      interactions
        .filter((i) => i.action === "finished")
        .map((i) => i.articleId),
    );
    const unread = annotated.filter((a) => !finished.has(a._id));

    // How many unread pieces fit each time choice; "30" means 30 minutes or more
    const fits = Object.fromEntries(
      TIME_BUCKETS.map((minutes) => [
        minutes,
        minutes === 30
          ? unread.length
          : unread.filter(
              (a) =>
                (a.estimatedReadMinutes ?? Number.POSITIVE_INFINITY) <= minutes,
            ).length,
      ]),
    ) as Record<(typeof TIME_BUCKETS)[number], number>;

    const latest = notes[0];
    const latestNoteArticle = latest
      ? await ctx.db.get("articles", latest.articleId)
      : null;

    return {
      annotatedTotal: annotated.length,
      waiting: unread.length,
      fits,
      upNext: unread.slice(0, 10).map((a) => ({
        _id: a._id,
        title: a.title,
        author: a.author,
        source: hostOf(a.url),
        minutes: a.estimatedReadMinutes,
        excerpt: a.excerpt?.slice(0, 180),
        fromReader: Boolean(a.readerDocumentId),
      })),
      latestNote: latest
        ? {
            articleId: latest.articleId,
            articleTitle: latestNoteArticle?.title,
            selectedText: latest.selectedText,
            text: latest.contentPlain.slice(0, 220),
            prompt: latest.prompt,
            createdAt: latest.createdAt,
          }
        : null,
    };
  },
});
