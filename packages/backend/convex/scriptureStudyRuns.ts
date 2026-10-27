import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./functions";
import type { StudyEvidence } from "./lib/scriptureStudy";
import {
  evidenceValidator,
  resultSchema,
  STUDY_LIMITS,
  STUDY_SOURCE_REGISTRY,
  studyCoverage,
  validateResult,
} from "./lib/scriptureStudy";
import { currentRun } from "./lib/scriptureStudyState";
import { sha256Hex } from "./lib/tokens";

async function manifestIdentity(
  run: Doc<"scriptureStudyRuns">,
  evidence: StudyEvidence[],
) {
  const evidenceSetHash = await sha256Hex(JSON.stringify(evidence));
  const inputKey = await sha256Hex(
    JSON.stringify([
      run.sourceHash,
      run.modelPolicyHash,
      run.credentialHash,
      run.version,
      run.sourcePolicy,
      evidenceSetHash,
    ]),
  );
  return { evidenceSetHash, inputKey };
}
export const claim = internalMutation({
  args: { runId: v.id("scriptureStudyRuns"), claimToken: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "queued") return null;
    const current = await currentRun(ctx, run);
    if (!current) return null;
    await ctx.db.patch(run._id, {
      status: "running",
      claimToken: args.claimToken,
    });
    return {
      userId: run.userId,
      selection: current.study.selection,
      articleReference: current.article.bible.reference,
      verses: current.verses,
      leaseUntil: run.leaseUntil,
      modelId: run.modelId,
    };
  },
});
export const check = internalQuery({
  args: { runId: v.id("scriptureStudyRuns"), claimToken: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    return (
      !!run &&
      run.claimToken === args.claimToken &&
      run.status === "running" &&
      !!(await currentRun(ctx, run))
    );
  },
});
export const manifest = internalMutation({
  args: {
    runId: v.id("scriptureStudyRuns"),
    claimToken: v.string(),
    evidence: v.array(evidenceValidator),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.status !== "running" ||
      run.claimToken !== args.claimToken ||
      run.evidenceSetHash ||
      !(await currentRun(ctx, run))
    )
      return null;
    if (
      args.evidence.length > STUDY_LIMITS.evidence ||
      new TextEncoder().encode(JSON.stringify(args.evidence)).length >
        STUDY_LIMITS.evidenceBytes ||
      args.evidence.reduce((n, e) => n + e.excerpt.length, 0) >
        STUDY_LIMITS.sourceChars ||
      args.evidence.some((e) => e.excerpt.length > STUDY_LIMITS.excerptChars) ||
      new Set(args.evidence.map((e) => e.evidenceId)).size !==
        args.evidence.length
    )
      throw new Error("Evidence exceeds study limits.");
    for (const item of args.evidence) {
      const registered = STUDY_SOURCE_REGISTRY.find(
        (source) => source.id === item.source.id,
      );
      if (
        !registered ||
        registered.title !== item.source.title ||
        registered.revision !== item.source.revision ||
        registered.rights !== item.source.rights ||
        JSON.stringify(registered.capabilities) !==
          JSON.stringify(item.source.capabilities) ||
        item.contentHash !== (await sha256Hex(item.excerpt))
      )
        throw new Error("Unregistered or changed evidence source.");
    }
    const { evidenceSetHash, inputKey } = await manifestIdentity(
      run,
      args.evidence,
    );
    await ctx.db.patch(run._id, {
      evidence: args.evidence,
      evidenceSetHash,
      inputKey,
    });
    return inputKey;
  },
});
export const publish = internalMutation({
  args: {
    runId: v.id("scriptureStudyRuns"),
    claimToken: v.string(),
    inputKey: v.string(),
    resultJson: v.string(),
    modelId: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.status !== "running" ||
      run.claimToken !== args.claimToken ||
      run.inputKey !== args.inputKey ||
      run.modelId !== args.modelId ||
      !run.evidence
    )
      return false;
    const manifest = await manifestIdentity(run, run.evidence);
    if (
      manifest.evidenceSetHash !== run.evidenceSetHash ||
      manifest.inputKey !== run.inputKey
    )
      return false;
    const current = await currentRun(ctx, run);
    if (!current) return false;
    const result = validateResult(
      resultSchema.parse(JSON.parse(args.resultJson)),
      run.evidence,
      current.verses,
      current.study.selection,
    );
    for (const [order, finding] of result.findings.entries())
      await ctx.db.insert("scriptureStudyFindings", {
        userId: run.userId,
        articleId: run.articleId,
        runId: run._id,
        order,
        finding,
      });
    const old =
      current.study.publishedRunId &&
      (await ctx.db.get(current.study.publishedRunId));
    if (old)
      await ctx.db.patch(old._id, {
        purgeAt: Date.now() + STUDY_LIMITS.temporaryRetentionMs,
      });
    await ctx.db.patch(run._id, {
      status: "complete",
      finishedAt: Date.now(),
      outcome: result.findings.length ? "partial" : "no_meaningful_findings",
      coverage: studyCoverage(result.findings, run.evidence),
      purgeAt: undefined,
    });
    await ctx.db.patch(current.study._id, {
      activeRunId: undefined,
      publishedRunId: run._id,
      updatedAt: Date.now(),
    });
    return true;
  },
});
export const fail = internalMutation({
  args: {
    runId: v.id("scriptureStudyRuns"),
    claimToken: v.string(),
    errorCode: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running" || run.claimToken !== args.claimToken)
      return;
    await ctx.db.patch(run._id, {
      status: "failed",
      errorCode: args.errorCode,
      finishedAt: Date.now(),
      purgeAt: Date.now() + STUDY_LIMITS.temporaryRetentionMs,
    });
    const study = await ctx.db.get(run.studyId);
    if (study?.activeRunId === run._id)
      await ctx.db.patch(study._id, { updatedAt: Date.now() });
  },
});

export const expire = internalMutation({
  args: { runId: v.id("scriptureStudyRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      (run.status !== "queued" && run.status !== "running") ||
      run.leaseUntil > Date.now()
    )
      return;
    await ctx.db.patch(run._id, {
      status: "failed",
      errorCode: "lease_expired",
      finishedAt: Date.now(),
      purgeAt: Date.now() + STUDY_LIMITS.temporaryRetentionMs,
    });
    const study = await ctx.db.get(run.studyId);
    if (study?.activeRunId === run._id)
      await ctx.db.patch(study._id, { updatedAt: Date.now() });
  },
});
