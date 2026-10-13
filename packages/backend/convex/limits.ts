import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  type ActionCtx,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";

/** Per-reader fixed-window budgets, so one reader can't run up costs or spam checks. */
export const READER_LIMITS = {
  ai: {
    max: 30,
    windowMs: 60_000,
    message:
      "You're sending requests faster than this reader allows. Wait a minute and try again.",
  },
  providerKeySave: {
    max: 10,
    windowMs: 60 * 60_000,
    message: "Too many key changes in the last hour. Try again later.",
  },
  readwiseConnect: {
    max: 10,
    windowMs: 60 * 60_000,
    message:
      "Too many attempts to connect Readwise in the last hour. Try again later.",
  },
  chatgptConnect: {
    max: 10,
    windowMs: 60 * 60_000,
    message:
      "Too many attempts to connect ChatGPT in the last hour. Try again later.",
  },
} as const;

export type LimitBucket = keyof typeof READER_LIMITS;

const bucket = v.union(
  v.literal("ai"),
  v.literal("providerKeySave"),
  v.literal("readwiseConnect"),
  v.literal("chatgptConnect"),
);

/** Spends one request from the reader's bucket; false when it's used up. */
export async function spendReaderLimit(
  ctx: MutationCtx,
  userId: string,
  name: LimitBucket,
): Promise<boolean> {
  const { max, windowMs } = READER_LIMITS[name];
  const now = Date.now();
  const row = await ctx.db
    .query("readerLimits")
    .withIndex("by_userId_and_bucket", (q) =>
      q.eq("userId", userId).eq("bucket", name),
    )
    .unique();
  if (!row) {
    await ctx.db.insert("readerLimits", {
      userId,
      bucket: name,
      startedAt: now,
      count: 1,
    });
    return true;
  }
  if (now - row.startedAt >= windowMs) {
    await ctx.db.patch("readerLimits", row._id, { startedAt: now, count: 1 });
    return true;
  }
  if (row.count >= max) return false;
  await ctx.db.patch("readerLimits", row._id, { count: row.count + 1 });
  return true;
}

export const spend = internalMutation({
  args: { userId: v.string(), bucket },
  returns: v.boolean(),
  handler: (ctx, args) => spendReaderLimit(ctx, args.userId, args.bucket),
});

/** For actions: throws the bucket's reader-facing message when it's used up. */
export async function requireReaderLimit(
  ctx: Pick<ActionCtx, "runMutation">,
  userId: string,
  name: LimitBucket,
): Promise<void> {
  const allowed: boolean = await ctx.runMutation(internal.limits.spend, {
    userId,
    bucket: name,
  });
  if (!allowed) throw new ConvexError(READER_LIMITS[name].message);
}
