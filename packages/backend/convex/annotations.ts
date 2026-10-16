import { v } from "convex/values";
import { libraryIsActive, ownedArticle } from "./access";
import { setAnnotationStatus } from "./articles";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { CURRENT_ANNOTATION_VERSION } from "./lib/annotationGate";
import { annotationType } from "./lib/annotationKinds";
import { marginaliaFingerprint } from "./lib/marginaliaFingerprint";

export const listByArticle = query({
  args: {
    articleId: v.id("articles"),
    // For a book: only the notes written for the unit being read
    unitIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId))) return [];
    const unitIndex = args.unitIndex;
    if (unitIndex !== undefined)
      return ctx.db
        .query("annotations")
        .withIndex("by_article_and_unitIndex", (q) =>
          q.eq("articleId", args.articleId).eq("unitIndex", unitIndex),
        )
        .collect();
    return ctx.db
      .query("annotations")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .collect();
  },
});

export const markViewed = mutation({
  args: { annotationId: v.id("annotations") },
  handler: async (ctx, args) => {
    const annotation = await ctx.db.get("annotations", args.annotationId);
    if (annotation?.userId !== ctx.readerId)
      throw new Error("Annotation not found");
    await ctx.db.patch(args.annotationId, { wasViewed: true });
  },
});

export const markDismissed = mutation({
  args: { annotationId: v.id("annotations") },
  handler: async (ctx, args) => {
    const annotation = await ctx.db.get("annotations", args.annotationId);
    if (annotation?.userId !== ctx.readerId)
      throw new Error("Annotation not found");
    await ctx.db.patch(args.annotationId, { wasDismissed: true });
  },
});

export const deleteByArticle = internalMutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const annotations = await ctx.db
      .query("annotations")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .collect();
    for (const ann of annotations) {
      await ctx.db.delete(ann._id);
    }
  },
});

/**
 * The other article a connection points at, for the margin: its title, length
 * and whether it is read or saved. Only from the signed-in reader's own
 * library; the margin offers Save for later and never a link.
 */
export const referencedArticle = query({
  args: { annotationId: v.id("annotations") },
  handler: async (ctx, args) => {
    const annotation = await ctx.db.get("annotations", args.annotationId);
    if (annotation?.userId !== ctx.readerId || !annotation.articleRefId)
      return null;
    const article = await ownedArticle(
      ctx,
      annotation.articleRefId,
      ctx.readerId,
    );
    if (!article) return null;
    const saved = await ctx.db
      .query("savedArticles")
      .withIndex("by_user_article", (q) =>
        q.eq("userId", ctx.readerId).eq("articleId", article._id),
      )
      .first();
    return {
      _id: article._id,
      title: article.title,
      estimatedReadMinutes: article.estimatedReadMinutes ?? null,
      read: article.finishedAt !== undefined,
      saved: saved !== null,
    };
  },
});

// --- Internal ---

const EXCERPT_CHARS = 280;

/** Title, length and a short excerpt of library articles, only the library's own. */
export const libraryCandidates = internalQuery({
  args: { userId: v.string(), articleIds: v.array(v.id("articles")) },
  handler: async (ctx, args) => {
    const found = await Promise.all(
      args.articleIds.map((id) => ownedArticle(ctx, id, args.userId)),
    );
    return found.flatMap((article) =>
      article
        ? [
            {
              id: article._id,
              title: article.title,
              minutes: article.estimatedReadMinutes ?? null,
              excerpt: (article.excerpt ?? article.content ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, EXCERPT_CHARS),
            },
          ]
        : [],
    );
  },
});

export const noteFields = v.object({
  type: annotationType,
  fallacyName: v.optional(v.string()),
  articleRefId: v.optional(v.id("articles")),
  anchorText: v.string(),
  anchorStartOffset: v.number(),
  anchorEndOffset: v.number(),
  content: v.string(),
  notePath: v.optional(v.string()),
  noteExcerpt: v.optional(v.string()),
  relevanceScore: v.number(),
});

/**
 * Writes an article's margin in one transaction: the notes replace any the
 * article had, the reflection is replaced unless the reader has answered it,
 * and the article is marked annotated at the current version. A failed
 * generation never reaches here, so it can't leave a half-empty margin.
 */
export const replaceForArticle = internalMutation({
  args: {
    articleId: v.id("articles"),
    userId: v.string(),
    notes: v.array(noteFields),
    reflection: v.object({
      strongestPoint: v.string(),
      weakestAssumption: v.string(),
      credibleCounterview: v.string(),
      questionForYou: v.string(),
    }),
    // What the library held when this pass began (reading alongside, rung 2f)
    fingerprint: v.optional(marginaliaFingerprint),
  },
  handler: async (ctx, args) => {
    const article = await ownedArticle(ctx, args.articleId, args.userId);
    if (!article) throw new Error("Article not found");

    const existing = await ctx.db
      .query("annotations")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .collect();
    // A reader may have answered a note while this was generating. Those
    // annotations stay, so the answer keeps its place in the margin; the new
    // notes go in around them, and any that overlap a kept anchor are dropped.
    const answeredNotes = await ctx.db
      .query("userNotes")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .collect();
    const answered = new Set<string>(
      answeredNotes.flatMap((note) =>
        note.annotationId ? [note.annotationId] : [],
      ),
    );
    const kept = existing.filter((row) => answered.has(row._id));
    for (const row of existing)
      if (!answered.has(row._id)) await ctx.db.delete(row._id);

    const refs = new Map<string, boolean>();
    const now = Date.now();
    for (const note of args.notes) {
      // A connection may only point into this library, whatever the caller says
      let articleRefId = note.articleRefId;
      if (articleRefId) {
        if (!refs.has(articleRefId))
          refs.set(
            articleRefId,
            Boolean(await ownedArticle(ctx, articleRefId, args.userId)),
          );
        if (!refs.get(articleRefId) || articleRefId === args.articleId)
          articleRefId = undefined;
      }
      if (note.articleRefId && !articleRefId && !note.notePath) continue;
      if (
        kept.some(
          (row) =>
            note.anchorStartOffset < row.anchorEndOffset &&
            note.anchorEndOffset > row.anchorStartOffset,
        )
      )
        continue;
      await ctx.db.insert("annotations", {
        ...note,
        articleRefId,
        articleId: args.articleId,
        userId: args.userId,
        wasViewed: false,
        wasDismissed: false,
        createdAt: now,
      });
    }

    const reflections = await ctx.db
      .query("reflections")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .collect();
    // What the reader wrote in answer is theirs; keep that reflection as it is
    if (!reflections.some((r) => r.userResponse !== undefined)) {
      for (const row of reflections) await ctx.db.delete(row._id);
      await ctx.db.insert("reflections", {
        ...args.reflection,
        articleId: args.articleId,
        userId: args.userId,
        createdAt: now,
      });
    }

    // The backfill's claim is released by the run that holds it
    // (releaseClaim), never here: this run may be older than a newer claim
    await ctx.db.patch("articles", args.articleId, {
      annotationVersion: CURRENT_ANNOTATION_VERSION,
      ...(args.fingerprint ? { marginaliaFingerprint: args.fingerprint } : {}),
    });
    // The margin was written afresh, so earlier section passes (and the
    // budget they used) belong to notes that no longer exist; an in-flight
    // pass loses its claim and writes nothing
    const passes = await ctx.db
      .query("marginaliaPasses")
      .withIndex("by_userId_and_articleId_and_sectionIndex", (q) =>
        q.eq("userId", args.userId).eq("articleId", args.articleId),
      )
      .collect();
    for (const pass of passes)
      await ctx.db.delete("marginaliaPasses", pass._id);
    await setAnnotationStatus(ctx, args.articleId, "annotated");
  },
});

/**
 * Writes one unit's margin in one transaction, as replaceForArticle does for an
 * article: notes the reader has answered stay, the rest are replaced, and the
 * unit is marked annotated. A book has no reflection; that belongs to a piece
 * read whole.
 */
export const replaceForUnit = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    unitIndex: v.number(),
    notes: v.array(noteFields),
  },
  handler: async (ctx, args) => {
    // A margin written while the account was being deleted must not outlive the purge
    if (!(await libraryIsActive(ctx, args.userId)))
      throw new Error("This library is no longer active.");
    const article = await ownedArticle(ctx, args.articleId, args.userId);
    if (!article) throw new Error("Article not found");
    const unit = await ctx.db
      .query("bookUnits")
      .withIndex("by_userId_and_articleId_and_index", (q) =>
        q
          .eq("userId", args.userId)
          .eq("articleId", args.articleId)
          .eq("index", args.unitIndex),
      )
      .unique();
    if (!unit) throw new Error("Unit not found");

    const existing = await ctx.db
      .query("annotations")
      .withIndex("by_article_and_unitIndex", (q) =>
        q.eq("articleId", args.articleId).eq("unitIndex", args.unitIndex),
      )
      .collect();
    const answeredNotes = await ctx.db
      .query("userNotes")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .collect();
    const answered = new Set<string>(
      answeredNotes.flatMap((note) =>
        note.annotationId ? [note.annotationId] : [],
      ),
    );
    const kept = existing.filter((row) => answered.has(row._id));
    for (const row of existing)
      if (!answered.has(row._id)) await ctx.db.delete(row._id);

    const refs = new Map<string, boolean>();
    const now = Date.now();
    for (const note of args.notes) {
      let articleRefId = note.articleRefId;
      if (articleRefId) {
        if (!refs.has(articleRefId))
          refs.set(
            articleRefId,
            Boolean(await ownedArticle(ctx, articleRefId, args.userId)),
          );
        if (!refs.get(articleRefId) || articleRefId === args.articleId)
          articleRefId = undefined;
      }
      if (note.articleRefId && !articleRefId && !note.notePath) continue;
      if (
        kept.some(
          (row) =>
            note.anchorStartOffset < row.anchorEndOffset &&
            note.anchorEndOffset > row.anchorStartOffset,
        )
      )
        continue;
      await ctx.db.insert("annotations", {
        ...note,
        articleRefId,
        articleId: args.articleId,
        userId: args.userId,
        unitIndex: args.unitIndex,
        wasViewed: false,
        wasDismissed: false,
        createdAt: now,
      });
    }
    await ctx.db.patch("bookUnits", unit._id, {
      annotationStatus: "annotated",
    });
  },
});
