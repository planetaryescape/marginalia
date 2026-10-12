import { ConvexError, v } from "convex/values";
import { revokeSessions } from "./access";
import { ownerMutation, ownerQuery } from "./functions";

const status = v.union(v.literal("active"), v.literal("disabled"));

/** Readers other than the owner, newest first. */
export const list = ownerQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("readers"),
      email: v.string(),
      name: v.string(),
      status,
      deleting: v.boolean(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query("readers").order("desc").take(100);
    return rows.map((row) => ({
      _id: row._id,
      email: row.email ?? "",
      name: row.name ?? "",
      status: row.status,
      deleting: row.deletingAt !== undefined,
      createdAt: row.createdAt,
    }));
  },
});

/** Disabling takes effect on the reader's next request and signs them out everywhere. */
export const setStatus = ownerMutation({
  args: { readerId: v.id("readers"), status },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reader = await ctx.db.get("readers", args.readerId);
    if (!reader) throw new ConvexError("That reader no longer exists.");
    if (reader.deletingAt)
      throw new ConvexError("This reader is deleting their account.");
    await ctx.db.patch("readers", reader._id, { status: args.status });
    if (args.status === "disabled") await revokeSessions(ctx, reader.authId);
    return null;
  },
});
