// Private generated-miss admission and publication. Legacy free cache policy is
// deliberately separate from the stronger identity used for new generations.
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./functions";
import {
  currentEdge,
  EDGE_ATTEMPTS,
  EDGE_LEASE_MS,
  edgeDispatchTarget,
  edgeGeneration,
  edgeRequest,
  edgeResolvedRoutingIdentity,
  edgeState,
  edgeTargetAvailable,
  pruneEdgeClaims,
  validEdgeReason,
} from "./lib/edgeExplanations";
import { metadataLibraryActive } from "./lib/shelfCounts";

export const edgeContext = internalQuery({
  args: edgeRequest,
  handler: async (ctx, args) => currentEdge(ctx, args),
});

export const dispatchContext = internalMutation({
  args: {
    ...edgeRequest,
    generation: edgeGeneration,
    snapshot: v.string(),
    targets: v.array(edgeDispatchTarget),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db.get(args.generation.id);
    if (
      !state ||
      state.userId !== args.userId ||
      state.run !== args.generation.run ||
      state.status !== "running" ||
      state.leaseUntil <= Date.now()
    )
      return null;
    const context = await currentEdge(ctx, args);
    if (
      !context ||
      context.input !== state.input ||
      args.snapshot !== context.routing.snapshot ||
      args.targets.length === 0 ||
      args.targets.length > 2 ||
      !args.targets.every((target) =>
        edgeTargetAvailable(target, context.routing.available),
      )
    )
      return null;
    // Stored rows describe possible providers, not which ciphertexts the router
    // can decrypt. Bind the actual key-free chain from loadReaderAI under this
    // claim, while retaining exact raw-snapshot and current-input fences.
    const dispatchRouting = await edgeResolvedRoutingIdentity(
      args.snapshot,
      args.targets,
    );
    if (state.dispatchRouting && state.dispatchRouting !== dispatchRouting)
      return null;
    await ctx.db.patch(state._id, {
      dispatchRouting,
      dispatchTargets: args.targets,
    });
    return context;
  },
});

export const claim = internalMutation({
  args: edgeRequest,
  handler: async (ctx, args) => {
    const context = await currentEdge(ctx, args);
    if (!context) throw new ConvexError("Those ideas aren't in your notes.");
    if (context.structural.length)
      return { kind: "structural" as const, reasons: context.structural };
    if (context.cached)
      return { kind: "cached" as const, reason: context.cached.reason };
    const old = await edgeState(ctx, args.userId, context.claimPair);
    if (
      old?.input === context.input &&
      old.status === "running" &&
      old.leaseUntil > Date.now()
    )
      return { kind: "join" as const };
    const attempts = old?.input === context.input ? old.attempts + 1 : 1;
    if (attempts > EDGE_ATTEMPTS)
      throw new ConvexError(
        "Edge explanation attempt limit reached. Change an idea or quick-model setup before trying again.",
      );
    const fields = {
      ...context.request,
      ...context.parents,
      pair: context.claimPair,
      input: context.input,
      routing: context.routing.identity,
      run: (old?.run ?? 0) + 1,
      status: "running" as const,
      attempts,
      leaseUntil: Date.now() + EDGE_LEASE_MS,
    };
    const id = old
      ? old._id
      : await ctx.db.insert("edgeExplanationState", fields);
    if (old) await ctx.db.replace(old._id, fields);
    return {
      kind: "claimed" as const,
      generation: { id, run: fields.run },
      pair: context.pair,
      fingerprint: context.fingerprint,
      prompt: context.prompt,
      input: context.input,
      routing: context.routing.identity,
      targets: context.routing.targets,
    };
  },
});

export const settled = internalQuery({
  args: edgeRequest,
  handler: async (ctx, args) => {
    const context = await currentEdge(ctx, args);
    if (!context) return { kind: "gone" as const };
    if (context.structural.length)
      return { kind: "structural" as const, reasons: context.structural };
    if (context.cached)
      return { kind: "cached" as const, reason: context.cached.reason };
    const state = await edgeState(ctx, args.userId, context.claimPair);
    return {
      kind:
        state?.status === "running" && state.input === context.input
          ? ("waiting" as const)
          : ("failed" as const),
    };
  },
});

export const failed = internalMutation({
  args: { userId: v.string(), generation: edgeGeneration },
  handler: async (ctx, args) => {
    const state = await ctx.db.get(args.generation.id);
    if (
      state?.userId === args.userId &&
      state.run === args.generation.run &&
      state.status === "running"
    )
      await ctx.db.patch(state._id, { status: "failed" });
  },
});

export const saveReason = internalMutation({
  args: {
    userId: v.string(),
    pair: v.string(),
    fingerprint: v.string(),
    reason: v.string(),
    model: v.string(),
    generation: v.optional(edgeGeneration),
  },
  handler: async (ctx, args) => {
    // Tokenless pre-upgrade callbacks cannot overwrite an adopted pair. New
    // old-shaped action requests still obtain their own effective token.
    if (!args.generation) {
      // Ownership of tokenless output cannot be proven after the upgrade. Keep
      // its arguments callable, but throw: old binaries ignore a false save
      // result and would otherwise report an unaccepted local answer as success.
      throw new ConvexError(
        "This explanation came from an older request. Ask again to read the current reason.",
      );
    }
    if (!(await metadataLibraryActive(ctx, args.userId))) return false;
    const state = await ctx.db.get(args.generation.id);
    if (
      !state ||
      state.userId !== args.userId ||
      state._id !== args.generation.id ||
      state.run !== args.generation.run ||
      state.status !== "running" ||
      state.leaseUntil <= Date.now()
    )
      return false;
    const current = await currentEdge(ctx, state);
    if (
      !current ||
      current.structural.length ||
      current.input !== state.input ||
      current.claimPair !== state.pair ||
      current.pair !== args.pair ||
      current.fingerprint !== args.fingerprint ||
      !state.dispatchRouting ||
      !state.dispatchTargets?.some((target) => target.id === args.model) ||
      !state.dispatchTargets.every((target) =>
        edgeTargetAvailable(target, current.routing.available),
      )
    )
      return false;
    const reason = validEdgeReason(args.reason);
    if (!reason) return false;
    const existing = await ctx.db
      .query("edgeReasons")
      .withIndex("by_user_pair", (q) =>
        q.eq("userId", args.userId).eq("pair", args.pair),
      )
      .unique();
    const fields = {
      fingerprint: current.fingerprint,
      input: state.input,
      reason,
      model: args.model,
      createdAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else
      await ctx.db.insert("edgeReasons", {
        userId: args.userId,
        pair: args.pair,
        ...fields,
      });
    await ctx.db.patch(state._id, { status: "complete", attempts: 0 });
    return true;
  },
});

export const prune = internalMutation({
  args: {
    userId: v.string(),
    node: v.optional(v.string()),
    via: v.optional(v.string()),
    articleId: v.optional(v.id("articles")),
  },
  handler: async (ctx, args) => {
    if (await pruneEdgeClaims(ctx, args))
      await ctx.scheduler.runAfter(0, internal.ideaEdgeReasons.prune, args);
  },
});
