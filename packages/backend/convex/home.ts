import { ownedArticle } from "./access";
import { query } from "./functions";

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
    const [unread, stats, notes] = await Promise.all([
      ctx.db
        .query("articles")
        .withIndex(
          "by_userId_and_bibleTranslation_and_annotationStatus_and_finishedAt",
          (q) =>
            q
              .eq("userId", ctx.readerId)
              .eq("bible.translation", undefined)
              .eq("annotationStatus", "annotated")
              .eq("finishedAt", undefined),
        )
        .order("desc")
        .take(10),
      ctx.db
        .query("readingQueueStats")
        .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
        .unique(),
      ctx.db
        .query("userNotes")
        .withIndex("by_user_recent", (q) => q.eq("userId", ctx.readerId))
        .order("desc")
        .take(1),
    ]);

    const latest = notes[0];
    const latestNoteArticle = latest
      ? await ownedArticle(ctx, latest.articleId, ctx.readerId)
      : null;

    return {
      countsReady: stats?.ready ?? false,
      annotatedTotal: stats?.annotated ?? unread.length,
      waiting: stats?.ready ? stats.waiting : null,
      pending: stats?.ready ? stats.pending : null,
      fits: {
        5: stats?.ready ? stats.fits5 : null,
        10: stats?.ready ? stats.fits10 : null,
        20: stats?.ready ? stats.fits20 : null,
        30: stats?.ready ? stats.waiting : null,
      },
      upNext: unread
        .filter((a) => !a.bible)
        .slice(0, 10)
        .map((a) => ({
          _id: a._id,
          title: a.title,
          author: a.author,
          source: hostOf(a.url),
          minutes: a.estimatedReadMinutes,
          excerpt: a.excerpt?.slice(0, 180),
          fromReader: Boolean(a.readerDocumentId),
        })),
      latestNote:
        latest && latestNoteArticle
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
