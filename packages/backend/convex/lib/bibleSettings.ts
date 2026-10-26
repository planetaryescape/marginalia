import type { QueryCtx } from "../_generated/server";
import type { ReadingScope } from "./bible";

export async function biblePreferences(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
) {
  const row = await ctx.db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const enabled = row?.bibleEnabled === true;
  const scope: ReadingScope = enabled
    ? (row?.readingScope ?? "articles")
    : "articles";
  return { enabled, translation: row?.bibleTranslation ?? "web", scope };
}

export async function requireBible(ctx: Pick<QueryCtx, "db">, userId: string) {
  const prefs = await biblePreferences(ctx, userId);
  if (!prefs.enabled)
    throw new Error("Enable Bible reading in Your account first.");
  return prefs;
}
