import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./functions";
import {
  feedEntry,
  feedUrl,
  OPML_BATCH_BYTES,
  OPML_BATCH_COUNT,
  utf8Bytes,
  validFeedEntry,
} from "./lib/feedPollProtocol";
import {
  articleUseWithoutReflections,
  feedArticlesChoice,
  finishFeedArticleProof,
  PreviewReadBudget,
  previewArticleUse,
  removes,
} from "./lib/feedRemoval";
import {
  advanceFeedRemovalRun,
  resumeFeedRemoval,
} from "./lib/feedRemovalState";
import {
  metadataLibraryActive,
  metadataLibraryRetained,
} from "./lib/shelfCounts";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("feeds")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .collect();
  },
});

export const add = mutation({
  args: {
    url: v.string(),
    title: v.string(),
    siteUrl: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const error = validFeedEntry(args);
    if (error) throw new Error(error);
    const url = feedUrl(args.url);
    // Check for duplicate
    const existing =
      (await ctx.db
        .query("feeds")
        .withIndex("by_user_url", (q) =>
          q.eq("userId", ctx.readerId).eq("url", url),
        )
        .first()) ??
      (await ctx.db
        .query("feeds")
        .withIndex("by_user_url", (q) =>
          q.eq("userId", ctx.readerId).eq("url", args.url),
        )
        .first());

    if (existing) {
      throw new Error("Feed already exists");
    }

    return ctx.db.insert("feeds", {
      userId: ctx.readerId,
      url,
      title: args.title,
      siteUrl: args.siteUrl,
      description: args.description,
      articleCount: 0,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

/** One authorization/transaction per small, replay-safe OPML acknowledgement. */
export const addBatch = mutation({
  args: { entries: v.array(feedEntry) },
  handler: async (ctx, { entries }) => {
    if (
      entries.length > OPML_BATCH_COUNT ||
      utf8Bytes(entries) > OPML_BATCH_BYTES
    )
      throw new Error("Import at most 10 feeds and 32 KiB per batch");
    const outcomes: Array<{
      status: "created" | "duplicate" | "invalid";
      url: string;
      message?: string;
    }> = [];
    for (const entry of entries) {
      const error = validFeedEntry(entry);
      if (error) {
        outcomes.push({ status: "invalid", url: entry.url, message: error });
        continue;
      }
      const url = feedUrl(entry.url);
      // Legacy single-add rows retain their exact URL; check both spellings.
      const existing =
        (await ctx.db
          .query("feeds")
          .withIndex("by_user_url", (q) =>
            q.eq("userId", ctx.readerId).eq("url", url),
          )
          .first()) ??
        (await ctx.db
          .query("feeds")
          .withIndex("by_user_url", (q) =>
            q.eq("userId", ctx.readerId).eq("url", entry.url),
          )
          .first());
      if (existing) {
        outcomes.push({ status: "duplicate", url: entry.url });
        continue;
      }
      await ctx.db.insert("feeds", {
        ...entry,
        url,
        title: entry.title || new URL(url).hostname,
        userId: ctx.readerId,
        articleCount: 0,
        isActive: true,
        createdAt: Date.now(),
      });
      outcomes.push({ status: "created", url: entry.url });
    }
    return outcomes;
  },
});

// Bounds the work behind one dialog; a feed polls at most a few posts at a time
const PREVIEW_LIMIT = 300;
// Source scan + trigger pre-delete + deletion's own read, plus protected
// user material checks. Keep one near-limit article per transaction.
const REMOVAL_PAGE = 1;

/** How many of a feed's articles each removal choice would delete. */
export const removalPreview = query({
  args: { feedId: v.id("feeds") },
  handler: async (ctx, args) => {
    const feed = await ctx.db.get(args.feedId);
    if (feed?.userId !== ctx.readerId) return null;
    const articles = ctx.db
      .query("articles")
      .withIndex("by_feed", (q) => q.eq("feedId", args.feedId))
      [Symbol.asyncIterator]();
    const budget = new PreviewReadBudget();
    const result = {
      total: 0,
      unread: 0,
      unreadInReader: 0,
      all: 0,
      allInReader: 0,
      partial: false,
    };
    for (let scanned = 0; ; scanned++) {
      const article = await budget.read(async () => {
        const next = await articles.next();
        return next.done ? null : next.value;
      });
      if (article === null) break;
      if (article === undefined || scanned === PREVIEW_LIMIT) {
        result.partial = true;
        break;
      }
      if (article.userId !== ctx.readerId) continue;
      result.total++;
      const use = await previewArticleUse(ctx, article, budget);
      if (use === null) {
        result.partial = true;
        break;
      }
      if (removes("all", use)) {
        result.all++;
        if (article.readerDocumentId) result.allInReader++;
      }
      if (removes("unread", use)) {
        result.unread++;
        if (article.readerDocumentId) result.unreadInReader++;
      }
    }
    return result;
  },
});

export const remove = mutation({
  args: {
    feedId: v.id("feeds"),
    // Optional so a page loaded before this release keeps its old behaviour
    articles: v.optional(feedArticlesChoice),
  },
  handler: async (ctx, args) => {
    const feed = await ctx.db.get(args.feedId);
    if (feed?.userId !== ctx.readerId) throw new Error("Feed not found");
    await ctx.db.delete(args.feedId);
    // A kept suggestion is about this feed alone
    const kept = await ctx.db
      .query("suggestionKeeps")
      .withIndex("by_user_kind_subject", (q) =>
        q
          .eq("userId", ctx.readerId)
          .eq("kind", "feed")
          .eq("subject", args.feedId),
      )
      .first();
    if (kept) await ctx.db.delete(kept._id);
    const choice = args.articles ?? "keep";
    if (choice !== "keep")
      await ctx.scheduler.runAfter(0, internal.feeds.removeArticles, {
        userId: ctx.readerId,
        feedId: args.feedId,
        choice,
      });
  },
});

export const toggleActive = mutation({
  args: { feedId: v.id("feeds") },
  handler: async (ctx, args) => {
    const feed = await ctx.db.get(args.feedId);
    if (feed?.userId !== ctx.readerId) throw new Error("Feed not found");
    await ctx.db.patch(args.feedId, {
      isActive: !feed.isActive,
      checkingSince: undefined,
    });
  },
});

// --- Internal ---

export const listActive = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    if (!(await metadataLibraryActive(ctx, args.userId))) return [];
    const feeds = await ctx.db
      .query("feeds")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    // Legacy return semantics retained; the durable path never calls this scan.
    return feeds.filter((f) => f.isActive);
  },
});

/** Deletes an unsubscribed feed's articles a page at a time, per the reader's choice. */
export const removeArticles = internalMutation({
  args: {
    userId: v.string(),
    feedId: v.id("feeds"),
    choice: feedArticlesChoice,
    cursor: v.optional(v.string()),
    // Reader deletes scheduled so far, to keep spacing them across pages
    readerDeletes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (
      args.choice === "keep" ||
      !(await metadataLibraryRetained(ctx, args.userId))
    )
      return;
    let run = await ctx.db
      .query("feedArticleCleanup")
      .withIndex("by_feedId_phase", (q) =>
        q.eq("feedId", args.feedId).eq("phase", "feed"),
      )
      .unique();
    if (!run) {
      const id = await ctx.db.insert("feedArticleCleanup", {
        userId: args.userId,
        feedId: args.feedId,
        phase: "feed",
        choice: args.choice,
        cursor: args.cursor,
        readerDeletes: args.readerDeletes ?? 0,
      });
      run = await ctx.db.get(id);
    }
    if (
      run?.phase !== "feed" ||
      run.userId !== args.userId ||
      run.choice !== args.choice
    )
      return;
    if (run.currentJobId) {
      const pending = await ctx.db.get(run.currentJobId);
      if (pending?.phase !== "checking" || pending.runId !== run._id)
        throw new Error("Removal run lost its checking proof");
      await ctx.scheduler.runAfter(0, internal.feedRemovalCleanup.prepare, {
        jobId: pending._id,
      });
      return;
    }
    const readerDeletes = run.readerDeletes;
    const page = await ctx.db
      .query("articles")
      .withIndex("by_feed", (q) => q.eq("feedId", args.feedId))
      .paginate({ cursor: run.cursor ?? null, numItems: REMOVAL_PAGE });
    for (const article of page.page) {
      if (article.userId !== args.userId) continue;
      let job = await ctx.db
        .query("feedArticleCleanup")
        .withIndex("by_articleId", (q) => q.eq("articleId", article._id))
        .unique();
      if (!job) {
        const id = await ctx.db.insert("feedArticleCleanup", {
          userId: args.userId,
          articleId: article._id,
          phase: "checking",
          runId: run._id,
          feedId: args.feedId,
          choice: args.choice,
          revision: 0,
          resumeCursor: page.continueCursor,
          sourceDone: page.isDone,
          readerDeletes,
        });
        job = await ctx.db.get(id);
      }
      if (job?.phase !== "checking" || job.runId !== run._id)
        throw new Error("Source already has a different removal owner");
      await ctx.db.patch(run._id, { currentJobId: job._id });
      if (
        job?.phase === "checking" &&
        job.userId === args.userId &&
        job.feedId === args.feedId &&
        job.choice === args.choice
      ) {
        // A genuinely empty indexed range proves complete absence atomically;
        // this is not a bounded partial scan treated as absence. Nonempty
        // fanout always goes through the separate byte-bounded proof scan.
        const first = await ctx.db
          .query("reflections")
          .withIndex("by_article", (q) => q.eq("articleId", article._id))
          .first();
        if (!first) {
          if (
            removes(
              job.choice,
              await articleUseWithoutReflections(ctx, article),
            )
          )
            await finishFeedArticleProof(ctx, job, article);
          else {
            await ctx.db.delete(job._id);
            await resumeFeedRemoval(ctx, job);
          }
        } else
          await ctx.scheduler.runAfter(0, internal.feedRemovalCleanup.prepare, {
            jobId: job._id,
          });
      }
      return;
    }
    await advanceFeedRemovalRun(ctx, run, page.continueCursor, page.isDone);
  },
});

export const updateLastFetched = internalMutation({
  args: { feedId: v.id("feeds"), importAfter: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const feed = await ctx.db.get(args.feedId);
    const state = await ctx.db
      .query("feedPollStates")
      .withIndex("by_feedId", (q) => q.eq("feedId", args.feedId))
      .unique();
    if (
      !feed?.isActive ||
      state ||
      !(await metadataLibraryActive(ctx, feed.userId))
    )
      return;
    await ctx.db.patch(args.feedId, {
      checkingSince: undefined,
      lastFetchedAt: Date.now(),
      lastError: undefined,
      importAfter: args.importAfter,
    });
  },
});

/** Flags the reader's active feeds as being checked, until each finishes. */
export const markChecking = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<number | null> => {
    const run: number | null = await ctx.runMutation(
      internal.feedPolling.begin,
      args,
    );
    return run;
  },
});

export const pollNow = action({
  args: {},
  handler: async (ctx): Promise<number | null> => {
    // A durable run, not the browser's lifetime, owns checking and recovery.
    const run: number | null = await ctx.runMutation(
      internal.feeds.markChecking,
      {
        userId: ctx.readerId,
      },
    );
    return run;
  },
});

export const updateError = internalMutation({
  args: { feedId: v.id("feeds"), error: v.string() },
  handler: async (ctx, args) => {
    const feed = await ctx.db.get(args.feedId);
    const state = await ctx.db
      .query("feedPollStates")
      .withIndex("by_feedId", (q) => q.eq("feedId", args.feedId))
      .unique();
    if (
      !feed?.isActive ||
      state ||
      !(await metadataLibraryActive(ctx, feed.userId))
    )
      return;
    await ctx.db.patch(args.feedId, {
      checkingSince: undefined,
      lastError: args.error,
    });
  },
});

// Articles can be about 900 KB each and a page reads whole rows
const COUNT_PAGE = 10;

/**
 * Sets each feed's articleCount from its articles, ten rows at a time, then
 * moves to the next feed. A feed's count stays unset until its last page, which
 * sets it in the same transaction that read the last rows, so articles inserted
 * while it runs are either scanned or counted live. Rerunning is safe. An
 * article deleted after its page was scanned and before the feed finished is
 * still in the count; a rerun corrects it.
 *
 * Run: bunx convex run feeds:backfillArticleCounts '{"userId":"<id>"}'
 */
export const backfillArticleCounts = internalMutation({
  args: {
    userId: v.string(),
    remaining: v.optional(v.array(v.id("feeds"))),
    cursor: v.optional(v.string()),
    counted: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const remaining =
      args.remaining ??
      (
        await ctx.db
          .query("feeds")
          .withIndex("by_user", (q) => q.eq("userId", args.userId))
          .collect()
      ).map((f) => f._id);
    const [feedId, ...rest] = remaining;
    if (!feedId) return;
    const feed = await ctx.db.get(feedId);
    if (feed?.userId !== args.userId) {
      await ctx.scheduler.runAfter(0, internal.feeds.backfillArticleCounts, {
        userId: args.userId,
        remaining: rest,
      });
      return;
    }
    const page = await ctx.db
      .query("articles")
      .withIndex("by_user_feed", (q) =>
        q.eq("userId", args.userId).eq("feedId", feedId),
      )
      .paginate({ cursor: args.cursor ?? null, numItems: COUNT_PAGE });
    const counted = (args.counted ?? 0) + page.page.length;
    if (page.isDone) {
      await ctx.db.patch(feedId, { articleCount: counted });
      if (rest.length)
        await ctx.scheduler.runAfter(0, internal.feeds.backfillArticleCounts, {
          userId: args.userId,
          remaining: rest,
        });
      return;
    }
    await ctx.scheduler.runAfter(0, internal.feeds.backfillArticleCounts, {
      userId: args.userId,
      remaining,
      cursor: page.continueCursor,
      counted,
    });
  },
});
