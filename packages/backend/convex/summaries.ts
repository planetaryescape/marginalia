import { ConvexError, v } from "convex/values";
import {
  libraryIsActive,
  ownedArticle,
  ownedArticleCard,
  requireArticle,
} from "./access";
import { internalMutation, internalQuery, query } from "./functions";
import { legacyOverviewClaim } from "./lib/bookIndex";
import {
  SUMMARY_ATTEMPTS,
  SUMMARY_LEASE_MS,
  summaryGeneration,
  summarySource,
  summaryState,
} from "./lib/fullSummaries";
import {
  annotationGeneration,
  annotationPublicationAllowed,
} from "./lib/manualAnnotations";
import { representationHash, sourceHash } from "./lib/preparedRepresentation";
import { sha256Hex } from "./lib/tokens";

export const getByArticle = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    if (!(await ownedArticleCard(ctx, args.articleId, ctx.readerId)))
      return null;
    const summary = await ctx.db
      .query("summaries")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .first();
    return summary?.userId === ctx.readerId ? summary : null;
  },
});

/** Private atomic admission. Only an explicit application request can recover. */
export const claimFull = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    title: v.string(),
    paragraphs: v.array(v.string()),
    sourceHash: v.optional(v.string()),
    expectedSummaryId: v.optional(v.id("summaries")),
  },
  handler: async (ctx, args) => {
    const article = await requireArticle(ctx, args.articleId, args.userId);
    if (!(await libraryIsActive(ctx, args.userId)))
      throw new Error("Library unavailable");
    if (
      article.bookUnitCount ||
      (args.sourceHash !== undefined &&
        (args.sourceHash !==
          (await sourceHash(article.content, article.contentHtml)) ||
          args.title !== article.title))
    )
      throw new ConvexError(
        "Reload the article before generating its summary.",
      );
    if (
      !args.paragraphs.length ||
      args.paragraphs.length > 4000 ||
      new TextEncoder().encode(JSON.stringify(args.paragraphs)).byteLength >
        950_000
    )
      throw new Error("Summary representation too large or empty");
    // A legacy caller cannot prove its earlier DOM snapshot. Bind its literal
    // title/paragraphs to this server-entry source/model snapshot instead; the
    // publication fence must still reject any subsequent source/model change.
    const source = await summarySource(ctx, article);
    const input = await sha256Hex(
      JSON.stringify([
        source,
        args.title,
        await representationHash(args.paragraphs),
      ]),
    );
    const old = await summaryState(ctx, args.articleId);
    const current = await ctx.db
      .query("summaries")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .first();
    if (current && current.userId !== args.userId)
      throw new Error("Summary ownership changed");
    const sameInput = old?.userId === args.userId && old.input === input;
    // Deleted old IDs are vouched for only by this private current-input claim,
    // never by a caller's guess about which map an earlier run replaced.
    if (
      args.expectedSummaryId !== undefined &&
      args.expectedSummaryId !== current?._id &&
      !(sameInput && old.replacesSummaryId === args.expectedSummaryId)
    )
      throw new Error(
        "Summary changed. Use the latest visible map to redo it.",
      );
    if (
      sameInput &&
      old.status === "complete" &&
      current &&
      old.resultId === current._id &&
      // New ordinary calls reuse; a refresh of the current visible map buys
      // one replacement. Old clients had only an explicit generate/redo call,
      // so their completed calls retain that behavior (in-flight calls join).
      (args.expectedSummaryId !== undefined
        ? args.expectedSummaryId !== current._id
        : args.sourceHash !== undefined)
    )
      return { kind: "complete" as const, run: old.run };
    if (old?.status === "running" && old.leaseUntil > Date.now()) {
      if (!sameInput)
        throw new Error(
          "Another summary is running. Try again after it settles",
        );
      return { kind: "join" as const, run: old.run };
    }
    if (
      args.expectedSummaryId !== undefined &&
      args.expectedSummaryId !== current?._id
    )
      throw new Error(
        "Summary changed. Use the latest visible map to redo it.",
      );
    const attempts =
      sameInput && old.status !== "complete" ? old.attempts + 1 : 1;
    if (attempts > SUMMARY_ATTEMPTS)
      throw new Error("Summary attempt limit reached for this input");
    const row = {
      userId: args.userId,
      articleId: args.articleId,
      input,
      source,
      run: (old?.run ?? 0) + 1,
      attempts,
      status: "running" as const,
      leaseUntil: Date.now() + SUMMARY_LEASE_MS,
      replacesSummaryId: current?._id,
    };
    if (old) await ctx.db.replace(old._id, row);
    else await ctx.db.insert("fullSummaryState", row);
    return { kind: "claimed" as const, run: row.run };
  },
});

export const fullStatus = internalQuery({
  args: { userId: v.string(), articleId: v.id("articles"), run: v.number() },
  handler: async (ctx, args) => {
    const article = await ownedArticle(ctx, args.articleId, args.userId);
    if (!article || !(await libraryIsActive(ctx, args.userId)))
      return "unavailable";
    const row = await summaryState(ctx, args.articleId);
    if (!row || row.userId !== args.userId || row.run !== args.run)
      return "superseded";
    if (row.status === "complete") {
      if (
        row.source !== (await summarySource(ctx, article)) ||
        !row.resultId ||
        !(await ctx.db.get(row.resultId))
      )
        return "superseded";
      return "complete";
    }
    return row.status === "running" && row.leaseUntil <= Date.now()
      ? "expired"
      : row.status;
  },
});

export const failFull = internalMutation({
  args: { userId: v.string(), articleId: v.id("articles"), run: v.number() },
  handler: async (ctx, args) => {
    const row = await summaryState(ctx, args.articleId);
    if (
      row?.userId === args.userId &&
      row.run === args.run &&
      row.status === "running"
    )
      await ctx.db.patch(row._id, { status: "failed" });
  },
});

/** Replaces any existing summary only after validating publication authority. */
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
    generation: v.optional(summaryGeneration),
  },
  handler: async (ctx, args) => {
    const article = await ownedArticle(ctx, args.articleId, args.userId);
    if (!article || !(await libraryIsActive(ctx, args.userId))) return null;
    const claim = await summaryState(ctx, args.articleId);
    if (claim) {
      if (
        !args.generation ||
        claim.userId !== args.userId ||
        claim.run !== args.generation.run
      )
        return null;
      if (claim.source !== (await summarySource(ctx, article))) return null;
      if (claim.status === "complete") return claim.resultId ?? null;
      if (claim.status !== "running" || claim.leaseUntil <= Date.now())
        return null;
    } else if (args.generation) return null;
    const existing = await ctx.db
      .query("summaries")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .take(10);
    for (const row of existing) await ctx.db.delete("summaries", row._id);
    const { generation: _generation, ...data } = args;
    const resultId = await ctx.db.insert("summaries", {
      ...data,
      createdAt: Date.now(),
    });
    if (claim) await ctx.db.patch(claim._id, { status: "complete", resultId });
    return resultId;
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
    generation: v.optional(annotationGeneration),
  },
  handler: async (ctx, args) => {
    const article = await ownedArticle(ctx, args.articleId, args.userId);
    if (!article) throw new Error("Article not found");
    if (!(await annotationPublicationAllowed(ctx, article, args.generation)))
      return null;
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
    runId: v.optional(v.number()),
    claim: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // A late call for a reader who is leaving or a book that is gone writes nothing
    if (!(await libraryIsActive(ctx, args.userId))) return null;
    const article = await ownedArticle(ctx, args.articleId, args.userId);
    if (!article?.bookOutline) return null;
    const book = await ctx.db
      .query("books")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", args.articleId),
      )
      .unique();
    const state = await ctx.db
      .query("bookIndexState")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", args.articleId),
      )
      .unique();
    if (
      !book ||
      !state?.running ||
      state.phase !== "point" ||
      state.overviewDone ||
      state.pointClaimedAt === undefined
    )
      return null;
    if (args.runId !== undefined || args.claim !== undefined) {
      // A partial identity must not fall through to legacy acceptance.
      if (args.runId !== state.runId || args.claim !== state.pointClaimedAt)
        return null;
    } else if (!legacyOverviewClaim(state, Date.now())) {
      return null;
    }
    const thesis = args.thesis.trim();
    const gist = args.gist.trim();
    if (!thesis || !gist) return null;
    // Consume legacy permission and settle the paid result atomically. If an
    // old action is lost before pointWritten, the watchdog/step cannot spend
    // again on an overview that has already been saved.
    await ctx.db.patch("bookIndexState", state._id, {
      legacyPoint: undefined,
      overviewDone: true,
      updatedAt: Date.now(),
    });
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
    if (!articleId || !(await ownedArticleCard(ctx, articleId, args.userId)))
      return null;
    const row = await ctx.db
      .query("summaries")
      .withIndex("by_article", (q) => q.eq("articleId", articleId))
      .first();
    return row?.userId === args.userId
      ? { thesis: row.thesis, gist: row.gist }
      : null;
  },
});
