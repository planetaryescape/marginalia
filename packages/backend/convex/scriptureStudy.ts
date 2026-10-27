import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./functions";
import { sourceHash } from "./lib/preparedRepresentation";
import type { ScriptureSelection } from "./lib/scriptureStudy";
import {
  SOURCE_POLICY,
  STUDY_LIMITS,
  STUDY_VERSION,
  selectedVerses,
  selectionValidator,
} from "./lib/scriptureStudy";
import {
  currentRun,
  ownedArticle,
  ownedStudy,
  studyPolicy,
} from "./lib/scriptureStudyState";
import { sha256Hex } from "./lib/tokens";

type Admission = {
  studyId: Id<"scriptureStudies">;
  runId: Id<"scriptureStudyRuns">;
  admission: "started" | "joined" | "reused";
};
async function admit(
  ctx: MutationCtx,
  userId: string,
  args: {
    articleId: Id<"articles">;
    selection: ScriptureSelection;
    sourceHash: string;
    requestKey: string;
  },
  refreshStudy?: Doc<"scriptureStudies">,
): Promise<Admission> {
  if (!/^[\w-]{1,100}$/.test(args.requestKey))
    throw new Error("Use a unique request key of at most 100 characters.");
  const article = await ownedArticle(ctx, userId, args.articleId);
  selectedVerses(
    article.content ?? "",
    args.selection,
    article.bible.reference,
  );
  if (
    (await sourceHash(article.content, article.contentHtml)) !== args.sourceHash
  )
    throw new Error("The saved WEB source changed. Reselect the passage.");
  const policy = await studyPolicy(ctx, userId);
  const scopeKey = await sha256Hex(
    JSON.stringify([
      args.articleId,
      [
        args.selection.referenceKey,
        args.selection.startVerseId,
        args.selection.endVerseId,
        args.selection.versificationId,
      ],
      args.sourceHash,
      policy.hash,
      SOURCE_POLICY,
      STUDY_VERSION,
    ]),
  );
  const alias = await ctx.db
    .query("scriptureStudyRequests")
    .withIndex("by_userId_and_requestKey", (q) =>
      q.eq("userId", userId).eq("requestKey", args.requestKey),
    )
    .unique();
  const repeated = alias
    ? await ctx.db.get(alias.runId)
    : await ctx.db
        .query("scriptureStudyRuns")
        .withIndex("by_userId_and_requestKey", (q) =>
          q.eq("userId", userId).eq("requestKey", args.requestKey),
        )
        .unique();
  if (repeated) {
    const study = await ctx.db.get(repeated.studyId);
    if (
      !study ||
      study.scopeKey !== scopeKey ||
      (refreshStudy && study._id !== refreshStudy._id)
    )
      throw new Error(
        "Request key already belongs to a different study scope.",
      );
    if (repeated.status === "complete" && study.publishedRunId !== repeated._id)
      throw new Error(
        "This request was superseded. Reopen the latest Study result.",
      );
    return {
      studyId: study._id,
      runId: repeated._id,
      admission: repeated.status === "complete" ? "reused" : "joined",
    };
  }
  let study =
    refreshStudy ??
    (await ctx.db
      .query("scriptureStudies")
      .withIndex("by_userId_and_scopeKey", (q) =>
        q.eq("userId", userId).eq("scopeKey", scopeKey),
      )
      .unique());
  if (study && study.scopeKey !== scopeKey)
    throw new Error("Study source or model policy changed. Start a new study.");
  if (study?.activeRunId) {
    const active = await ctx.db.get(study.activeRunId);
    if (active && (await currentRun(ctx, active))) {
      const requests = await ctx.db
        .query("scriptureStudyRequests")
        .withIndex("by_runId", (q) => q.eq("runId", active._id))
        .take(STUDY_LIMITS.requestAliases);
      if (requests.length >= STUDY_LIMITS.requestAliases)
        throw new Error(
          "This Study has too many duplicate requests. Reopen it from history.",
        );
      await ctx.db.insert("scriptureStudyRequests", {
        userId,
        requestKey: args.requestKey,
        runId: active._id,
      });
      return { studyId: study._id, runId: active._id, admission: "joined" };
    }
    if (active && (active.status === "running" || active.status === "queued"))
      await ctx.db.patch(active._id, {
        status: "failed",
        errorCode: "expired_or_changed",
        finishedAt: Date.now(),
        purgeAt: Date.now() + STUDY_LIMITS.temporaryRetentionMs,
      });
  }
  if (!refreshStudy && study?.publishedRunId)
    return {
      studyId: study._id,
      runId: study.publishedRunId,
      admission: "reused",
    };
  for (const status of ["queued", "running"] as const) {
    const active = await ctx.db
      .query("scriptureStudyRuns")
      .withIndex("by_userId_and_status", (q) =>
        q.eq("userId", userId).eq("status", status),
      )
      .take(8);
    for (const run of active) {
      if (await currentRun(ctx, run))
        throw new Error(
          "One Study is already running. Cancel it before starting another.",
        );
      await ctx.db.patch(run._id, {
        status: "failed",
        errorCode: "expired_or_changed",
        finishedAt: Date.now(),
        purgeAt: Date.now() + STUDY_LIMITS.temporaryRetentionMs,
      });
    }
  }
  const budget = await ctx.db
    .query("scriptureStudyBudgets")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  const starts = (budget?.starts ?? []).filter(
    (at) => at > Date.now() - 3_600_000,
  );
  if (starts.length >= STUDY_LIMITS.newRunsPerHour)
    throw new Error("Study limit reached. Try again after an hour.");
  starts.push(Date.now());
  if (budget) await ctx.db.patch(budget._id, { starts });
  else await ctx.db.insert("scriptureStudyBudgets", { userId, starts });
  if (!study) {
    const id = await ctx.db.insert("scriptureStudies", {
      userId,
      articleId: args.articleId,
      selection: args.selection,
      scopeKey,
      sourceHash: args.sourceHash,
      modelPolicyHash: policy.hash,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    study = await ctx.db.get(id);
  }
  if (!study) throw new Error("Study admission failed.");
  const runId = await ctx.db.insert("scriptureStudyRuns", {
    userId,
    articleId: args.articleId,
    studyId: study._id,
    requestKey: args.requestKey,
    status: "queued",
    leaseUntil: Date.now() + STUDY_LIMITS.deadlineMs,
    createdAt: Date.now(),
    sourceHash: args.sourceHash,
    modelPolicyHash: policy.hash,
    modelId: policy.modelId,
    credentialHash: policy.credentialHash,
    version: STUDY_VERSION,
    sourcePolicy: SOURCE_POLICY,
    purgeAt: Date.now() + STUDY_LIMITS.temporaryRetentionMs,
  });
  await ctx.db.patch(study._id, { activeRunId: runId, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.actions.scriptureStudy.generate, {
    runId,
  });
  await ctx.scheduler.runAfter(
    STUDY_LIMITS.deadlineMs,
    internal.scriptureStudyRuns.expire,
    { runId },
  );
  return { studyId: study._id, runId, admission: "started" };
}
export const start = mutation({
  args: {
    articleId: v.id("articles"),
    selection: selectionValidator,
    sourceHash: v.string(),
    requestKey: v.string(),
  },
  handler: (ctx, args): Promise<Admission> => admit(ctx, ctx.readerId, args),
});
export const refresh = mutation({
  args: {
    studyId: v.id("scriptureStudies"),
    publishedRunId: v.optional(v.id("scriptureStudyRuns")),
    requestKey: v.string(),
  },
  handler: async (ctx, args): Promise<Admission> => {
    const study = await ownedStudy(ctx, ctx.readerId, args.studyId);
    if (args.publishedRunId && study.publishedRunId !== args.publishedRunId)
      throw new Error("A newer result is available. Reopen Study.");
    return admit(
      ctx,
      ctx.readerId,
      {
        articleId: study.articleId,
        selection: study.selection,
        sourceHash: study.sourceHash,
        requestKey: args.requestKey,
      },
      study,
    );
  },
});
function metadata(run: Doc<"scriptureStudyRuns"> | null) {
  if (!run) return null;
  const context: Pick<
    Doc<"scriptureStudyRuns">,
    "contextSummary" | "generation"
  > = {};
  if (run.contextSummary) context.contextSummary = run.contextSummary;
  if (run.generation) context.generation = run.generation;
  return {
    runId: run._id,
    status:
      (run.status === "queued" || run.status === "running") &&
      run.leaseUntil <= Date.now()
        ? ("failed" as const)
        : run.status,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt ?? null,
    leaseUntil: run.leaseUntil,
    errorCode: run.errorCode ?? null,
    modelId: run.modelId ?? null,
    outcome: run.outcome ?? null,
    coverage: run.coverage ?? [],
    evidenceSetHash: run.evidenceSetHash ?? null,
    ...context,
  };
}
export const get = query({
  args: { studyId: v.id("scriptureStudies") },
  handler: async (ctx, args) => {
    const study = await ownedStudy(ctx, ctx.readerId, args.studyId);
    return {
      studyId: study._id,
      articleId: study.articleId,
      selection: study.selection,
      sourceHash: study.sourceHash,
      activeRun: metadata(
        study.activeRunId ? await ctx.db.get(study.activeRunId) : null,
      ),
      publishedRun: metadata(
        study.publishedRunId ? await ctx.db.get(study.publishedRunId) : null,
      ),
    };
  },
});
async function published(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  runId: Id<"scriptureStudyRuns">,
) {
  const run = await ctx.db.get(runId);
  if (!run || run.userId !== userId || run.status !== "complete")
    throw new Error("Published study result not found.");
  const study = await ownedStudy(ctx, userId, run.studyId);
  if (study.publishedRunId !== runId)
    throw new Error("This result was superseded. Reopen Study.");
  return run;
}
export const findings = query({
  args: {
    runId: v.id("scriptureStudyRuns"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await published(ctx, ctx.readerId, args.runId);
    const page = await ctx.db
      .query("scriptureStudyFindings")
      .withIndex("by_runId_and_order", (q) => q.eq("runId", args.runId))
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(
          STUDY_LIMITS.findings,
          Math.max(1, args.paginationOpts.numItems),
        ),
      });
    return { ...page, page: page.page.map((row) => row.finding) };
  },
});
export const evidence = query({
  args: { runId: v.id("scriptureStudyRuns"), evidenceId: v.string() },
  handler: async (ctx, args) => {
    const run = await published(ctx, ctx.readerId, args.runId);
    return (
      run.evidence?.find((item) => item.evidenceId === args.evidenceId) ?? null
    );
  },
});
export const listByArticle = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    await ownedArticle(ctx, ctx.readerId, args.articleId);
    return (
      await ctx.db
        .query("scriptureStudies")
        .withIndex("by_userId_and_articleId", (q) =>
          q.eq("userId", ctx.readerId).eq("articleId", args.articleId),
        )
        .order("desc")
        .take(STUDY_LIMITS.history)
    ).map((study) => ({
      studyId: study._id,
      selection: study.selection,
      activeRunId: study.activeRunId ?? null,
      publishedRunId: study.publishedRunId ?? null,
      updatedAt: study.updatedAt,
    }));
  },
});
export const cancel = mutation({
  args: {
    studyId: v.id("scriptureStudies"),
    runId: v.id("scriptureStudyRuns"),
  },
  handler: async (ctx, args) => {
    const study = await ownedStudy(ctx, ctx.readerId, args.studyId);
    const run = await ctx.db.get(args.runId);
    if (!run || run.studyId !== study._id || run.userId !== ctx.readerId)
      throw new Error("Study run not found.");
    if (
      study.activeRunId === run._id &&
      (run.status === "queued" || run.status === "running")
    ) {
      await ctx.db.patch(run._id, {
        status: "cancelled",
        finishedAt: Date.now(),
        purgeAt: Date.now() + STUDY_LIMITS.temporaryRetentionMs,
      });
      await ctx.db.patch(study._id, { updatedAt: Date.now() });
    }
  },
});
export const remove = mutation({
  args: { studyId: v.id("scriptureStudies") },
  handler: async (ctx, args) => {
    const study = await ctx.db.get(args.studyId);
    if (!study || study.userId !== ctx.readerId)
      throw new Error("Study not found.");
    await ctx.db.delete(study._id);
    await ctx.scheduler.runAfter(0, internal.scriptureStudyCleanup.study, {
      studyId: args.studyId,
      userId: ctx.readerId,
    });
  },
});
