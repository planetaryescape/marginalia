import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./functions";
import { parseBibleReference } from "./lib/bible";
import { sharedBibleCache } from "./lib/bibleResourceCache";
import {
  fetchYouVersionComparison,
  validateYouVersionReading,
} from "./lib/youversion";

// Text delivery needs fetch, not Node or the AI SDK. Keeping this in Convex's
// default runtime avoids a cross-runtime round trip for every cache/lease call.
export const readComparison = action({
  args: {
    reference: v.string(),
    versionIds: v.array(v.number()),
    displayToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ref = parseBibleReference(args.reference);
    if (!ref)
      throw new Error("Use a reference such as John 3:16-21 or Romans 8.");
    validateYouVersionReading(ref, args.versionIds);
    if (
      args.displayToken !== undefined &&
      !/^[0-9a-f-]{36}$/i.test(args.displayToken)
    )
      throw new Error("Invalid Bible display request.");
    const token = args.displayToken ?? crypto.randomUUID();
    // Opt-in, connection, rate limit and lease acquisition share one transaction.
    await ctx.runMutation(internal.bible.activateLicensedReading, {
      userId: ctx.readerId,
      token,
      spendRequest: true,
    });
    const passage = await fetchYouVersionComparison(
      ref,
      args.versionIds,
      sharedBibleCache(ctx),
    );
    // Never publish a response after opt-out or after a newer display won.
    await ctx.runMutation(internal.bible.activateLicensedReading, {
      userId: ctx.readerId,
      token,
      onlyIfCurrent: true,
    });
    return { ...passage, token };
  },
});
