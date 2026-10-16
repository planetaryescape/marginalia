import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ownedArticle, requireArticle } from "./access";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  query,
} from "./functions";
import {
  isTopicKey,
  MAX_TAGS_PER_ARTICLE,
  MAX_VOCABULARY_IN_PROMPT,
  matchTag,
  normaliseTag,
  TAG_PROMOTE_AFTER,
  tagDisplayName,
} from "./lib/tagMatching";

/** Active tags on an article, for the pencil chips under its title. */
export const forArticle = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId))) return [];
    const links = await ctx.db
      .query("articleTags")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .take(20);
    const tags = await Promise.all(links.map((link) => ctx.db.get(link.tagId)));
    return tags
      .filter(
        (tag): tag is Doc<"tags"> =>
          tag?.userId === ctx.readerId && tag.status === "active",
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tag) => ({ _id: tag._id, name: tag.name }));
  },
});

/** The vocabulary the model chooses from: active tags, most used first. */
export const vocabulary = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const active = await ctx.db
      .query("tags")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "active"),
      )
      .collect();
    return active
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .slice(0, MAX_VOCABULARY_IN_PROMPT)
      .map((tag) => ({
        name: tag.name,
        key: tag.key,
        aliases: tag.aliases,
      }));
  },
});

/** Removes an article's tag links and the counts they added. */
export async function unlinkArticleTags(
  ctx: MutationCtx,
  articleId: Id<"articles">,
) {
  const links = await ctx.db
    .query("articleTags")
    .withIndex("by_article", (q) => q.eq("articleId", articleId))
    .collect();
  for (const link of links) {
    await ctx.db.delete(link._id);
    const tag = await ctx.db.get(link.tagId);
    if (tag)
      await ctx.db.patch("tags", tag._id, {
        count: Math.max(0, tag.count - 1),
      });
  }
}

/**
 * Gives an article its tags, replacing any it had. Each proposal is matched
 * against the reader's vocabulary (lib/tagMatching.ts) inside one transaction,
 * so two imports proposing the same new tag see each other's rows and counts
 * are never read stale.
 */
export const assign = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    proposals: v.array(
      v.object({
        name: v.string(),
        description: v.optional(v.string()),
        // Of name plus description; absent when the library can't embed
        embedding: v.optional(v.array(v.float64())),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireArticle(ctx, args.articleId, args.userId);
    await unlinkArticleTags(ctx, args.articleId);

    const known = await ctx.db
      .query("tags")
      .withIndex("by_user_key", (q) => q.eq("userId", args.userId))
      .collect();
    const linked = new Set<Id<"tags">>();
    const now = Date.now();

    const link = async (tagId: Id<"tags">) => {
      if (linked.has(tagId) || linked.size >= MAX_TAGS_PER_ARTICLE) return;
      const tag = known.find((t) => t._id === tagId);
      if (!tag) return;
      await ctx.db.insert("articleTags", {
        userId: args.userId,
        articleId: args.articleId,
        tagId,
        createdAt: now,
      });
      linked.add(tagId);
      tag.count += 1;
      const promote =
        tag.status === "candidate" && tag.count >= TAG_PROMOTE_AFTER;
      if (promote) tag.status = "active";
      await ctx.db.patch("tags", tagId, {
        count: tag.count,
        status: tag.status,
      });
    };

    for (const proposal of args.proposals) {
      if (linked.size >= MAX_TAGS_PER_ARTICLE) break;
      const key = normaliseTag(proposal.name);
      if (!key) continue;
      const match = matchTag(
        { key, embedding: proposal.embedding },
        known.map((tag) => ({
          id: tag._id,
          key: tag.key,
          aliases: tag.aliases,
          embedding: tag.embedding,
        })),
      );
      if (match.kind === "skip") continue;
      if (match.kind === "existing") {
        const tag = known.find((t) => t._id === match.tagId);
        if (
          tag &&
          match.alias &&
          match.alias !== tag.key &&
          !tag.aliases.includes(match.alias)
        ) {
          tag.aliases = [...tag.aliases, match.alias];
          await ctx.db.patch("tags", tag._id, { aliases: tag.aliases });
        }
        await link(match.tagId);
        // A candidate waiting for promotion keeps its nearest visible tag
        if (tag?.status === "candidate" && tag.nearestTagId) {
          if (known.some((t) => t._id === tag.nearestTagId))
            await link(tag.nearestTagId);
          else {
            // That tag was merged away: find where its name went (an alias
            // of the kept tag, or the closest by embedding) and point there
            const moved = matchTag(
              { key: tag.key, embedding: tag.embedding },
              known
                .filter((t) => t._id !== tag._id)
                .map((t) => ({
                  id: t._id,
                  key: t.key,
                  aliases: t.aliases,
                  embedding: t.embedding,
                })),
            );
            const nearest =
              moved.kind === "existing"
                ? moved.tagId
                : moved.kind === "candidate"
                  ? moved.nearestTagId
                  : undefined;
            tag.nearestTagId = nearest;
            await ctx.db.patch("tags", tag._id, { nearestTagId: nearest });
            if (nearest) await link(nearest);
          }
        }
        continue;
      }
      const id = await ctx.db.insert("tags", {
        userId: args.userId,
        name: tagDisplayName(proposal.name) || key,
        key,
        description: proposal.description?.trim() || undefined,
        embedding: proposal.embedding,
        status: "candidate",
        count: 0,
        aliases: [],
        nearestTagId: match.nearestTagId,
        createdAt: now,
      });
      const created = await ctx.db.get("tags", id);
      if (created) known.push(created);
      await link(id);
      // A near miss also takes its nearest tag, so the article is findable meanwhile
      if (match.nearestTagId) await link(match.nearestTagId);
    }
    return [...linked];
  },
});

const SEED_PAGE = 50;

/**
 * Seeds the vocabulary from the reader's vault tags (`noteChunks.tags`), as
 * active tags named their way: last path segment, lowercased, punctuation
 * stripped, singularised, folder-like roots dropped (S9). Re-running only adds
 * what is missing. Pages through the chunks (each holds a 1536-number vector)
 * and, when the last page is done, schedules the embedding of the new tags.
 *
 *   bunx convex run tags:seedFromVault '{"userId":"default_user"}'
 */
export const seedFromVault = internalMutation({
  args: {
    userId: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("noteChunks")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .paginate({ numItems: SEED_PAGE, cursor: args.cursor ?? null });

    const names = new Map<string, string>();
    for (const chunk of page.page)
      for (const raw of chunk.tags ?? []) {
        const key = normaliseTag(raw);
        if (!isTopicKey(key) || names.has(key)) continue;
        names.set(key, tagDisplayName(raw) || key);
      }

    let added = 0;
    for (const [key, name] of names) {
      const existing = await ctx.db
        .query("tags")
        .withIndex("by_user_key", (q) =>
          q.eq("userId", args.userId).eq("key", key),
        )
        .first();
      if (existing) continue;
      await ctx.db.insert("tags", {
        userId: args.userId,
        name,
        key,
        status: "active",
        count: 0,
        aliases: [],
        createdAt: Date.now(),
      });
      added++;
    }

    if (page.isDone)
      await ctx.scheduler.runAfter(0, internal.actions.embedTags.embedMissing, {
        userId: args.userId,
      });
    else
      await ctx.scheduler.runAfter(0, internal.tags.seedFromVault, {
        userId: args.userId,
        cursor: page.continueCursor,
      });
    return { added, done: page.isDone };
  },
});

const EMBED_BATCH = 50;

/** Tags still without an embedding, for the embedding action. */
export const missingEmbeddings = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_user_key", (q) => q.eq("userId", args.userId))
      .collect();
    return tags
      .filter((tag) => !tag.embedding)
      .slice(0, EMBED_BATCH)
      .map((tag) => ({
        id: tag._id,
        text: tag.description ? `${tag.name}: ${tag.description}` : tag.name,
      }));
  },
});

export const setEmbeddings = internalMutation({
  args: {
    userId: v.string(),
    items: v.array(
      v.object({ id: v.id("tags"), embedding: v.array(v.float64()) }),
    ),
  },
  handler: async (ctx, args) => {
    for (const item of args.items) {
      const tag = await ctx.db.get("tags", item.id);
      if (tag?.userId === args.userId && !tag.embedding)
        await ctx.db.patch("tags", item.id, { embedding: item.embedding });
    }
  },
});
