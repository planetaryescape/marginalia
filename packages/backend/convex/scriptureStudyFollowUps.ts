import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { citedScriptureReferences } from "./lib/scriptureReferences";
import {
  evidenceValidator,
  STUDY_LIMITS,
  type StudyEvidence,
} from "./lib/scriptureStudy";
import { evidenceVerses } from "./lib/scriptureStudyFollowUpEvidence";
import {
  FOLLOW_UP_LIMITS,
  followUpPolicyHash,
  followUpSourceOutcomeValidator,
  studyAnswerValidator,
} from "./lib/scriptureStudyFollowUps";
import { validateFollowUpAnswer } from "./lib/scriptureStudyFollowUpValidation";
import { ownedStudy, studyPolicy } from "./lib/scriptureStudyState";
import { READER_LIMITS, spendReaderLimit } from "./limits";

async function completed(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  runId: Id<"scriptureStudyRuns">,
) {
  const run = await ctx.db.get(runId);
  if (!run || run.userId !== userId || run.status !== "complete")
    throw new Error("Completed study not found.");
  const study = await ownedStudy(ctx, userId, run.studyId);
  if (study.publishedRunId !== runId)
    throw new Error("A newer study is available. Reopen it before asking.");
  return run;
}
async function active(
  ctx: Pick<QueryCtx, "db">,
  row: Doc<"scriptureStudyFollowUps">,
) {
  if (
    (row.status !== "queued" && row.status !== "running") ||
    row.leaseUntil <= Date.now()
  )
    return false;
  try {
    const run = await completed(ctx, row.userId, row.runId);
    const study = await ctx.db.get(run.studyId);
    if (study?.activeRunId) return false;
    const policy = await studyPolicy(ctx, row.userId);
    return (
      row.followUpPolicyHash === (await followUpPolicyHash()) &&
      policy.hash === row.modelPolicyHash &&
      policy.credentialHash === row.credentialHash
    );
  } catch {
    return false;
  }
}
export const list = query({
  args: { runId: v.id("scriptureStudyRuns") },
  handler: async (ctx, { runId }) => {
    await completed(ctx, ctx.readerId, runId);
    const rows = await ctx.db
      .query("scriptureStudyFollowUps")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .take(FOLLOW_UP_LIMITS.attempts);
    return rows
      .filter((row) => row.userId === ctx.readerId)
      .map((row) => ({
        id: row._id,
        requestKey: row.requestKey,
        question: row.question,
        status:
          (row.status === "running" || row.status === "queued") &&
          row.leaseUntil <= Date.now()
            ? ("failed" as const)
            : row.status,
        answer: row.answer ?? null,
      }));
  },
});
export const ask = mutation({
  args: {
    runId: v.id("scriptureStudyRuns"),
    requestKey: v.string(),
    question: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await completed(ctx, ctx.readerId, args.runId);
    if ((await ctx.db.get(run.studyId))?.activeRunId)
      throw new Error("Wait for the refreshed study before asking a question.");
    if (!run.evidence?.length)
      throw new Error(
        "This study has no saved sources for follow-up questions.",
      );
    const question = args.question.trim();
    if (
      !question ||
      question.length > FOLLOW_UP_LIMITS.questionChars ||
      !/^[\w-]{1,100}$/.test(args.requestKey)
    )
      throw new Error("Ask a question of at most 2,000 characters.");
    const repeated = await ctx.db
      .query("scriptureStudyFollowUps")
      .withIndex("by_userId_and_requestKey", (q) =>
        q.eq("userId", ctx.readerId).eq("requestKey", args.requestKey),
      )
      .unique();
    if (repeated) {
      if (repeated.runId !== args.runId || repeated.question !== question)
        throw new Error("This request belongs to a different question.");
      return repeated._id;
    }
    const rows = await ctx.db
      .query("scriptureStudyFollowUps")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .take(FOLLOW_UP_LIMITS.attempts);
    if (
      rows.filter((row) => row.status === "complete").length >=
      FOLLOW_UP_LIMITS.questions
    )
      throw new Error("This study has reached its 12-answer limit.");
    if (rows.length >= FOLLOW_UP_LIMITS.attempts)
      throw new Error("This study has reached its follow-up attempt limit.");
    for (const row of rows)
      if (await active(ctx, row))
        throw new Error("Wait for the current answer or stop it first.");
    const policy = await studyPolicy(ctx, ctx.readerId);
    if (!(await spendReaderLimit(ctx, ctx.readerId, "ai")))
      throw new Error(READER_LIMITS.ai.message);
    const id = await ctx.db.insert("scriptureStudyFollowUps", {
      userId: ctx.readerId,
      runId: args.runId,
      requestKey: args.requestKey,
      question,
      status: "queued",
      leaseUntil: Date.now() + FOLLOW_UP_LIMITS.deadlineMs,
      modelPolicyHash: policy.hash,
      credentialHash: policy.credentialHash,
      modelId: policy.modelId,
      followUpPolicyHash: await followUpPolicyHash(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.scriptureStudyFollowUps.generate,
      { id },
    );
    await ctx.scheduler.runAfter(
      FOLLOW_UP_LIMITS.deadlineMs,
      internal.scriptureStudyFollowUps.expire,
      { id },
    );
    return id;
  },
});
export const cancel = mutation({
  args: { id: v.id("scriptureStudyFollowUps") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row || row.userId !== ctx.readerId)
      throw new Error("Question not found.");
    await completed(ctx, ctx.readerId, row.runId);
    if (row.status === "queued" || row.status === "running")
      await ctx.db.patch(id, { status: "cancelled" });
  },
});
export const claim = internalMutation({
  args: { id: v.id("scriptureStudyFollowUps"), token: v.string() },
  handler: async (ctx, { id, token }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "queued") return null;
    if (!(await active(ctx, row))) {
      await ctx.db.patch(id, { status: "failed" });
      return null;
    }
    const run = await completed(ctx, row.userId, row.runId);
    const findings = await ctx.db
      .query("scriptureStudyFindings")
      .withIndex("by_runId_and_order", (q) => q.eq("runId", row.runId))
      .take(STUDY_LIMITS.findings);
    const rows = await ctx.db
      .query("scriptureStudyFollowUps")
      .withIndex("by_runId", (q) => q.eq("runId", row.runId))
      .take(FOLLOW_UP_LIMITS.attempts);
    const history: { question: string; answer: string }[] = [];
    const carried = new Map<string, StudyEvidence>();
    const requested = citedScriptureReferences(row.question);
    const earlier = rows.filter(
      (item) =>
        item.userId === row.userId &&
        item.status === "complete" &&
        item._creationTime <= row._creationTime,
    );
    const available = earlier.flatMap((item) => item.additionalEvidence ?? []);
    const carry = (ids: string[]) => {
      for (const id of ids) {
        const item = available.find((evidence) => evidence.evidenceId === id);
        if (
          !item ||
          carried.has(id) ||
          carried.size >= FOLLOW_UP_LIMITS.carriedEvidence ||
          [...carried.values()].reduce(
            (n, evidence) => n + evidence.excerpt.length,
            0,
          ) +
            item.excerpt.length >
            FOLLOW_UP_LIMITS.additionalChars
        )
          continue;
        carried.set(id, item);
      }
    };
    carry(
      available
        .filter((item) =>
          requested.some((ref) => evidenceVerses([item], ref).length > 0),
        )
        .map((item) => item.evidenceId),
    );
    let chars = 0;
    for (const previous of [...earlier].reverse()) {
      const answer = previous.answer?.answer;
      if (history.length >= 4) break;
      if (
        !answer ||
        chars + previous.question.length + answer.length >
          FOLLOW_UP_LIMITS.historyChars
      )
        break;
      chars += previous.question.length + answer.length;
      history.unshift({ question: previous.question, answer });
      carry(previous.answer?.evidenceIds ?? []);
    }
    const carriedEvidenceIds = [...carried.keys()];
    const evidence = [...(run.evidence ?? []), ...carried.values()];
    if (
      new TextEncoder().encode(JSON.stringify(evidence)).byteLength >
      FOLLOW_UP_LIMITS.evidenceBytes
    )
      throw new Error("Follow-up evidence exceeds limits.");
    await ctx.db.patch(id, { status: "running", token, carriedEvidenceIds });
    return {
      userId: row.userId,
      modelId: row.modelId,
      leaseUntil: row.leaseUntil,
      question: row.question,
      history,
      teaching: run.teaching ?? null,
      findings: findings.map((item) => item.finding),
      evidence,
      completeChapterKeys:
        run.contextSummary?.chapterCoverage === "full_retrieved_chapter"
          ? [
              run.contextSummary.chapterReferenceKey
                .split(".")
                .slice(0, 2)
                .join("."),
            ]
          : [],
    };
  },
});
export const check = internalQuery({
  args: { id: v.id("scriptureStudyFollowUps"), token: v.string() },
  handler: async (ctx, { id, token }) => {
    const row = await ctx.db.get(id);
    return (
      !!row &&
      row.status === "running" &&
      row.token === token &&
      (await active(ctx, row))
    );
  },
});
export const publish = internalMutation({
  args: {
    id: v.id("scriptureStudyFollowUps"),
    token: v.string(),
    answer: studyAnswerValidator,
    additionalEvidence: v.optional(v.array(evidenceValidator)),
    sourceOutcomes: v.optional(v.array(followUpSourceOutcomeValidator)),
  },
  handler: async (
    ctx,
    { id, token, answer: raw, additionalEvidence = [], sourceOutcomes = [] },
  ) => {
    const row = await ctx.db.get(id);
    if (
      !row ||
      row.token !== token ||
      row.status !== "running" ||
      !(await active(ctx, row))
    )
      return false;
    const run = await completed(ctx, row.userId, row.runId);
    const previous = await ctx.db
      .query("scriptureStudyFollowUps")
      .withIndex("by_runId", (q) => q.eq("runId", row.runId))
      .take(FOLLOW_UP_LIMITS.attempts);
    const carried = (row.carriedEvidenceIds ?? []).map((id) =>
      previous
        .filter(
          (item) =>
            item.userId === row.userId &&
            item.status === "complete" &&
            item._creationTime <= row._creationTime,
        )
        .flatMap((item) => item.additionalEvidence ?? [])
        .find((item) => item.evidenceId === id),
    );
    if (carried.some((item) => !item))
      throw new Error("Unknown carried answer source.");
    const { answer, evidenceSetHash } = await validateFollowUpAnswer({
      answer: raw,
      baseEvidence: run.evidence ?? [],
      carriedEvidence: carried.filter((item) => item !== undefined),
      additionalEvidence,
      sourceOutcomes,
    });
    await ctx.db.patch(id, {
      status: "complete",
      answer,
      additionalEvidence,
      sourceOutcomes,
      evidenceSetHash,
    });
    return true;
  },
});
export const fail = internalMutation({
  args: { id: v.id("scriptureStudyFollowUps"), token: v.string() },
  handler: async (ctx, { id, token }) => {
    const row = await ctx.db.get(id);
    if (row?.status === "running" && row.token === token)
      await ctx.db.patch(id, { status: "failed" });
  },
});
export const expire = internalMutation({
  args: { id: v.id("scriptureStudyFollowUps") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (
      row &&
      (row.status === "queued" || row.status === "running") &&
      row.leaseUntil <= Date.now()
    )
      await ctx.db.patch(id, { status: "failed" });
  },
});

export const sources = query({
  args: { runId: v.id("scriptureStudyRuns") },
  handler: async (ctx, { runId }) => {
    await completed(ctx, ctx.readerId, runId);
    const rows = await ctx.db
      .query("scriptureStudyFollowUps")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .take(FOLLOW_UP_LIMITS.attempts);
    return [
      ...new Map(
        rows
          .filter(
            (row) => row.userId === ctx.readerId && row.status === "complete",
          )
          .flatMap((row) => row.additionalEvidence ?? [])
          .map((item) => [item.evidenceId, item]),
      ).values(),
    ].map(({ evidenceId, source, locator, referenceKey, limitations }) => ({
      evidenceId,
      source,
      locator,
      referenceKey,
      limitations,
    }));
  },
});
