import { v } from "convex/values";
import { query } from "./functions";
import { buildGraph, type Graph } from "./ideaGraph";
import { readDiscoveryRevision } from "./lib/discoveryRevision";
import { metadataLibraryActive } from "./lib/shelfCounts";

export const current = query({
  // A session discriminator prevents accepting the old auth subscription in
  // the client session->Convex-token gap. It is NOT authority or a reader ID.
  args: { session: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (
      identity?.sessionId !== args.session ||
      !(await metadataLibraryActive(ctx, ctx.readerId))
    )
      return null;
    return readDiscoveryRevision(ctx, ctx.readerId);
  },
});

/** Graph and epoch share one transaction. A late response cannot be labelled
 * with a newer client epoch; a mismatched reservation does no graph work. */
export const graph = query({
  args: {
    session: v.string(),
    revision: v.union(v.string(), v.null()),
    centre: v.optional(v.string()),
    centreVia: v.optional(v.string()),
    similar: v.optional(
      v.array(v.object({ key: v.string(), via: v.optional(v.string()) })),
    ),
    pin: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ revision: string | null; graph: Graph | null }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (
      identity?.sessionId !== args.session ||
      !(await metadataLibraryActive(ctx, ctx.readerId))
    )
      return { revision: null, graph: null };
    const revision = await readDiscoveryRevision(ctx, ctx.readerId);
    if (revision !== args.revision) return { revision, graph: null };
    return { revision, graph: await buildGraph(ctx, ctx.readerId, args) };
  },
});
