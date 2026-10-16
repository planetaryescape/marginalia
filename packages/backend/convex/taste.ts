import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { libraryIsActive } from "./access";
import { internalMutation, type MutationCtx, type QueryCtx } from "./functions";
import {
  type ArticleSignals,
  addTally,
  evidenceOf,
  feedAffinities,
  normaliseAuthor,
  PROFILE_CAP,
  type Tally,
  type Taste,
  type TasteProfile,
  tallyEntries,
  tasteOf,
  whyLine,
} from "./lib/taste";

// Newest interactions read, and distinct articles kept from them with the
// reader's loves and ratings. Each article is one whole row to read.
const INTERACTIONS = 300;
const LOVES = 50;
const RATINGS = 50;
const MAX_ARTICLES = 300;
// Articles read per transaction: a row can hold about 900 KB of text, and a
// transaction may read 16 MiB
const STEP = 8;
const FEEDS = 200;
// Tags considered before the inactive ones are dropped; each row carries an embedding
const TAG_CANDIDATES = PROFILE_CAP * 3;
const TAGS_PER_ARTICLE = 6;
// A finish queues one refresh, run after the reader has stopped for a moment
const REFRESH_DELAY_MS = 5 * 60_000;
const REFRESH_LAPSE_MS = 15 * 60_000;

type Reader = Pick<QueryCtx, "db"> & { readerId: string };

const tally = v.record(
  v.string(),
  v.object({ pos: v.number(), neg: v.number() }),
);
const event = v.object({
  articleId: v.id("articles"),
  finished: v.boolean(),
  opened: v.boolean(),
  skipped: v.boolean(),
  loved: v.boolean(),
  rating: v.optional(v.number()),
});

/** The reader's profile as the ranking uses it, or null before one exists. */
export async function readTasteProfile(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
): Promise<TasteProfile | null> {
  const row = await ctx.db
    .query("tasteProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!row || row.computedAt === 0) return null;
  return { feeds: row.feeds, authors: row.authors, tags: row.tags };
}

/**
 * Taste for each article, keyed by ID. Reads the profile once and, only when
 * it holds something, each article's few tag links; never an article's text.
 */
export async function loadTaste(
  ctx: Reader,
  articles: Doc<"articles">[],
): Promise<Map<Id<"articles">, Taste>> {
  const taste = new Map<Id<"articles">, Taste>();
  const profile = await readTasteProfile(ctx, ctx.readerId);
  if (!profile) return taste;
  await Promise.all(
    articles.map(async (a) => {
      const links = await ctx.db
        .query("articleTags")
        .withIndex("by_article", (q) => q.eq("articleId", a._id))
        .take(TAGS_PER_ARTICLE);
      taste.set(
        a._id,
        tasteOf(profile, {
          feedId: a.feedId,
          author: a.author,
          tagIds: links
            .filter((l) => l.userId === ctx.readerId)
            .map((l) => l.tagId),
        }),
      );
    }),
  );
  return taste;
}

/** The pick's reason when taste has something to say, else undefined. */
export async function tasteReason(
  ctx: Reader,
  taste: Taste | undefined,
): Promise<string | undefined> {
  if (!taste?.because) return undefined;
  let name: string | undefined;
  if (taste.because.source === "tag") {
    const id = ctx.db.normalizeId("tags", taste.because.key);
    const tag = id ? await ctx.db.get(id) : null;
    if (tag?.userId === ctx.readerId && tag.status === "active")
      name = tag.name;
  }
  return whyLine(taste.because, name);
}

/**
 * Queues a refresh of the reader's profile after they finish something. One
 * is queued at a time, so a run of finishes costs one recompute.
 */
export async function queueTasteRefresh(ctx: MutationCtx, userId: string) {
  // Not while the library is being deleted: the purge may already be past this table
  if (!(await libraryIsActive(ctx, userId))) return;
  const now = Date.now();
  const row = await ctx.db
    .query("tasteProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (row?.refreshQueuedAt && now - row.refreshQueuedAt < REFRESH_LAPSE_MS)
    return;
  if (row)
    await ctx.db.patch("tasteProfiles", row._id, { refreshQueuedAt: now });
  else
    await ctx.db.insert("tasteProfiles", {
      userId,
      feeds: [],
      authors: [],
      tags: [],
      evidence: 0,
      computedAt: 0,
      refreshQueuedAt: now,
    });
  await ctx.scheduler.runAfter(REFRESH_DELAY_MS, internal.taste.recompute, {
    userId,
  });
}

/**
 * Starts a recompute of one reader's profile: gathers what they did with which
 * articles from small rows, then reads the articles a few at a time.
 */
export const recompute = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    if (!(await libraryIsActive(ctx, userId))) return null;
    const signals = new Map<Id<"articles">, ArticleSignals>();
    const signalsOf = (id: Id<"articles">) => {
      let s = signals.get(id);
      if (!s) {
        s = { finished: false, opened: false, skipped: false, loved: false };
        signals.set(id, s);
      }
      return s;
    };
    const interactions = await ctx.db
      .query("articleInteractions")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(INTERACTIONS);
    for (const i of interactions) {
      if (i.action === "finished") signalsOf(i.articleId).finished = true;
      else if (i.action === "opened") signalsOf(i.articleId).opened = true;
      else if (i.action === "skipped") signalsOf(i.articleId).skipped = true;
    }
    const loves = await ctx.db
      .query("lovedArticles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(LOVES);
    for (const love of loves) signalsOf(love.articleId).loved = true;
    const ratings = await ctx.db
      .query("impressions")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .take(RATINGS);
    for (const r of ratings)
      if (r.rating !== undefined) signalsOf(r.articleId).rating = r.rating;

    const events = [...signals.entries()]
      .slice(0, MAX_ARTICLES)
      .map(([articleId, s]) => ({ articleId, ...s }));
    await ctx.scheduler.runAfter(0, internal.taste.accumulate, {
      userId,
      events,
      offset: 0,
      authors: {},
      tags: {},
    });
    return null;
  },
});

/** Reads the next few articles of a recompute, then continues or writes the profile. */
export const accumulate = internalMutation({
  args: {
    userId: v.string(),
    events: v.array(event),
    offset: v.number(),
    authors: tally,
    tags: tally,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = args;
    if (!(await libraryIsActive(ctx, userId))) return null;
    const authors: Tally = { ...args.authors };
    const tags: Tally = { ...args.tags };
    for (const e of args.events.slice(args.offset, args.offset + STEP)) {
      const article = await ctx.db.get("articles", e.articleId);
      // Deleted articles keep their history rows but have nothing to credit
      if (article?.userId !== userId) continue;
      const evidence = evidenceOf(e);
      const author = normaliseAuthor(article.author);
      if (author) addTally(authors, author, evidence);
      const links = await ctx.db
        .query("articleTags")
        .withIndex("by_article", (q) => q.eq("articleId", article._id))
        .take(TAGS_PER_ARTICLE);
      for (const link of links)
        if (link.userId === userId) addTally(tags, link.tagId, evidence);
    }
    const next = args.offset + STEP;
    if (next < args.events.length) {
      await ctx.scheduler.runAfter(0, internal.taste.accumulate, {
        ...args,
        offset: next,
        authors,
        tags,
      });
      return null;
    }

    const stats = await ctx.db
      .query("feedStats")
      .withIndex("by_user_feed", (q) => q.eq("userId", userId))
      .take(FEEDS);
    // Candidate tags and deleted ones are not topics (D-DES-059)
    const activeTags = [];
    for (const entry of tallyEntries(tags, TAG_CANDIDATES)) {
      const id = ctx.db.normalizeId("tags", entry.key);
      const tag = id ? await ctx.db.get(id) : null;
      if (tag?.userId === userId && tag.status === "active")
        activeTags.push(entry);
    }
    const profile = {
      feeds: feedAffinities(
        stats.map((s) => ({
          feedId: s.feedId,
          offered: s.offered,
          opened: s.opened,
          finished: s.finished,
        })),
      ),
      authors: tallyEntries(authors),
      tags: activeTags.slice(0, PROFILE_CAP),
      evidence: args.events.length,
      computedAt: Date.now(),
      refreshQueuedAt: undefined,
    };
    const row = await ctx.db
      .query("tasteProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (row)
      await ctx.db.replace("tasteProfiles", row._id, { userId, ...profile });
    else await ctx.db.insert("tasteProfiles", { userId, ...profile });
    return null;
  },
});
