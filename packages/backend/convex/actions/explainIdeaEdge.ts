"use node";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import { action } from "../functions";
import { generateObjectWithFallback } from "../lib/aiModels";
import { cleanReason, type Reason } from "../lib/ideaGraph";
import { NO_PROVIDER_MESSAGE } from "../lib/providers";
import { loadReaderAI } from "../lib/router";
import { requireReaderLimit } from "../limits";

// D-DES-051: say what connects the two, leave the conclusion to the reader.
export const SYSTEM = `You sit beside a reader looking at two of their own ideas that the app has put near each other.
In one sentence of under 35 words, say what connects them: the shared subject, the shared claim, or the way they pull against each other.
Describe the link; don't judge it, advise, summarise either idea or draw a conclusion, and don't speak as the reader. Use only the two texts given. If they share little, say what little they share.`;

const schema = z.object({
  reason: z
    .string()
    .describe("One sentence, under 35 words, saying what connects the two."),
});

export type EdgeExplanation =
  | { source: "structural"; reasons: Reason[] }
  | { source: "generated"; reason: string; cached: boolean };

/**
 * Why two ideas are connected. Structural reasons are answered from the
 * database for free; only a pair that embeddings alone put together costs a
 * model call, and the sentence is cached until either idea's text changes.
 */
export const explain = action({
  args: { a: v.string(), b: v.string() },
  handler: async (ctx, args): Promise<EdgeExplanation> => {
    const context = await ctx.runQuery(internal.ideaGraph.edgeContext, {
      userId: ctx.readerId,
      a: args.a,
      b: args.b,
    });
    if (!context) throw new ConvexError("Those ideas aren't in your notes.");
    if (context.structural.length)
      return { source: "structural", reasons: context.structural };
    if (context.cached?.fingerprint === context.fingerprint)
      return {
        source: "generated",
        reason: context.cached.reason,
        cached: true,
      };

    await requireReaderLimit(ctx, ctx.readerId, "ai");
    const ai = await loadReaderAI(ctx, ctx.readerId);
    const targets = ai.chain("quick");
    if (!targets.length) throw new ConvexError(NO_PROVIDER_MESSAGE);

    const describe = (n: typeof context.a, label: string) =>
      `${label} (${n.kind}${n.article ? `, from “${n.article}”` : ""}):\n${n.text}`;
    const { object, modelId } = await generateObjectWithFallback<
      z.infer<typeof schema>
    >({
      schema,
      system: SYSTEM,
      prompt: `${describe(context.a, "Idea one")}\n\n${describe(context.b, "Idea two")}`,
      targets,
      maxOutputTokens: 200,
      onFailure: ai.noteFailure,
    });
    const reason = cleanReason(object.reason);
    if (!reason) throw new Error("The model returned no reason");
    await ctx.runMutation(internal.ideaGraph.saveReason, {
      userId: ctx.readerId,
      pair: context.pair,
      fingerprint: context.fingerprint,
      reason,
      model: modelId,
    });
    return { source: "generated", reason, cached: false };
  },
});
