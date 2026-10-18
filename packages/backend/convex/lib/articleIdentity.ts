import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { articleUrlVariants, normalizeArticleUrl } from "./articleUrl";
import { sha256Hex } from "./tokens";

async function keysFor(guid: string | undefined, url: string) {
  const keys = [
    ...new Set([
      ...(guid ? [`guid:${guid}`] : []),
      ...(url.trim() ? [`url:${normalizeArticleUrl(url) ?? url.trim()}`] : []),
    ]),
  ];
  // Fixed-size indexed keys keep bounded cleanup byte-safe even when a source
  // sends an exceptionally long URL or GUID. The namespace is inside the hash.
  return Promise.all(keys.map(sha256Hex));
}

/** Bounded indexed probes, shared by readers and transactional import writers. */
export async function findImportArticle(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  url: string,
  guid?: string,
): Promise<Doc<"articles"> | null> {
  for (const key of await keysFor(guid, url)) {
    const alias = await ctx.db
      .query("articleImportKeys")
      .withIndex("by_userId_and_key", (q) =>
        q.eq("userId", userId).eq("key", key),
      )
      .unique();
    const article = alias && (await ctx.db.get("articles", alias.articleId));
    if (article && article.userId === userId) return article;
  }
  if (guid) {
    const article = await ctx.db
      .query("articles")
      .withIndex("by_user_guid", (q) => q.eq("userId", userId).eq("guid", guid))
      .first();
    if (article) return article;
  }
  for (const variant of url.trim() ? articleUrlVariants(url) : []) {
    const byUrl = await ctx.db
      .query("articles")
      .withIndex("by_user_url", (q) =>
        q.eq("userId", userId).eq("url", variant),
      )
      .first();
    if (byUrl) return byUrl;
    const byGuid = await ctx.db
      .query("articles")
      .withIndex("by_user_guid", (q) =>
        q.eq("userId", userId).eq("guid", variant),
      )
      .first();
    if (byGuid) return byGuid;
  }
  return null;
}

/** Aliases preserve each source's ID without replacing the article's original GUID. */
export async function rememberImportIdentity(
  ctx: MutationCtx,
  article: Doc<"articles">,
  guid: string,
  url: string,
) {
  for (const key of await keysFor(guid, url)) {
    const existing = await ctx.db
      .query("articleImportKeys")
      .withIndex("by_userId_and_key", (q) =>
        q.eq("userId", article.userId).eq("key", key),
      )
      .unique();
    if (existing) {
      const target = await ctx.db.get("articles", existing.articleId);
      if (target?.userId === article.userId && target._id !== article._id)
        throw new Error("Import identity already belongs to another article");
      await ctx.db.patch(existing._id, { articleId: article._id });
    } else {
      await ctx.db.insert("articleImportKeys", {
        userId: article.userId,
        key,
        articleId: article._id,
      });
    }
  }
}
