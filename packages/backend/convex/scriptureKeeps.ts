import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { estimatePassageMinutes } from "./lib/bible";
import { biblePreferences, requireBible } from "./lib/bibleSettings";
import { citedScriptureReferences, referenceFromKey } from "./lib/scriptureReferences";

export const KEEP_LIMITS = { perReader: 256, origins: 16, candidates: 64, offeredMs: 86_400_000, openedMs: 7 * 86_400_000 } as const;

async function sourceArticle(ctx: Pick<QueryCtx, "db">, userId: string, articleId: Id<"articles">) {
  const article = await ctx.db.get(articleId);
  if (!article?.bible || article.userId !== userId) throw new Error("Scripture source not found.");
  return { ...article, bible: article.bible };
}

export const keep = mutation({
  args: {
    runId: v.optional(v.id("scriptureStudyRuns")), findingId: v.optional(v.string()),
    annotationId: v.optional(v.id("annotations")), referenceKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireBible(ctx, ctx.readerId);
    const ref = referenceFromKey(args.referenceKey);
    if (!ref) throw new Error("This citation is not a supported Bible reference.");
    let originKey: string;
    let reason: string;
    let sourceArticleId: Id<"articles">;
    let sourceStudyId: Id<"scriptureStudies"> | undefined;
    if (args.runId && args.findingId && !args.annotationId) {
      const run = await ctx.db.get(args.runId);
      const study = run ? await ctx.db.get(run.studyId) : null;
      if (!run || !study || run.userId !== ctx.readerId || study.userId !== ctx.readerId || run.status !== "complete" || study.publishedRunId !== run._id)
        throw new Error("Reopen the latest owned study before keeping its citation.");
      const rows = await ctx.db.query("scriptureStudyFindings").withIndex("by_runId_and_order", (q) => q.eq("runId", run._id)).take(6);
      const related = rows.find((row) => row.finding.findingId === args.findingId)?.finding.relatedPassages.find((item) => item.referenceKey === ref.passageId);
      if (!related || !run.evidence?.some((item) => item.evidenceId === related.evidenceId && item.referenceKey === ref.passageId && item.source.id === "web"))
        throw new Error("This passage is not a verified citation in that finding.");
      sourceArticleId = study.articleId;
      sourceStudyId = study._id;
      originKey = `study:${run._id}:${args.findingId}:${ref.passageId}`;
      reason = related.explanation.slice(0, 500);
    } else if (args.annotationId && !args.runId && !args.findingId) {
      const annotation = await ctx.db.get(args.annotationId);
      if (!annotation || annotation.userId !== ctx.readerId || annotation.wasDismissed || !citedScriptureReferences(annotation.content).some((item) => item.passageId === ref.passageId))
        throw new Error("This passage is not cited by that owned margin note.");
      sourceArticleId = annotation.articleId;
      originKey = `annotation:${annotation._id}:${ref.passageId}`;
      reason = annotation.content.slice(0, 500);
    } else throw new Error("Choose a citation in one study finding or margin note.");
    const article = await sourceArticle(ctx, ctx.readerId, sourceArticleId);
    let row = await ctx.db.query("scriptureKeeps").withIndex("by_userId_and_referenceKey", (q) => q.eq("userId", ctx.readerId).eq("referenceKey", ref.passageId)).unique();
    if (!row) {
      const existing = await ctx.db.query("scriptureKeeps").withIndex("by_userId", (q) => q.eq("userId", ctx.readerId)).take(KEEP_LIMITS.perReader);
      if (existing.length >= KEEP_LIMITS.perReader) throw new Error("Your saved passage limit is reached. Remove a passage before keeping another.");
      const id = await ctx.db.insert("scriptureKeeps", { userId: ctx.readerId, referenceKey: ref.passageId, reference: ref.reference, estimatedReadMinutes: estimatePassageMinutes(ref), createdAt: Date.now() });
      row = await ctx.db.get(id);
    }
    if (!row) throw new Error("Passage could not be kept.");
    const origin = await ctx.db.query("scriptureKeepOrigins").withIndex("by_userId_and_originKey", (q) => q.eq("userId", ctx.readerId).eq("originKey", originKey)).unique();
    if (!origin) {
      const origins = await ctx.db.query("scriptureKeepOrigins").withIndex("by_keepId", (q) => q.eq("keepId", row._id)).take(KEEP_LIMITS.origins);
      if (origins.length >= KEEP_LIMITS.origins) throw new Error("This passage is already kept with the maximum number of connections.");
      await ctx.db.insert("scriptureKeepOrigins", { userId: ctx.readerId, keepId: row._id, originKey, sourceArticleId, sourceStudyId, sourceAnnotationId: args.annotationId, sourceReference: article.bible.reference, reason, createdAt: Date.now() });
    }
    return { keepId: row._id, kept: true };
  },
});

async function originsFor(ctx: Pick<QueryCtx, "db">, keepId: Id<"scriptureKeeps">) {
  const rows = await ctx.db.query("scriptureKeepOrigins").withIndex("by_keepId", (q) => q.eq("keepId", keepId)).take(KEEP_LIMITS.origins);
  return Promise.all(rows.map(async (origin) => {
    const article = origin.sourceArticleId ? await ctx.db.get(origin.sourceArticleId) : null;
    return { sourceReference: origin.sourceReference, reason: origin.reason, sourceArticleId: article?.userId === origin.userId ? article._id : null };
  }));
}

export const page = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const prefs = await biblePreferences(ctx, ctx.readerId);
    if (!prefs.enabled) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db.query("scriptureKeeps").withIndex("by_userId", (q) => q.eq("userId", ctx.readerId)).order("desc").paginate({ ...args.paginationOpts, numItems: Math.min(20, Math.max(1, args.paginationOpts.numItems)) });
    return { ...result, page: await Promise.all(result.page.map(async (row) => ({ ...row, origins: await originsFor(ctx, row._id) }))) };
  },
});

export const count = query({ args: {}, handler: async (ctx) => {
  if (!(await biblePreferences(ctx, ctx.readerId)).enabled) return 0;
  return (await ctx.db.query("scriptureKeeps").withIndex("by_userId", (q) => q.eq("userId", ctx.readerId)).take(KEEP_LIMITS.perReader)).length;
} });

export const remove = mutation({
  args: { keepId: v.id("scriptureKeeps") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.keepId);
    if (!row || row.userId !== ctx.readerId) throw new Error("Kept passage not found.");
    const origins = await ctx.db.query("scriptureKeepOrigins").withIndex("by_keepId", (q) => q.eq("keepId", row._id)).take(KEEP_LIMITS.origins);
    for (const origin of origins) await ctx.db.delete(origin._id);
    await ctx.db.delete(row._id);
  },
});

export const candidates = internalQuery({
  args: { userId: v.string(), minutes: v.optional(v.number()), topic: v.string() },
  handler: async (ctx, args) => {
    const prefs = await biblePreferences(ctx, args.userId);
    if (!prefs.enabled || prefs.scope === "articles") return [];
    const rows = await ctx.db.query("scriptureKeeps").withIndex("by_userId", (q) => q.eq("userId", args.userId)).order("desc").take(KEEP_LIMITS.candidates);
    const words = args.topic.toLowerCase().split(/\W+/).filter((word) => word.length > 2 && !["read", "bible", "something", "about", "want", "have", "minute", "minutes"].includes(word));
    const eligible = [];
    for (const row of rows) {
      if (!referenceFromKey(row.referenceKey) || (args.minutes !== undefined && row.estimatedReadMinutes > args.minutes) || (row.lastOpenedAt !== undefined && row.lastOpenedAt > Date.now() - KEEP_LIMITS.openedMs) || (row.lastOfferedAt !== undefined && row.lastOfferedAt > Date.now() - KEEP_LIMITS.offeredMs)) continue;
      const targets = await ctx.db.query("articles").withIndex("by_userId_and_bible_reference", (q) => q.eq("userId", args.userId).eq("bible.reference", row.reference)).take(16);
      if (targets.some((article) => article.finishedAt !== undefined)) continue;
      const origins = await originsFor(ctx, row._id);
      const origin = origins.find((item) => !words.length || words.some((word) => `${row.reference} ${item.sourceReference} ${item.reason}`.toLowerCase().includes(word)));
      if (!origin) continue;
      eligible.push({ keepId: row._id, reference: row.reference, title: row.reference, minutes: row.estimatedReadMinutes, reason: `You kept this while reading ${origin.sourceReference}: ${origin.reason}` });
      if (eligible.length >= 3) break;
    }
    return eligible;
  },
});

export const recordOffers = internalMutation({
  args: { userId: v.string(), keepIds: v.array(v.id("scriptureKeeps")) },
  handler: async (ctx, args) => {
    const prefs = await requireBible(ctx, args.userId);
    const offered: Id<"scriptureKeeps">[] = [];
    if (prefs.scope === "articles") return offered;
    for (const id of args.keepIds.slice(0, 3)) {
      const row = await ctx.db.get(id);
      if (row?.userId !== args.userId || (row.lastOfferedAt !== undefined && row.lastOfferedAt > Date.now() - KEEP_LIMITS.offeredMs) || (row.lastOpenedAt !== undefined && row.lastOpenedAt > Date.now() - KEEP_LIMITS.openedMs)) continue;
      const targets = await ctx.db.query("articles").withIndex("by_userId_and_bible_reference", (q) => q.eq("userId", args.userId).eq("bible.reference", row.reference)).take(16);
      if (targets.some((article) => article.finishedAt !== undefined)) continue;
      await ctx.db.patch(id, { lastOfferedAt: Date.now() });
      offered.push(id);
    }
    return offered;
  },
});

export const opened = internalMutation({
  args: { userId: v.string(), articleId: v.id("articles") },
  handler: async (ctx, args) => {
    await requireBible(ctx, args.userId);
    const article = await sourceArticle(ctx, args.userId, args.articleId);
    const ref = citedScriptureReferences(article.bible.reference)[0];
    if (!ref) return;
    const row = await ctx.db.query("scriptureKeeps").withIndex("by_userId_and_referenceKey", (q) => q.eq("userId", args.userId).eq("referenceKey", ref.passageId)).unique();
    if (row) await ctx.db.patch(row._id, { targetArticleId: article._id, lastOpenedAt: Date.now() });
  },
});
