import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { libraryIsActive, ownedArticle, ownedArticleCard } from "./access";
import { noteFields } from "./annotations";
import {
  internalMutation,
  internalQuery,
  mutation,
  type QueryCtx,
  query,
} from "./functions";
import {
  computeFingerprint,
  sameFingerprint,
} from "./lib/marginaliaFingerprint";
import { beyondImportPass, sectionRanges } from "./lib/readingSections";
import { refundReaderLimit, spendReaderLimit } from "./limits";

/** Reading alongside (rung 2f): passes that annotate the section ahead of the reader. */

/** Most passes one article may use, whatever changes. */
export const MAX_PASSES_PER_ARTICLE = 8;
// A pass that has not settled by then crashed; its section may be claimed again
export const CLAIM_TTL_MS = 10 * 60_000;

const leaseEnd = (row: { claim: number; leaseUntil?: number }) =>
  row.leaseUntil ?? row.claim + CLAIM_TTL_MS;

const requestStatus = v.union(
  v.literal("scheduled"),
  v.literal("unchanged"),
  v.literal("baseline"),
  v.literal("running"),
  v.literal("budget"),
  v.literal("ineligible"),
);

const passRow = (
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  articleId: Id<"articles">,
  sectionIndex: number,
) =>
  ctx.db
    .query("marginaliaPasses")
    .withIndex("by_userId_and_articleId_and_sectionIndex", (q) =>
      q
        .eq("userId", userId)
        .eq("articleId", articleId)
        .eq("sectionIndex", sectionIndex),
    )
    .unique();

const passRows = (
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  articleId: Id<"articles">,
) =>
  ctx.db
    .query("marginaliaPasses")
    .withIndex("by_userId_and_articleId_and_sectionIndex", (q) =>
      q.eq("userId", userId).eq("articleId", articleId),
    );

/**
 * The reader has got far enough through section `currentSection` that the
 * next one is worth looking at. Only that next section can be asked for.
 *
 * Two layers decide whether a model call is made (D-DES-046). This is the
 * cheap one: the library fingerprint, compared with the one this section was
 * last settled against (or the import pass's, for a section never looked at).
 * The row is claimed here, in the same transaction as the scheduling, so a
 * second tab or a fast scroll finds it running.
 */
export const requestAhead = mutation({
  args: { articleId: v.id("articles"), currentSection: v.number() },
  returns: requestStatus,
  handler: async (ctx, args) => {
    const userId = ctx.readerId;
    const sectionIndex = args.currentSection + 1;
    const article = await ownedArticle(ctx, args.articleId, userId);
    if (
      !article?.content ||
      // A book's parts are annotated once each, as the reader reaches them (rung 3b)
      article.bookUnitCount !== undefined ||
      article.annotationStatus !== "annotated" ||
      !Number.isInteger(args.currentSection) ||
      args.currentSection < 0 ||
      !(await libraryIsActive(ctx, userId))
    )
      return "ineligible" as const;
    const sections = sectionRanges(article.content);
    if (sectionIndex >= sections.length) return "ineligible" as const;

    const now = Date.now();
    const row = await passRow(ctx, userId, article._id, sectionIndex);
    if (row?.status === "running" && now < leaseEnd(row))
      return "running" as const;

    const current = await computeFingerprint(ctx, userId, now);
    const settled = row?.fingerprint ?? article.marginaliaFingerprint;
    // Text past the import pass's cap was never annotated, so "nothing has
    // changed" says nothing about it
    const unread = beyondImportPass(sections[sectionIndex], row);
    if (!settled) {
      // Annotated before reading alongside existed: what is in the library now
      // is the starting point, so only later changes cost a call
      await ctx.db.patch("articles", article._id, {
        marginaliaFingerprint: current,
      });
      console.log(
        `Skipped reading pass for "${article.title}" (${article._id}) section ${sectionIndex + 1}: no earlier fingerprint, recorded one`,
      );
      return "baseline" as const;
    }
    if (!unread && sameFingerprint(settled, current)) {
      console.log(
        `Skipped reading pass for "${article.title}" (${article._id}) section ${sectionIndex + 1}: nothing the margin draws on has changed since ${new Date(settled.passAt).toISOString()}`,
      );
      return "unchanged" as const;
    }

    const rows = await passRows(ctx, userId, article._id).collect();
    const used = rows.reduce((sum, r) => sum + r.calls, 0);
    // Stop quietly: no error, no line in the margin. Two reservations: one
    // for the model call, given back if the pass ends without one, and one for
    // the retrieval, which embeds text whatever the pass decides and is never
    // given back.
    const refused = await (async () => {
      if (used >= MAX_PASSES_PER_ARTICLE) return "the article's pass budget";
      if (!(await spendReaderLimit(ctx, userId, "alongsideDaily")))
        return "the daily pass budget";
      if (!(await spendReaderLimit(ctx, userId, "alongsideRetrieval"))) {
        await refundReaderLimit(ctx, userId, "alongsideDaily", now);
        return "the daily retrieval budget";
      }
      return null;
    })();
    if (refused) {
      console.log(
        `Skipped reading pass for "${article.title}" (${article._id}) section ${sectionIndex + 1}: ${refused} is used`,
      );
      return "budget" as const;
    }

    const claim = Math.max(now, (row?.claim ?? 0) + 1);
    if (row)
      await ctx.db.patch("marginaliaPasses", row._id, {
        status: "running",
        claim,
        leaseUntil: now + CLAIM_TTL_MS,
        pending: current,
        calls: row.calls + 1,
        updatedAt: now,
      });
    else
      await ctx.db.insert("marginaliaPasses", {
        userId,
        articleId: article._id,
        sectionIndex,
        status: "running",
        claim,
        leaseUntil: now + CLAIM_TTL_MS,
        fingerprint: settled,
        pending: current,
        calls: 1,
        notesAdded: 0,
        updatedAt: now,
      });
    await ctx.scheduler.runAfter(0, internal.actions.readAlongside.pass, {
      articleId: article._id,
      sectionIndex,
      claim,
    });
    return "scheduled" as const;
  },
});

/** Sections being written now, for the "Reading alongside you…" line. */
export const workingSections = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    if (!(await ownedArticleCard(ctx, args.articleId, ctx.readerId))) return [];
    const now = Date.now();
    const rows = await passRows(ctx, ctx.readerId, args.articleId).collect();
    return rows
      .filter((r) => r.status === "running" && leaseEnd(r) > now)
      .map((r) => r.sectionIndex);
  },
});

// --- Internal, for actions/readAlongside.ts and actions/generateAnnotations.ts ---

/** The library fingerprint now, taken before an import pass builds its context. */
export const currentFingerprint = internalQuery({
  args: { userId: v.string() },
  handler: (ctx, args) => computeFingerprint(ctx, args.userId),
});

/** The article, its claimed row and what the margin already says there, or null if the claim is gone. */
export const passInput = internalQuery({
  args: {
    articleId: v.id("articles"),
    sectionIndex: v.number(),
    claim: v.number(),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    // A library being deleted gets no more passes
    if (!article || !(await libraryIsActive(ctx, article.userId))) return null;
    const row = await passRow(
      ctx,
      article.userId,
      article._id,
      args.sectionIndex,
    );
    if (row?.status !== "running" || row.claim !== args.claim) return null;
    const existing = await ctx.db
      .query("annotations")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .collect();
    return {
      article,
      row,
      said: existing.map((a) => ({
        type: a.type,
        anchorText: a.anchorText,
        content: a.content,
        start: a.anchorStartOffset,
        end: a.anchorEndOffset,
      })),
    };
  },
});

/**
 * Confirms the job still owns its section and extends its claim. Called when
 * work starts and again right before the model call, so a job that sat in a
 * queue or in retrieval for a long time, and whose claim another tab has taken
 * since, finds out and stops instead of calling the model twice.
 */
export const renew = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    sectionIndex: v.number(),
    claim: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!(await libraryIsActive(ctx, args.userId))) return false;
    const article = await ownedArticle(ctx, args.articleId, args.userId);
    const row = await passRow(
      ctx,
      args.userId,
      args.articleId,
      args.sectionIndex,
    );
    if (!article || row?.status !== "running" || row.claim !== args.claim)
      return false;
    await ctx.db.patch("marginaliaPasses", row._id, {
      leaseUntil: Date.now() + CLAIM_TTL_MS,
    });
    return true;
  },
});

/**
 * Ends a claimed pass. Notes are only ever added: nothing the margin already
 * has is changed, moved or removed, and a note that would sit on an existing
 * note's anchor is dropped. A pass whose claim was replaced (a re-annotation,
 * or a newer claim) writes nothing.
 *
 * `skipped` is for a pass that made no model call (the precise gate, no key):
 * it gives back the budget the claim reserved and settles the section against
 * the fingerprint it was claimed under, so the cheap gate doesn't re-trigger.
 */
export const settle = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    sectionIndex: v.number(),
    claim: v.number(),
    outcome: v.union(
      v.literal("done"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    contextHash: v.optional(v.string()),
    notes: v.optional(v.array(noteFields)),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    // A margin written while the account was being deleted must not outlive the purge
    if (!(await libraryIsActive(ctx, args.userId)))
      throw new Error("This library is no longer active.");
    const article = await ownedArticle(ctx, args.articleId, args.userId);
    const row = await passRow(
      ctx,
      args.userId,
      args.articleId,
      args.sectionIndex,
    );
    if (!article || row?.status !== "running" || row.claim !== args.claim)
      return 0;
    const now = Date.now();

    let added = 0;
    if (args.outcome === "done" && args.notes?.length) {
      const existing = await ctx.db
        .query("annotations")
        .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
        .collect();
      const refs = new Map<string, boolean>();
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
        const taken = existing.some(
          (row) =>
            note.anchorStartOffset < row.anchorEndOffset &&
            note.anchorEndOffset > row.anchorStartOffset,
        );
        if (taken) continue;
        const id = await ctx.db.insert("annotations", {
          ...note,
          articleRefId,
          articleId: args.articleId,
          userId: args.userId,
          wasViewed: false,
          wasDismissed: false,
          createdAt: now,
        });
        const inserted = await ctx.db.get("annotations", id);
        if (inserted) existing.push(inserted);
        added++;
      }
    }

    const settledAt = args.outcome === "failed" ? undefined : row.pending;
    await ctx.db.patch("marginaliaPasses", row._id, {
      status: args.outcome,
      pending: undefined,
      ...(settledAt ? { fingerprint: settledAt } : {}),
      ...(args.contextHash ? { contextHash: args.contextHash } : {}),
      calls:
        args.outcome === "skipped" ? Math.max(0, row.calls - 1) : row.calls,
      notesAdded: row.notesAdded + added,
      updatedAt: now,
    });
    if (args.outcome === "skipped")
      await refundReaderLimit(ctx, args.userId, "alongsideDaily", row.claim);
    return added;
  },
});
