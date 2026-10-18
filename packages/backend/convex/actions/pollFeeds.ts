"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

export const pollAllFeeds = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    // Disabled and deleted readers get no background work
    if (!(await ctx.runQuery(internal.access.libraryActive, args))) return;
    const feeds = await ctx.runQuery(internal.feeds.listActive, {
      userId: args.userId,
    });

    // The cron polls without pollNow, so the flag is set here too
    await ctx.runMutation(internal.feeds.markChecking, args);
    for (const feed of feeds) {
      try {
        await pollSingleFeed(ctx, feed);
      } catch (error) {
        console.error(`Failed to poll feed ${feed.url}:`, error);
        await ctx.runMutation(internal.feeds.updateError, {
          feedId: feed._id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
    // A bounded legacy wake for the whole poll, even with no new posts.
    // Per-row claims make overlapping poll deliveries safe.
    await ctx.scheduler.runAfter(
      0,
      internal.actions.extractArticle.extractPending,
      { userId: args.userId },
    );
  },
});

// A newly added feed brings only its latest posts, not its whole archive:
// importing a few dozen feeds would otherwise fill the queue with hundreds of
// old posts and annotate every one
export const FIRST_POLL_POSTS = 3;
// …and only recent ones, so a feed that went quiet years ago adds nothing
const FIRST_POLL_MAX_AGE_MS = 30 * 86_400_000;

async function pollSingleFeed(ctx: any, feed: any): Promise<number> {
  // Dynamic import for Node.js action
  const Parser = (await import("rss-parser")).default;
  const response = await fetch(feed.url, {
    headers: { "User-Agent": "Marginalia/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Feed returned ${response.status}`);
  const parsed = await new Parser().parseString(await response.text());

  const items = (parsed.items ?? []).map((item) => ({
    item,
    publishedAt: item.pubDate ? new Date(item.pubDate).getTime() : undefined,
  }));
  let candidates = items;
  let importAfter: number | undefined = feed.importAfter;
  if (!feed.lastFetchedAt) {
    // Feeds list newest first; dated posts are sorted in case one doesn't
    const dated = items.filter((i): i is typeof i & { publishedAt: number } =>
      Number.isFinite(i.publishedAt),
    );
    if (dated.length) {
      const cutoff = Date.now() - FIRST_POLL_MAX_AGE_MS;
      candidates = dated
        .filter((i) => i.publishedAt >= cutoff)
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .slice(0, FIRST_POLL_POSTS);
      // A feed with nothing recent waits for its next post
      importAfter = candidates.length
        ? Math.min(...candidates.map((i) => i.publishedAt as number))
        : Math.max(...dated.map((i) => i.publishedAt)) + 1;
    } else {
      candidates = items.slice(0, FIRST_POLL_POSTS);
      importAfter = undefined;
    }
  } else if (importAfter !== undefined) {
    // Keeps the older posts left out on the first poll out for good. Undated
    // posts can't be placed, so they're treated as new.
    candidates = items.filter(
      (i) =>
        !Number.isFinite(i.publishedAt) ||
        (i.publishedAt as number) >= importAfter!,
    );
  }

  let newCount = 0;
  for (const { item, publishedAt } of candidates) {
    const guid = item.guid || item.link || item.title || "";
    if (!guid) continue;

    const result = await ctx.runMutation(internal.articles.upsertFeed, {
      feedId: feed._id,
      userId: feed.userId,
      guid,
      url: item.link || "",
      title: item.title || "Untitled",
      author: item.creator || item.author,
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined,
      excerpt: item.contentSnippet?.slice(0, 500),
      imageUrl: item.enclosure?.url,
      extractionStatus: "pending" as const,
      annotationStatus: "pending" as const,
      createdAt: Date.now(),
    });
    if (result.created) newCount++;
  }

  await ctx.runMutation(internal.feeds.updateLastFetched, {
    feedId: feed._id,
    importAfter,
  });

  if (newCount > 0) {
    console.log(`Feed ${feed.title}: ${newCount} new articles`);
  }
  return newCount;
}
