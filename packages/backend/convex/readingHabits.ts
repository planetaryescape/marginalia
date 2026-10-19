import type { Id } from "./_generated/dataModel";
import { query } from "./functions";
import { roomPeriod } from "./lib/readingRoom";
import { reportingTags } from "./lib/reportingTags";
import { periodVisits, roomArgs } from "./stats";

// Interaction rows read for the period, newest first. A finish or abandon row
// can carry up to 128 annotation ids (about 4.7 KB), so 1,500 rows stay near
// 7 MB in the worst case, well under Convex's 16 MiB read limit.
const HABIT_EVENTS = 1500;
// Sessions are small rows, one per time choice
const HABIT_SESSIONS = 1000;
// Finished books are small rows kept apart from their article; this many are read
const HABIT_BOOKS = 100;

/**
 * How the reader reads, for the period: the times they chose, Another
 * presses, finishes, and articles opened and left unfinished. Counts only; no
 * row leaves the server. `partial` when a cap cut the period short.
 *
 * Nothing in the product records an abandon event, so "left unfinished" is
 * the articles opened in the period that no finish followed, plus any
 * explicitly abandoned.
 */
export const readingHabits = query({
  args: roomArgs,
  handler: async (ctx, { timeZone, period: periodName }) => {
    const period = roomPeriod(Date.now(), timeZone, periodName);
    const [events, sessions, books] = await Promise.all([
      ctx.db
        .query("articleInteractions")
        .withIndex("by_user_created", (q) =>
          q
            .eq("userId", ctx.readerId)
            .gte("createdAt", period.start)
            .lt("createdAt", period.end),
        )
        .order("desc")
        .take(HABIT_EVENTS + 1),
      ctx.db
        .query("sessions")
        .withIndex("by_user_recent", (q) =>
          q
            .eq("userId", ctx.readerId)
            .gte("startedAt", period.start)
            .lt("startedAt", period.end),
        )
        .order("desc")
        .take(HABIT_SESSIONS + 1),
      // Finishing a book writes no "finished" interaction, only its progress row
      ctx.db
        .query("books")
        .withIndex("by_userId_and_finished", (q) =>
          q.eq("userId", ctx.readerId).eq("finished", true),
        )
        .order("desc")
        .take(HABIT_BOOKS),
    ]);
    const shownEvents = events.slice(0, HABIT_EVENTS);
    const shownSessions = sessions.slice(0, HABIT_SESSIONS);

    const choices = new Map<number, number>();
    for (const session of shownSessions)
      choices.set(
        session.requestedMinutes,
        (choices.get(session.requestedMinutes) ?? 0) + 1,
      );

    const opened = new Set<Id<"articles">>();
    const finished = new Set<Id<"articles">>();
    const abandoned = new Set<Id<"articles">>();
    let anotherPresses = 0;
    for (const event of shownEvents) {
      if (event.action === "opened") opened.add(event.articleId);
      else if (event.action === "finished") finished.add(event.articleId);
      else if (event.action === "abandoned") abandoned.add(event.articleId);
      else if (event.action === "skipped") anotherPresses++;
    }
    for (const book of books)
      if (
        book.lastReadAt !== undefined &&
        book.lastReadAt >= period.start &&
        book.lastReadAt < period.end
      )
        finished.add(book.articleId);
    for (const id of opened) if (!finished.has(id)) abandoned.add(id);
    for (const id of finished) abandoned.delete(id);

    return {
      timesChosen: [...choices.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([minutes, count]) => ({ minutes, count })),
      anotherPresses,
      finishes: finished.size,
      leftUnfinished: abandoned.size,
      partial: events.length > HABIT_EVENTS || sessions.length > HABIT_SESSIONS,
    };
  },
});

// Distinct articles whose dwell is read, newest read first. Each paragraphDwell
// row holds up to 300 entries (about 4.5 KB). Every visit in the period counts;
// the rows read are bounded in total, and `partial` says when that cut it short.
// The last batch can overshoot by one batch, so the worst case is about
// (500 + 20 x 21) rows, 4 MB, beside the 7 MB of visits `periodVisits` reads.
const LINGER_ARTICLES = 100;
const DWELL_VISITS_PER_ARTICLE = 20;
const DWELL_ROWS_TOTAL = 500;
const ARTICLE_BATCH = 20;
const TAGS_PER_ARTICLE = 20;
// A topic needs this many held paragraphs before its average means anything
const MIN_PARAGRAPHS = 8;
// Preserve the candidate cutoff before active/owner filtering. Ready metadata
// avoids embeddings; unsupported libraries retain canonical tag hydration.
const TAG_CANDIDATES = 40;
const LINGER_SHOWN = 8;

/**
 * Where the reader lingers: for each topic, the average seconds a paragraph
 * held them, over paragraphs they stayed on for at least a second (that is
 * all the dwell record keeps). Topics are the active tags on the articles
 * read in the period, as in `readingTopics`.
 */
export const readingLinger = query({
  args: roomArgs,
  handler: async (ctx, { timeZone, period: periodName }) => {
    const {
      period,
      rows,
      partial: visitsPartial,
    } = await periodVisits(ctx, ctx.readerId, timeZone, periodName);
    const articleIds: Id<"articles">[] = [];
    const seen = new Set<Id<"articles">>();
    for (const row of rows) {
      if (row.activeTimeMs <= 0 || seen.has(row.articleId)) continue;
      seen.add(row.articleId);
      articleIds.push(row.articleId);
      if (articleIds.length === LINGER_ARTICLES) break;
    }

    let partial = visitsPartial;
    let dwellRowsRead = 0;
    const perTag = new Map<
      Id<"tags">,
      { ms: number; paragraphs: number; articles: number }
    >();
    for (let i = 0; i < articleIds.length; i += ARTICLE_BATCH) {
      if (dwellRowsRead >= DWELL_ROWS_TOTAL) {
        partial = true;
        break;
      }
      await Promise.all(
        articleIds.slice(i, i + ARTICLE_BATCH).map(async (articleId) => {
          const [dwellRows, links] = await Promise.all([
            ctx.db
              .query("paragraphDwell")
              .withIndex("by_user_article", (q) =>
                q.eq("userId", ctx.readerId).eq("articleId", articleId),
              )
              .order("desc")
              .take(DWELL_VISITS_PER_ARTICLE + 1),
            ctx.db
              .query("articleTags")
              .withIndex("by_article", (q) => q.eq("articleId", articleId))
              .take(TAGS_PER_ARTICLE),
          ]);
          dwellRowsRead += dwellRows.length;
          if (dwellRows.length > DWELL_VISITS_PER_ARTICLE) partial = true;
          let ms = 0;
          let paragraphs = 0;
          for (const row of dwellRows.slice(0, DWELL_VISITS_PER_ARTICLE)) {
            if (row.updatedAt < period.start || row.updatedAt >= period.end)
              continue;
            for (const held of Object.values(row.dwell)) {
              ms += held;
              paragraphs++;
            }
          }
          if (!paragraphs) return;
          // by_article is not scoped to a reader, so check the owner of each link
          for (const link of links) {
            if (link.userId !== ctx.readerId) continue;
            const seenTag = perTag.get(link.tagId) ?? {
              ms: 0,
              paragraphs: 0,
              articles: 0,
            };
            perTag.set(link.tagId, {
              ms: seenTag.ms + ms,
              paragraphs: seenTag.paragraphs + paragraphs,
              articles: seenTag.articles + 1,
            });
          }
        }),
      );
    }

    const ranked = [...perTag.entries()]
      .filter(([, t]) => t.paragraphs >= MIN_PARAGRAPHS)
      .sort(
        (a, b) =>
          b[1].ms / b[1].paragraphs - a[1].ms / a[1].paragraphs ||
          a[0].localeCompare(b[0]),
      )
      .slice(0, TAG_CANDIDATES);
    const topics = [];
    const tags = await reportingTags(ctx, ctx.readerId);
    for (const [tagId, total] of ranked) {
      const name = await tags.name(tagId);
      if (name === null) continue;
      topics.push({
        name,
        secondsPerParagraph:
          Math.round((total.ms / total.paragraphs / 1000) * 10) / 10,
        paragraphs: total.paragraphs,
        articles: total.articles,
      });
      if (topics.length === LINGER_SHOWN) break;
    }
    return { topics, partial };
  },
});
