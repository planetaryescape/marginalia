import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { getOwner } from "./access";

const setupStep = v.union(
  v.literal("not-owner"),
  v.literal("available"),
  v.literal("security"),
  v.literal("library"),
  v.literal("complete"),
);

export const availability = query({
  args: {},
  returns: v.object({ claimed: v.boolean() }),
  handler: async (ctx) => {
    const owner = await ctx.db
      .query("readerAccess")
      .withIndex("by_key", (q) => q.eq("key", "owner"))
      .unique();
    return { claimed: Boolean(owner?.authId) };
  },
});

export const prepare = internalMutation({
  args: { hash: v.string(), expiresAt: v.number() },
  returns: v.object({
    kind: v.union(v.literal("claimed"), v.literal("unclaimed")),
    url: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ kind: "claimed" | "unclaimed"; url: string }> => {
    const configured = process.env.SITE_URL;
    let site: URL;
    try {
      if (!configured) throw new Error();
      site = new URL(configured);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname);
      if (
        (site.protocol !== "https:" && !(local && site.protocol === "http:")) ||
        site.username ||
        site.password ||
        site.pathname !== "/" ||
        site.search ||
        site.hash
      )
        throw new Error();
    } catch {
      throw new ConvexError(
        "Set SITE_URL to this reader's canonical origin first.",
      );
    }
    const owner = await ctx.db
      .query("readerAccess")
      .withIndex("by_key", (q) => q.eq("key", "owner"))
      .unique();
    if (owner?.authId)
      return { kind: "claimed", url: new URL("/setup", site).href };
    const now = Date.now();
    if (
      !/^[a-f0-9]{64}$/u.test(args.hash) ||
      args.expiresAt <= now ||
      args.expiresAt > now + 15 * 60_000
    )
      throw new ConvexError("Setup links must expire within fifteen minutes.");
    await ctx.runMutation(internal.access.prepareSetup, args);
    return { kind: "unclaimed", url: new URL("/setup", site).href };
  },
});

export const status = query({
  args: {},
  returns: v.object({ step: setupStep }),
  handler: async (ctx): Promise<{ step: Infer<typeof setupStep> }> => {
    const owner = await getOwner(ctx);
    if (!owner) return { step: "not-owner" };
    return { step: owner.onboarding?.step ?? "available" };
  },
});

export const begin = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const owner = await getOwner(ctx);
    if (!owner) throw new ConvexError("Only the reader owner can run setup.");
    if (!owner.onboarding)
      await ctx.db.patch(owner._id, { onboarding: { step: "security" } });
    return null;
  },
});

export const reviewSecurity = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const owner = await getOwner(ctx);
    if (!owner) throw new ConvexError("Only the reader owner can run setup.");
    if (owner.onboarding?.step === "complete") return null;
    await ctx.db.patch(owner._id, { onboarding: { step: "library" } });
    return null;
  },
});

export const finish = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const owner = await getOwner(ctx);
    if (!owner) throw new ConvexError("Only the reader owner can run setup.");
    if (owner.onboarding?.step === "complete") return null;
    if (owner.onboarding?.step !== "library")
      throw new ConvexError(
        "Review your sign-in options before finishing setup.",
      );
    await ctx.db.patch(owner._id, {
      onboarding: { step: "complete", completedAt: Date.now() },
    });
    return null;
  },
});
