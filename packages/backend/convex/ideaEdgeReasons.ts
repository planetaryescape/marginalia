// Reasons for the lines between ideas: the structural ones checked on the
// server, and the generated sentence cached per reader until either text changes.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./functions";
import { pairFingerprint, pairKey, snippet } from "./lib/ideaGraph";
import { articleTitle, type LoadedNode, loadNode } from "./lib/ideaNodes";
import { pairReasons } from "./lib/ideaSignals";

export const edgeContext = internalQuery({
  args: { userId: v.string(), a: v.string(), b: v.string() },
  handler: async (ctx, args) => {
    const [a, b] = await Promise.all([
      loadNode(ctx, args.userId, args.a),
      loadNode(ctx, args.userId, args.b),
    ]);
    if (!a || !b || a.key === b.key) return null;
    const structural = await pairReasons(ctx, args.userId, a, b);
    const pair = pairKey(a.key, b.key);
    const cached = await ctx.db
      .query("edgeReasons")
      .withIndex("by_user_pair", (q) =>
        q.eq("userId", args.userId).eq("pair", pair),
      )
      .unique();
    const titles = await Promise.all(
      [a, b].map((n) =>
        n.articleId ? articleTitle(ctx, args.userId, n.articleId) : null,
      ),
    );
    const forModel = (n: LoadedNode, title: string | null) => ({
      kind: n.kind,
      text: snippet(n.text, 600),
      article: title ? snippet(title, 120) : null,
    });
    return {
      structural,
      pair,
      fingerprint: pairFingerprint(
        { key: a.key, text: snippet(a.text, 600) },
        { key: b.key, text: snippet(b.text, 600) },
      ),
      cached: cached
        ? { reason: cached.reason, fingerprint: cached.fingerprint }
        : null,
      a: forModel(a, titles[0]),
      b: forModel(b, titles[1]),
    };
  },
});

export const saveReason = internalMutation({
  args: {
    userId: v.string(),
    pair: v.string(),
    fingerprint: v.string(),
    reason: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    // The action runs for a while: a library deleted meanwhile must stay empty
    const reader = await ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", args.userId))
      .first();
    if (reader && (reader.status !== "active" || reader.deletingAt)) return;
    const existing = await ctx.db
      .query("edgeReasons")
      .withIndex("by_user_pair", (q) =>
        q.eq("userId", args.userId).eq("pair", args.pair),
      )
      .unique();
    const row = {
      fingerprint: args.fingerprint,
      reason: args.reason,
      model: args.model,
      createdAt: Date.now(),
    };
    if (existing) await ctx.db.patch("edgeReasons", existing._id, row);
    else
      await ctx.db.insert("edgeReasons", {
        userId: args.userId,
        pair: args.pair,
        ...row,
      });
  },
});
