import { v } from "convex/values";
import { libraryIsActive } from "./access";
import { readableFeedStats } from "./feedStats";
import { mutation, query } from "./functions";
import { skipsMostOf } from "./lib/readingRoom";

/** How long "Keep" silences a feed's suggestion. */
export const KEEP_MS = 90 * 24 * 60 * 60_000;
const FEEDS = 200;
const SHOWN = 3;

/**
 * Feeds the reader was offered plenty of and almost never opened, for Sources
 * to ask about (D-DES-057). A suggestion only: nothing is removed until the
 * reader presses Unsubscribe, which goes through feeds.remove.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stats = await readableFeedStats(ctx, ctx.readerId, FEEDS);
    const skipped = stats
      .filter((s) => skipsMostOf(s.offered, s.opened))
      .sort(
        (a, b) => b.offered - a.offered || a.feedId.localeCompare(b.feedId),
      );
    const out: {
      feedId: (typeof stats)[number]["feedId"];
      offered: number;
      opened: number;
    }[] = [];
    for (const s of skipped) {
      if (out.length >= SHOWN) break;
      const feed = await ctx.db.get("feeds", s.feedId);
      // A paused feed offers nothing more, so there is nothing to unsubscribe from
      if (feed?.userId !== ctx.readerId || !feed.isActive) continue;
      const kept = await ctx.db
        .query("suggestionKeeps")
        .withIndex("by_user_kind_subject", (q) =>
          q
            .eq("userId", ctx.readerId)
            .eq("kind", "feed")
            .eq("subject", s.feedId),
        )
        .first();
      if (kept?.until !== undefined && kept.until > now) continue;
      out.push({ feedId: s.feedId, offered: s.offered, opened: s.opened });
    }
    return out;
  },
});

/** The reader keeps the feed: its suggestion stays quiet for 90 days. */
export const keep = mutation({
  args: { feedId: v.id("feeds") },
  returns: v.null(),
  handler: async (ctx, { feedId }) => {
    const feed = await ctx.db.get("feeds", feedId);
    if (feed?.userId !== ctx.readerId) throw new Error("Feed not found");
    if (!(await libraryIsActive(ctx, ctx.readerId))) return null;
    const now = Date.now();
    const existing = await ctx.db
      .query("suggestionKeeps")
      .withIndex("by_user_kind_subject", (q) =>
        q.eq("userId", ctx.readerId).eq("kind", "feed").eq("subject", feedId),
      )
      .first();
    if (existing)
      await ctx.db.patch("suggestionKeeps", existing._id, {
        until: now + KEEP_MS,
      });
    else
      await ctx.db.insert("suggestionKeeps", {
        userId: ctx.readerId,
        kind: "feed",
        subject: feedId,
        until: now + KEEP_MS,
        createdAt: now,
      });
    return null;
  },
});
