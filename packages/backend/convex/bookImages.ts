import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { liveImport } from "./documentImports";
import { internalMutation, type MutationCtx } from "./functions";

export const DISCARD_IMAGES_BATCH_SIZE = 50;

export const register = internalMutation({
  args: {
    importId: v.id("documentImports"),
    articleId: v.id("articles"),
    storageId: v.id("_storage"),
    href: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await liveImport(ctx, args.importId);
    const article = await ctx.db.get(args.articleId);
    if (
      !row ||
      row.partialArticleId !== args.articleId ||
      article?.userId !== row.userId ||
      article.extractionStatus !== "pending"
    )
      return null;
    const existing = await ctx.db
      .query("bookImages")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .first();
    const upload = await ctx.db
      .query("documentImports")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .first();
    const file = await ctx.db.system.get(args.storageId);
    if (
      existing ||
      upload ||
      !file ||
      (file.contentType !== undefined &&
        !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
          file.contentType,
        ))
    )
      return null;
    await ctx.db.insert("bookImages", {
      userId: row.userId,
      articleId: args.articleId,
      storageId: args.storageId,
      href: args.href,
    });
    return ctx.storage.getUrl(args.storageId);
  },
});

export async function discardImages(
  ctx: MutationCtx,
  userId: string,
  articleId?: Id<"articles">,
) {
  const images = await ctx.db
    .query("bookImages")
    .withIndex("by_userId_and_articleId", (q) =>
      articleId === undefined
        ? q.eq("userId", userId)
        : q.eq("userId", userId).eq("articleId", articleId),
    )
    .take(DISCARD_IMAGES_BATCH_SIZE);
  for (const image of images) {
    if (await ctx.db.system.get(image.storageId))
      await ctx.storage.delete(image.storageId);
    await ctx.db.delete(image._id);
  }
  return images.length;
}

export async function purgeImages(ctx: MutationCtx, userId: string) {
  return discardImages(ctx, userId);
}

export const discard = internalMutation({
  args: { userId: v.string(), articleId: v.id("articles") },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.articleId)) return;
    const count = await discardImages(ctx, args.userId, args.articleId);
    if (count === DISCARD_IMAGES_BATCH_SIZE)
      await ctx.scheduler.runAfter(0, internal.bookImages.discard, args);
  },
});
