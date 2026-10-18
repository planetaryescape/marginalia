import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../functions";

/** The key is a correlation token, never authorization: every lookup is reader-scoped. */
export async function ensureReadingSession(
  ctx: MutationCtx,
  userId: string,
  key: string,
  requestedMinutes: number,
) {
  if (
    !/^[\da-f-]{36}$/i.test(key) ||
    !Number.isFinite(requestedMinutes) ||
    requestedMinutes <= 0 ||
    requestedMinutes > 1440
  )
    throw new Error("Invalid reading session");
  const old = await ctx.db
    .query("sessions")
    .withIndex("by_userId_and_clientKey", (q) =>
      q.eq("userId", userId).eq("clientKey", key),
    )
    .unique();
  if (old) {
    if (old.requestedMinutes !== requestedMinutes)
      throw new Error("Session time changed");
    return old._id;
  }
  const id: Id<"sessions"> = await ctx.db.insert("sessions", {
    userId,
    clientKey: key,
    requestedMinutes,
    startedAt: Date.now(),
    readingStatus: "selecting",
  });
  return id;
}
