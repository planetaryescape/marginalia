"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../functions";
import { generateObjectWithFallback } from "../lib/aiModels";
import { sharedBibleCache } from "../lib/bibleResourceCache";
import { interruptible, requestAttempt } from "../lib/requestControl";
import { loadReaderAI } from "../lib/router";
import { expandFollowUpEvidence } from "../lib/scriptureStudyFollowUpEvidence";
import {
  FOLLOW_UP_LIMITS,
  STUDY_FOLLOW_UP_PROMPT,
  studyFollowUpResponseSchema,
  studyFollowUpSchema,
} from "../lib/scriptureStudyFollowUps";
import { studyObjectProviderSchema } from "../lib/scriptureStudyModelSchema";

export const generate = internalAction({
  args: { id: v.id("scriptureStudyFollowUps") },
  handler: async (ctx, { id }) => {
    const token = crypto.randomUUID();
    const claim = await ctx.runMutation(
      internal.scriptureStudyFollowUps.claim,
      { id, token },
    );
    if (!claim) return;
    const attempt = requestAttempt(
      undefined,
      Math.max(1, claim.leaseUntil - Date.now()),
    );
    let polling = false;
    const check = async () => {
      attempt.signal.throwIfAborted();
      if (
        !(await ctx.runQuery(internal.scriptureStudyFollowUps.check, {
          id,
          token,
        }))
      )
        attempt.abort(new Error("Answer stopped or study changed."));
      attempt.signal.throwIfAborted();
    };
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void check()
        .catch((error) => attempt.abort(error))
        .finally(() => {
          polling = false;
        });
    }, 500);
    try {
      const ai = await loadReaderAI(ctx, claim.userId, {
        signal: attempt.signal,
      });
      const target = ai.chain("deep")[0];
      if (
        !target ||
        target.id !== claim.modelId ||
        target.provider === "chatgpt"
      )
        throw new Error("Compatible study model unavailable.");
      await check();
      const firstSchema = studyFollowUpResponseSchema(
        claim.evidence.map((item) => item.evidenceId),
      );
      const context = {
        question: claim.question,
        conversationHistoryNotEvidence: claim.history,
        verifiedStudy: { teaching: claim.teaching, findings: claim.findings },
        savedEvidence: claim.evidence,
        expansion: "open",
      };
      const first = await interruptible(
        generateObjectWithFallback({
          schema: firstSchema,
          providerSchema: studyObjectProviderSchema(target.id, firstSchema),
          targets: [target],
          maxParseAttempts: 1,
          maxOutputTokens: FOLLOW_UP_LIMITS.outputTokens,
          deadlineMs: Math.max(1, claim.leaseUntil - Date.now()),
          signal: attempt.signal,
          onFailure: ai.noteFailure,
          system: STUDY_FOLLOW_UP_PROMPT,
          prompt: JSON.stringify(context),
        }),
        attempt.signal,
      );
      await check();
      // Parse here too: provider wrappers and tests must obey the same admission boundary.
      const response = firstSchema.parse(first.object);
      if (!response.requestedReferences.length) {
        await ctx.runMutation(internal.scriptureStudyFollowUps.publish, {
          id,
          token,
          answer: studyFollowUpSchema(
            claim.evidence.map((item) => item.evidenceId),
          ).parse(response),
        });
        return;
      }
      const supplement = await expandFollowUpEvidence({
        requests: response.requestedReferences,
        evidence: claim.evidence,
        completeChapterKeys: claim.completeChapterKeys,
        cache: sharedBibleCache(ctx),
        signal: attempt.signal,
        check,
      });
      await check();
      const evidence = [...claim.evidence, ...supplement.additionalEvidence];
      if (
        new TextEncoder().encode(JSON.stringify(evidence)).byteLength >
        FOLLOW_UP_LIMITS.evidenceBytes
      )
        throw new Error("Follow-up evidence exceeds limits.");
      const finalSchema = studyFollowUpSchema(
        evidence.map((item) => item.evidenceId),
      );
      const final = await interruptible(
        generateObjectWithFallback({
          schema: finalSchema,
          providerSchema: studyObjectProviderSchema(target.id, finalSchema),
          targets: [target],
          maxParseAttempts: 1,
          maxOutputTokens: FOLLOW_UP_LIMITS.outputTokens,
          deadlineMs: Math.max(1, claim.leaseUntil - Date.now()),
          signal: attempt.signal,
          onFailure: ai.noteFailure,
          system: STUDY_FOLLOW_UP_PROMPT,
          prompt: JSON.stringify({
            ...context,
            expansion: "closed",
            savedEvidence: evidence,
            sourceOutcomes: supplement.sourceOutcomes,
          }),
        }),
        attempt.signal,
      );
      await check();
      await ctx.runMutation(internal.scriptureStudyFollowUps.publish, {
        id,
        token,
        answer: finalSchema.parse(final.object),
        ...supplement,
      });
    } catch {
      // Never log private questions, prior conversation or provider response bodies.
      await ctx.runMutation(internal.scriptureStudyFollowUps.fail, {
        id,
        token,
      });
    } finally {
      clearInterval(timer);
      attempt.abort();
      attempt.dispose();
    }
  },
});
