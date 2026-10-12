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
  },
});

async function pollSingleFeed(ctx: any, feed: any) {
  // Dynamic import for Node.js action
  const Parser = (await import("rss-parser")).default;
  const parser = new Parser({
    timeout: 10000,
    headers: {
      "User-Agent": "Marginalia/1.0",
    },
  });

  const parsed = await parser.parseURL(feed.url);
  let newCount = 0;

  for (const item of parsed.items ?? []) {
    const guid = item.guid || item.link || item.title || "";
    if (!guid) continue;

    // Dedup by guid
    const existing = await ctx.runQuery(internal.articles.getByGuid, {
      userId: feed.userId,
      guid,
    });
    if (existing) continue;

    await ctx.runMutation(internal.articles.insert, {
      feedId: feed._id,
      userId: feed.userId,
      guid,
      url: item.link || "",
      title: item.title || "Untitled",
      author: item.creator || item.author,
      publishedAt: item.pubDate ? new Date(item.pubDate).getTime() : undefined,
      excerpt: item.contentSnippet?.slice(0, 500),
      imageUrl: item.enclosure?.url,
      extractionStatus: "pending" as const,
      annotationStatus: "pending" as const,
      createdAt: Date.now(),
    });
    newCount++;
  }

  // Update feed last fetched
  await ctx.runMutation(internal.feeds.updateLastFetched, {
    feedId: feed._id,
  });

  if (newCount > 0) {
    console.log(`Feed ${feed.title}: ${newCount} new articles`);
    // Schedule extraction for pending articles
    await ctx.scheduler.runAfter(
      0,
      internal.actions.extractArticle.extractPending,
      { userId: feed.userId },
    );
  }
}
