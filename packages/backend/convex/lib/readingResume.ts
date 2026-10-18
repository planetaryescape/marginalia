import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  articleProjection,
  metadataReady,
  readLegacyDocument,
} from "./articleMetadata";
import { metadataLibraryActive } from "./shelfCounts";

export function resumeState(ctx: Pick<QueryCtx, "db">, userId: string) {
  return ctx.db
    .query("readingResumeState")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

// No deferred URL resolution: Continue needs only identity/title/minutes/state.
export async function resumeArticle(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  articleId: Id<"articles">,
) {
  const card = await ctx.db
    .query("articleMetadata")
    .withIndex("by_articleId", (q) => q.eq("articleId", articleId))
    .unique();
  if (card) return card.userId === userId ? card : null;
  if (await metadataReady(ctx, userId)) return null;
  const source = await readLegacyDocument(ctx, () => ctx.db.get(articleId));
  return source?.userId === userId ? articleProjection(source) : null;
}

function eligible(
  article: { finishedAt?: number; bookUnitCount?: number },
  percent: number,
) {
  return (
    article.finishedAt === undefined &&
    (article.bookUnitCount !== undefined || percent < 90)
  );
}

export async function initializeEmptyResume(ctx: MutationCtx, userId: string) {
  if (
    !(await metadataLibraryActive(ctx, userId)) ||
    (await resumeState(ctx, userId))
  )
    return;
  const activity = await ctx.db
    .query("readingActivity")
    .withIndex("by_user_started", (q) => q.eq("userId", userId))
    .first();
  if (activity) return;
  const interaction = await ctx.db
    .query("articleInteractions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (!interaction)
    await ctx.db.insert("readingResumeState", {
      userId,
      phase: "done",
      cursor: null,
    });
}

/** Called only with an owned source and the validated, persisted cumulative merge.
 * Progress is a max across visits/days; later visits win equal-progress paragraph
 * ties, then visit/day identity and paragraph break exact timestamp ties.
 * Legacy interaction percentages never override checkpoints. */
export async function mergeResume(
  ctx: MutationCtx,
  article: { userId: string; finishedAt?: number; bookUnitCount?: number },
  next: {
    articleId: Id<"articles">;
    updatedAt: number;
    maxScrollPercent: number;
    paragraphIndex?: number;
    visitId?: string;
    day?: string;
  },
  checkpoint: boolean,
) {
  if (!(await metadataLibraryActive(ctx, article.userId))) return;
  const old = await ctx.db
    .query("readingResumes")
    .withIndex("by_userId_and_articleId", (q) =>
      q.eq("userId", article.userId).eq("articleId", next.articleId),
    )
    .unique();
  const incoming = Number.isFinite(next.maxScrollPercent)
    ? Math.max(0, Math.min(100, next.maxScrollPercent))
    : 0;
  const resetLegacy = checkpoint && !old?.hasCheckpoint;
  const useProgress = checkpoint || !old?.hasCheckpoint;
  const previous = resetLegacy ? 0 : (old?.maxScrollPercent ?? 0);
  const percent = useProgress ? Math.max(previous, incoming) : previous;
  const placeKey = `${next.visitId?.slice(0, 100) ?? ""}:${next.day?.slice(0, 10) ?? ""}`;
  const samePlace =
    next.updatedAt === old?.placeUpdatedAt && placeKey === old?.placeKey;
  const usePlace =
    useProgress &&
    (resetLegacy ||
      incoming > previous ||
      (incoming === previous &&
        next.paragraphIndex !== undefined &&
        (old?.paragraphIndex === undefined ||
          next.updatedAt > old.placeUpdatedAt ||
          (next.updatedAt === old.placeUpdatedAt &&
            placeKey >= old.placeKey))));
  const paragraphIndex = usePlace
    ? samePlace &&
      incoming === previous &&
      old?.paragraphIndex !== undefined &&
      next.paragraphIndex !== undefined
      ? Math.max(old.paragraphIndex, next.paragraphIndex)
      : next.paragraphIndex
    : old?.paragraphIndex;
  const fields = {
    userId: article.userId,
    articleId: next.articleId,
    eligible: eligible(article, percent),
    lastActivityAt: Math.max(old?.lastActivityAt ?? 0, next.updatedAt),
    maxScrollPercent: percent,
    paragraphIndex,
    placeUpdatedAt: usePlace ? next.updatedAt : (old?.placeUpdatedAt ?? 0),
    placeKey: usePlace ? placeKey : (old?.placeKey ?? ""),
    hasCheckpoint: checkpoint || old?.hasCheckpoint || false,
  };
  if (old) await ctx.db.patch(old._id, fields);
  else await ctx.db.insert("readingResumes", fields);
}

/** The article remains authoritative on finish/reopen/removal, including delayed saves. */
export async function syncResumeEligibility(
  ctx: MutationCtx,
  before: Doc<"articles"> | null,
  after: Doc<"articles"> | null,
) {
  if (
    !before ||
    (after &&
      before.userId === after.userId &&
      before.finishedAt === after.finishedAt &&
      before.bookUnitCount === after.bookUnitCount)
  )
    return;
  const row = await ctx.db
    .query("readingResumes")
    .withIndex("by_userId_and_articleId", (q) =>
      q.eq("userId", before.userId).eq("articleId", before._id),
    )
    .unique();
  if (!row) return;
  if (!after || after.userId !== before.userId) await ctx.db.delete(row._id);
  else
    await ctx.db.patch(row._id, {
      eligible: eligible(after, row.maxScrollPercent),
    });
}
