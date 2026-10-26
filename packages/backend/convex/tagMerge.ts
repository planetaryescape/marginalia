import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { libraryIsActive } from "./access";
import { internalMutation, mutation, type QueryCtx, query } from "./functions";
import {
  cosine,
  normaliseTag,
  TAG_MERGE_SIMILARITY,
  TAG_NEAR_SIMILARITY,
} from "./lib/tagMatching";

// Active tags compared. Each row carries a 1536-number embedding (about 15 KB)
// and the pairs are compared in one transaction, so the vocabulary the
// suggestion looks at is bounded; D-DES-059 keeps real vocabularies well below it.
export const MERGE_TAGS = 150;
/** Suggestions kept at a time; the strongest first. */
export const MAX_SUGGESTIONS = 10;
// Links moved per transaction
export const LINK_BATCH = 50;

/** The same pair whichever tag is named first. */
export function pairSubject(a: Id<"tags">, b: Id<"tags">): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

type Found = {
  into: Id<"tags">;
  from: Id<"tags">;
  similarity: number;
  strength: "strong" | "suggested";
};

/**
 * Pairs of active tags that look like one topic, strongest first. Names are
 * normalised first (S9): a tag whose normalised name is another's, or one of
 * its aliases, is the same topic outright; otherwise embeddings decide, at
 * 0.90 for a strong suggestion and 0.80 for a suggestion. The tag more
 * articles carry is the one kept. A tag appears in at most one pair.
 */
export function findMergePairs(tags: Doc<"tags">[]): Found[] {
  const names = tags.map(
    (t) => new Set([t.key, normaliseTag(t.name), ...t.aliases]),
  );
  const pairs: (Found & { a: number; b: number })[] = [];
  for (let i = 0; i < tags.length; i++)
    for (let j = i + 1; j < tags.length; j++) {
      const a = tags[i];
      const b = tags[j];
      const sameName = [...names[i]].some((n) => n && names[j].has(n));
      const similarity = sameName
        ? 1
        : a.embedding && b.embedding
          ? cosine(a.embedding, b.embedding)
          : 0;
      if (similarity < TAG_NEAR_SIMILARITY) continue;
      const [into, from] =
        a.count > b.count || (a.count === b.count && a.key < b.key)
          ? [a, b]
          : [b, a];
      pairs.push({
        a: i,
        b: j,
        into: into._id,
        from: from._id,
        similarity,
        strength: similarity >= TAG_MERGE_SIMILARITY ? "strong" : "suggested",
      });
    }
  pairs.sort(
    (x, y) =>
      y.similarity - x.similarity ||
      pairSubject(x.into, x.from).localeCompare(pairSubject(y.into, y.from)),
  );
  const used = new Set<number>();
  const out: Found[] = [];
  for (const p of pairs) {
    if (used.has(p.a) || used.has(p.b)) continue;
    used.add(p.a);
    used.add(p.b);
    out.push({
      into: p.into,
      from: p.from,
      similarity: p.similarity,
      strength: p.strength,
    });
  }
  return out;
}

async function keptPair(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  a: Id<"tags">,
  b: Id<"tags">,
) {
  return ctx.db
    .query("suggestionKeeps")
    .withIndex("by_user_kind_subject", (q) =>
      q
        .eq("userId", userId)
        .eq("kind", "tagPair")
        .eq("subject", pairSubject(a, b)),
    )
    .first();
}

/**
 * Recomputes one reader's suggestions. Pairs the reader kept are never
 * suggested again; a suggestion whose tags changed is dropped; a merge in
 * progress is left alone. Nothing here changes a tag or a link.
 */
export const compute = internalMutation({
  args: { userId: v.string() },
  returns: v.number(),
  handler: async (ctx, { userId }) => {
    if (!(await libraryIsActive(ctx, userId))) return 0;
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "active"),
      )
      .take(MERGE_TAGS);
    const existing = await ctx.db
      .query("tagMergeSuggestions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(MAX_SUGGESTIONS * 3);
    const merging = existing.filter((s) => s.merging);
    const busy = new Set(merging.flatMap((s) => [s.into, s.from]));

    const wanted: Found[] = [];
    for (const pair of findMergePairs(tags.filter((t) => !busy.has(t._id)))) {
      if (wanted.length + merging.length >= MAX_SUGGESTIONS) break;
      if (await keptPair(ctx, userId, pair.into, pair.from)) continue;
      wanted.push(pair);
    }
    const subjects = new Set(wanted.map((p) => pairSubject(p.into, p.from)));
    const have = new Set<string>();
    for (const row of existing) {
      if (row.merging) continue;
      const subject = pairSubject(row.into, row.from);
      if (subjects.has(subject) && !have.has(subject)) have.add(subject);
      else await ctx.db.delete("tagMergeSuggestions", row._id);
    }
    const now = Date.now();
    for (const pair of wanted)
      if (!have.has(pairSubject(pair.into, pair.from)))
        await ctx.db.insert("tagMergeSuggestions", {
          userId,
          ...pair,
          createdAt: now,
        });
    return wanted.length;
  },
});

/** Suggestions for Your reading, with the names to show. */
export const pending = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("tagMergeSuggestions")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .take(MAX_SUGGESTIONS);
    const out: {
      suggestionId: Id<"tagMergeSuggestions">;
      into: string;
      from: string;
      strong: boolean;
      merging: boolean;
    }[] = [];
    for (const row of rows) {
      const [into, from] = await Promise.all([
        ctx.db.get("tags", row.into),
        ctx.db.get("tags", row.from),
      ]);
      if (
        into?.userId !== ctx.readerId ||
        from?.userId !== ctx.readerId ||
        into.status !== "active" ||
        from.status !== "active"
      )
        continue;
      out.push({
        suggestionId: row._id,
        into: into.name,
        from: from.name,
        strong: row.strength === "strong",
        merging: row.merging === true,
      });
    }
    return out;
  },
});

async function ownSuggestion(
  ctx: QueryCtx & { readerId: string },
  id: Id<"tagMergeSuggestions">,
) {
  const row = await ctx.db.get("tagMergeSuggestions", id);
  return row?.userId === ctx.readerId ? row : null;
}

/** Starts the merge the reader accepted. The links move in the background, a batch at a time. */
export const accept = mutation({
  args: { suggestionId: v.id("tagMergeSuggestions") },
  returns: v.null(),
  handler: async (ctx, { suggestionId }) => {
    const row = await ownSuggestion(ctx, suggestionId);
    if (!row) return null;
    if (!(await libraryIsActive(ctx, ctx.readerId))) return null;
    if (!row.merging)
      await ctx.db.patch("tagMergeSuggestions", row._id, { merging: true });
    // Pressed again while a merge is running, or after it stalled: the batch
    // below is idempotent, so starting another is safe
    await ctx.scheduler.runAfter(0, internal.tagMerge.moveLinks, {
      userId: ctx.readerId,
      suggestionId,
    });
    return null;
  },
});

/** The reader keeps both tags; the pair is never suggested again. */
export const keepBoth = mutation({
  args: { suggestionId: v.id("tagMergeSuggestions") },
  returns: v.null(),
  handler: async (ctx, { suggestionId }) => {
    const row = await ownSuggestion(ctx, suggestionId);
    if (!row || row.merging) return null;
    if (!(await libraryIsActive(ctx, ctx.readerId))) return null;
    if (!(await keptPair(ctx, ctx.readerId, row.into, row.from)))
      await ctx.db.insert("suggestionKeeps", {
        userId: ctx.readerId,
        kind: "tagPair",
        subject: pairSubject(row.into, row.from),
        createdAt: Date.now(),
      });
    await ctx.db.delete("tagMergeSuggestions", row._id);
    return null;
  },
});

/**
 * Moves one batch of the merged tag's article links onto the kept tag. An
 * article already carrying both just loses the duplicate link. When the last
 * batch is moved, in the same transaction, the kept tag takes the other's
 * names as aliases and the other is removed, so a tag proposed under the old
 * name from then on lands on the kept one.
 */
export const moveLinks = internalMutation({
  args: { userId: v.string(), suggestionId: v.id("tagMergeSuggestions") },
  returns: v.null(),
  handler: async (ctx, { userId, suggestionId }) => {
    const sug = await ctx.db.get("tagMergeSuggestions", suggestionId);
    if (sug?.userId !== userId || !sug.merging) return null;
    if (!(await libraryIsActive(ctx, userId))) return null;
    const [into, from] = await Promise.all([
      ctx.db.get("tags", sug.into),
      ctx.db.get("tags", sug.from),
    ]);
    if (into?.userId !== userId || from?.userId !== userId) {
      await ctx.db.delete("tagMergeSuggestions", sug._id);
      return null;
    }
    const links = await ctx.db
      .query("articleTags")
      .withIndex("by_tag", (q) => q.eq("tagId", from._id))
      .take(LINK_BATCH);
    let moved = 0;
    for (const link of links) {
      const duplicate = await ctx.db
        .query("articleTags")
        .withIndex("by_article_tag", (q) =>
          q.eq("articleId", link.articleId).eq("tagId", into._id),
        )
        .first();
      if (duplicate) await ctx.db.delete("articleTags", link._id);
      else {
        await ctx.db.patch("articleTags", link._id, { tagId: into._id });
        moved++;
      }
    }
    await ctx.db.patch("tags", into._id, { count: into.count + moved });
    await ctx.db.patch("tags", from._id, {
      count: Math.max(0, from.count - links.length),
    });
    if (links.length === LINK_BATCH) {
      await ctx.scheduler.runAfter(0, internal.tagMerge.moveLinks, {
        userId,
        suggestionId,
      });
      return null;
    }

    await ctx.scheduler.runAfter(0, internal.tagMerge.finishMerge, {
      userId,
      suggestionId,
    });
    return null;
  },
});

// Candidate tags read per transaction while their nearest-tag references move.
// Each carries an embedding (about 15 KB).
export const REDIRECT_BATCH = 30;

/**
 * Last phase of a merge. First points every candidate whose nearest tag was
 * the merged one at the kept tag, a batch at a time (a candidate may link its
 * nearest tag later, and a dangling ID would drop that link). Then, in one
 * transaction that also checks no link to the merged tag is left, the kept tag
 * takes the other's names as aliases and the other is removed, so a tag
 * proposed under the old name from then on lands on the kept one.
 */
export const finishMerge = internalMutation({
  args: {
    userId: v.string(),
    suggestionId: v.id("tagMergeSuggestions"),
    cursor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { userId, suggestionId, cursor }) => {
    const sug = await ctx.db.get("tagMergeSuggestions", suggestionId);
    if (sug?.userId !== userId || !sug.merging) return null;
    if (!(await libraryIsActive(ctx, userId))) return null;
    const [into, from] = await Promise.all([
      ctx.db.get("tags", sug.into),
      ctx.db.get("tags", sug.from),
    ]);
    if (into?.userId !== userId || from?.userId !== userId) {
      await ctx.db.delete("tagMergeSuggestions", sug._id);
      return null;
    }
    const page = await ctx.db
      .query("tags")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "candidate"),
      )
      .paginate({ numItems: REDIRECT_BATCH, cursor: cursor ?? null });
    for (const candidate of page.page)
      if (candidate.nearestTagId === from._id)
        await ctx.db.patch("tags", candidate._id, { nearestTagId: into._id });
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.tagMerge.finishMerge, {
        userId,
        suggestionId,
        cursor: page.continueCursor,
      });
      return null;
    }

    // A link added while the candidates were being walked: move it first
    const straggler = await ctx.db
      .query("articleTags")
      .withIndex("by_tag", (q) => q.eq("tagId", from._id))
      .first();
    if (straggler) {
      await ctx.scheduler.runAfter(0, internal.tagMerge.moveLinks, {
        userId,
        suggestionId,
      });
      return null;
    }
    const aliases = new Set([...into.aliases, from.key, ...from.aliases]);
    aliases.delete(into.key);
    await ctx.db.patch("tags", into._id, { aliases: [...aliases] });
    await ctx.db.delete("tags", from._id);
    // Any other suggestion that named the removed tag is out of date
    const rows = await ctx.db
      .query("tagMergeSuggestions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(MAX_SUGGESTIONS * 3);
    for (const row of rows)
      if (row.into === from._id || row.from === from._id)
        await ctx.db.delete("tagMergeSuggestions", row._id);
    return null;
  },
});
