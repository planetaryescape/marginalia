"use node";
import { getFunctionName } from "convex/server";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { action } from "../functions";
import { generateObjectWithFallback } from "../lib/aiModels";
import {
  EDGE_JOIN_MS,
  EDGE_JOIN_READS,
  EDGE_REASON_DESCRIPTION,
  EDGE_SYSTEM,
  EDGE_TOKENS,
  type EdgeRequest,
  edgeRoutingIdentity,
  validEdgeReason,
} from "../lib/edgeExplanations";
import type { Reason } from "../lib/ideaGraph";
import { NO_PROVIDER_MESSAGE } from "../lib/providers";
import { loadReaderAI } from "../lib/router";
import { requireReaderLimit } from "../limits";

// D-DES-051: say what connects the two, leave the conclusion to the reader.
export const SYSTEM = EDGE_SYSTEM;

const schema = z.object({
  reason: z.string().describe(EDGE_REASON_DESCRIPTION),
});

export type EdgeExplanation =
  | { source: "structural"; reasons: Reason[] }
  | { source: "generated"; reason: string; cached: boolean };

/**
 * Why two ideas are connected. Structural reasons are answered from the
 * database for free; only a pair that embeddings alone put together costs a
 * model call, and the sentence is cached until either idea's text changes.
 */
export async function explainEdge(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation"> & { readerId: string },
  args: Omit<EdgeRequest, "userId">,
): Promise<EdgeExplanation> {
  const request = { ...args, userId: ctx.readerId };
  const claim = await ctx.runMutation(internal.ideaEdgeReasons.claim, request);
  if (claim.kind === "structural")
    return { source: "structural", reasons: claim.reasons };
  if (claim.kind === "cached")
    return { source: "generated", reason: claim.reason, cached: true };

  // Joining only reads: timeout neither releases another action's claim nor
  // retries paid work. Each new explicit action can recover an expired lease.
  const join = async (): Promise<EdgeExplanation> => {
    for (let i = 0; i < EDGE_JOIN_READS; i++) {
      if (i) await new Promise((resolve) => setTimeout(resolve, EDGE_JOIN_MS));
      const result = await ctx.runQuery(
        internal.ideaEdgeReasons.settled,
        request,
      );
      if (result.kind === "structural")
        return { source: "structural", reasons: result.reasons };
      if (result.kind === "cached")
        return { source: "generated", reason: result.reason, cached: true };
      if (result.kind !== "waiting")
        throw new ConvexError(
          "The ideas or explanation changed. Ask again to try explicitly.",
        );
    }
    throw new ConvexError(
      "The explanation is still being generated. Ask again to check it; this request did not start another generation.",
    );
  };
  if (claim.kind === "join") return join();

  try {
    await requireReaderLimit(ctx, ctx.readerId, "ai");
    // Observe the actual snapshot the existing router decrypts, rather than
    // guessing it from a before/after read (which misses routing A→B→A).
    let dispatchedRouting: string | undefined;
    const runQuery: typeof ctx.runQuery = async (ref, queryArgs) => {
      const value = await ctx.runQuery(ref, queryArgs);
      if (getFunctionName(ref) === "providerCredentials:routing")
        dispatchedRouting = await edgeRoutingIdentity(value);
      return value;
    };
    const ai = await loadReaderAI({ ...ctx, runQuery }, ctx.readerId);
    const targets = ai.chain("quick");
    if (!targets.length) throw new ConvexError(NO_PROVIDER_MESSAGE);
    const current = await ctx.runMutation(
      internal.ideaEdgeReasons.dispatchContext,
      {
        ...request,
        generation: claim.generation,
        snapshot: dispatchedRouting ?? "",
        targets: targets.map(({ provider, id, model }) => ({
          provider,
          id,
          model,
        })),
      },
    );
    if (
      !current ||
      current.input !== claim.input ||
      current.routing.identity !== claim.routing
    )
      throw new ConvexError(
        "The ideas or quick-model setup changed. Ask again to try explicitly.",
      );
    const { object, modelId } = await generateObjectWithFallback<
      z.infer<typeof schema>
    >({
      schema,
      system: SYSTEM,
      prompt: claim.prompt,
      targets,
      maxOutputTokens: EDGE_TOKENS,
      onFailure: ai.noteFailure,
    });
    const reason = validEdgeReason(object.reason);
    if (!reason) throw new Error("The model returned no reason");
    const saved = await ctx.runMutation(internal.ideaEdgeReasons.saveReason, {
      userId: ctx.readerId,
      pair: claim.pair,
      fingerprint: claim.fingerprint,
      reason,
      model: modelId,
      generation: claim.generation,
    });
    // Return the database's current result, never an unaccepted local answer.
    if (!saved) {
      await ctx.runMutation(internal.ideaEdgeReasons.failed, {
        userId: ctx.readerId,
        generation: claim.generation,
      });
      return await join();
    }
    const result = await join();
    return result.source === "generated"
      ? { ...result, cached: false }
      : result;
  } catch (error) {
    // Publication may have committed before its acknowledgement was lost.
    // Only the still-running matching token may be marked failed.
    await ctx.runMutation(internal.ideaEdgeReasons.failed, {
      userId: ctx.readerId,
      generation: claim.generation,
    });
    const result = await ctx.runQuery(
      internal.ideaEdgeReasons.settled,
      request,
    );
    if (result.kind === "cached")
      return { source: "generated", reason: result.reason, cached: true };
    if (result.kind === "structural")
      return { source: "structural", reasons: result.reasons };
    throw error;
  }
}

export const explain = action({
  args: {
    a: v.string(),
    b: v.string(),
    aVia: v.optional(v.string()),
    bVia: v.optional(v.string()),
  },
  handler: explainEdge,
});
