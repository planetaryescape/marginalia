import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Where the reader stands with an article, from their own interactions. */
export async function readStatus(
  ctx: QueryCtx,
  userId: string,
  articleId: Id<"articles">,
): Promise<"Finished" | "Reading" | "Up next"> {
  const did = async (action: "finished" | "opened") =>
    (await ctx.db
      .query("articleInteractions")
      .withIndex("by_user_article_action", (q) =>
        q.eq("userId", userId).eq("articleId", articleId).eq("action", action),
      )
      .first()) !== null;
  const [finished, opened] = await Promise.all([
    did("finished"),
    did("opened"),
  ]);
  return finished ? "Finished" : opened ? "Reading" : "Up next";
}
