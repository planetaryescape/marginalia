import { v } from "convex/values";
import { libraryIsActive, ownedArticle, requireArticle } from "./access";
import { internalMutation, internalQuery, query } from "./functions";

export const getByArticle = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId))) return null;
    return ctx.db
      .query("summaries")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .first();
  },
});

/** Replaces any existing summary for the article. */
export const save = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    gist: v.string(),
    thesis: v.string(),
    ideas: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        detail: v.string(),
        role: v.union(
          v.literal("premise"),
          v.literal("evidence"),
          v.literal("claim"),
          v.literal("counterpoint"),
          v.literal("conclusion"),
        ),
        paragraphs: v.array(v.number()),
      }),
    ),
    links: v.array(
      v.object({
        from: v.string(),
        to: v.string(),
        relation: v.union(
          v.literal("supports"),
          v.literal("leads_to"),
          v.literal("contrasts"),
          v.literal("illustrates"),
        ),
      }),
    ),
    flow: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    await requireArticle(ctx, args.articleId, args.userId);
    const existing = await ctx.db
      .query("summaries")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .take(10);
    for (const row of existing) await ctx.db.delete("summaries", row._id);
    return ctx.db.insert("summaries", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

/**
 * The one point and short summary written by the import annotation call
 * (D-DES-054). It fills a gap and never replaces anything fuller: with no
 * summary it creates one; with one that has no thesis it adds the thesis (and
 * the gist only if there is no idea map or claims to contradict it); with a
 * thesis it does nothing. Mutations are serial, so racing an on-demand summary
 * leaves one or the other, never a mix.
 */
export const saveOverview = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    thesis: v.string(),
    gist: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    await requireArticle(ctx, args.articleId, args.userId);
    const thesis = args.thesis.trim();
    const gist = args.gist.trim();
    if (!thesis || !gist) return null;
    const existing = await ctx.db
      .query("summaries")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .first();
    if (!existing)
      return ctx.db.insert("summaries", {
        userId: args.userId,
        articleId: args.articleId,
        thesis,
        gist,
        model: args.model,
        createdAt: Date.now(),
      });
    if (existing.thesis?.trim()) return null;
    const hasMap = Boolean(existing.ideas?.length || existing.claims?.length);
    // An older summary with a map keeps its own gist
    const keepGist = hasMap && existing.gist.trim() !== "";
    await ctx.db.patch("summaries", existing._id, {
      thesis,
      gist: keepGist ? existing.gist : gist,
    });
    return existing._id;
  },
});

/**
 * A book's one point and short summary written from its section summaries.
 * Unlike saveOverview it replaces the thesis and gist that came from annotating
 * the first part, because these draw on the whole book.
 */
export const saveBookOverview = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    thesis: v.string(),
    gist: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    // A late call for a reader who is leaving or a book that is gone writes nothing
    if (!(await libraryIsActive(ctx, args.userId))) return null;
    const article = await ownedArticle(ctx, args.articleId, args.userId);
    if (!article?.bookOutline) return null;
    const thesis = args.thesis.trim();
    const gist = args.gist.trim();
    if (!thesis || !gist) return null;
    const existing = await ctx.db
      .query("summaries")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .first();
    if (!existing)
      return ctx.db.insert("summaries", {
        userId: args.userId,
        articleId: args.articleId,
        thesis,
        gist,
        model: args.model,
        createdAt: Date.now(),
      });
    await ctx.db.patch("summaries", existing._id, {
      thesis,
      gist,
      model: args.model,
    });
    return existing._id;
  },
});

/**
 * The background the reading companion sends with every answer. The article ID
 * arrives as text from the browser, so it is checked here against the reader.
 */
export const forCompanion = internalQuery({
  args: { articleId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const articleId = ctx.db.normalizeId("articles", args.articleId);
    if (!articleId || !(await ownedArticle(ctx, articleId, args.userId)))
      return null;
    const row = await ctx.db
      .query("summaries")
      .withIndex("by_article", (q) => q.eq("articleId", articleId))
      .first();
    return row ? { thesis: row.thesis, gist: row.gist } : null;
  },
});
