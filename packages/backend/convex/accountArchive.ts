import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./functions";
import {
  type ArchiveItem,
  archiveItem,
  archivePreferences,
} from "./lib/accountArchive";
import {
  findImportArticle,
  rememberImportIdentity,
} from "./lib/articleIdentity";
import { DEFAULT_USER_ID } from "./lib/constants";
import { validateArticleSize } from "./lib/importContent";
import { mergeResume } from "./lib/readingResume";
import { sha256Hex } from "./lib/tokens";
import { updateQueueStats } from "./readingQueue";

const args = { expectedOrigin: v.string(), payload: v.string() };
const outcome = v.object({
  status: v.union(
    v.literal("create"),
    v.literal("merge"),
    v.literal("replayed"),
    v.literal("conflict"),
  ),
  highlightsToCreate: v.number(),
  articleId: v.union(v.id("articles"), v.null()),
});

async function assertTarget(ctx: QueryCtx, expectedOrigin: string) {
  if (process.env.SITE_URL !== expectedOrigin)
    throw new ConvexError(
      "Archive target origin does not match this deployment.",
    );
  const owner = await ctx.db
    .query("readerAccess")
    .withIndex("by_key", (q) => q.eq("key", "owner"))
    .unique();
  if (!owner?.authId)
    throw new ConvexError("Claim the destination owner first.");
}

async function inspectItem(
  ctx: QueryCtx,
  input: {
    expectedOrigin: string;
    payload: string;
  },
) {
  await assertTarget(ctx, input.expectedOrigin);
  if (new TextEncoder().encode(input.payload).length > 900_000)
    throw new ConvexError("Archive item exceeds the import byte limit.");
  const parsed = archiveItem.safeParse(JSON.parse(input.payload));
  if (!parsed.success) throw new ConvexError("Invalid archive item.");
  const item = parsed.data;
  if (item.source === input.expectedOrigin)
    throw new ConvexError(
      "Source and destination must be different installations.",
    );
  if (
    [...item.highlights, ...item.interactions].some(
      (row) =>
        row.articleId !== item.article._id ||
        row.userId !== item.article.userId,
    )
  )
    throw new ConvexError("Archive item contains unrelated records.");
  const key = await sha256Hex(
    `account-archive:v1:${item.source}:${item.archiveHash}:${item.article._id}`,
  );
  const receipt = await ctx.db
    .query("articleImportKeys")
    .withIndex("by_userId_and_key", (q) =>
      q.eq("userId", DEFAULT_USER_ID).eq("key", key),
    )
    .unique();
  const byReader = await ctx.db
    .query("articles")
    .withIndex("by_userId_and_readerDocumentId", (q) =>
      q
        .eq("userId", DEFAULT_USER_ID)
        .eq("readerDocumentId", item.article.readerDocumentId),
    )
    .unique();
  const byIdentity = await findImportArticle(
    ctx,
    DEFAULT_USER_ID,
    item.article.url,
    item.article.guid,
  );
  const sameIdentity =
    byIdentity &&
    (!byIdentity.readerDocumentId ||
      byIdentity.readerDocumentId === item.article.readerDocumentId)
      ? byIdentity
      : null;
  const existing = receipt
    ? await ctx.db.get("articles", receipt.articleId)
    : (byReader ?? sameIdentity);
  let conflict = Boolean(
    (receipt && !existing) ||
      (existing && existing.userId !== DEFAULT_USER_ID) ||
      (byIdentity &&
        byIdentity.guid === item.article.guid &&
        byIdentity.readerDocumentId &&
        byIdentity.readerDocumentId !== item.article.readerDocumentId) ||
      (byReader && sameIdentity && byReader._id !== sameIdentity._id) ||
      (existing && existing.content !== item.article.content),
  );
  const newHighlights: ArchiveItem["highlights"] = [];
  for (const highlight of item.highlights) {
    const old = await ctx.db
      .query("highlights")
      .withIndex("by_userId_and_readerHighlightId", (q) =>
        q
          .eq("userId", DEFAULT_USER_ID)
          .eq("readerHighlightId", highlight.readerHighlightId),
      )
      .unique();
    if (!old) newHighlights.push(highlight);
    else if (
      old.articleId !== existing?._id ||
      old.text !== highlight.text ||
      old.kind !== highlight.kind
    )
      conflict = true;
  }
  let status: "create" | "merge" | "replayed" | "conflict" = "create";
  if (existing) status = "merge";
  if (receipt) status = "replayed";
  if (conflict) status = "conflict";
  return { item, key, existing, newHighlights, status };
}

export const inspect = internalQuery({
  args,
  returns: outcome,
  handler: async (ctx, input) => {
    const plan = await inspectItem(ctx, input);
    return {
      status: plan.status,
      highlightsToCreate: plan.newHighlights.length,
      articleId: plan.existing?._id ?? null,
    };
  },
});

export const importPreferences = internalMutation({
  args,
  returns: v.object({
    copied: v.array(v.string()),
    preserved: v.array(v.string()),
  }),
  handler: async (ctx, input) => {
    await assertTarget(ctx, input.expectedOrigin);
    const parsed = archivePreferences.safeParse(JSON.parse(input.payload));
    if (!parsed.success) throw new ConvexError("Invalid archive preferences.");
    const old = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .unique();
    const copied: string[] = [];
    const preserved: string[] = [];
    const fields: Partial<
      Pick<
        Doc<"userSettings">,
        "speechVoice" | "bibleEnabled" | "bibleTranslation" | "readingScope"
      >
    > = {};
    const source = parsed.data;
    for (const key of [
      "speechVoice",
      "bibleEnabled",
      "bibleTranslation",
      "readingScope",
    ] as const) {
      if (old?.[key] !== undefined) preserved.push(key);
      else copied.push(key);
    }
    if (old?.speechVoice === undefined) fields.speechVoice = source.speechVoice;
    if (old?.bibleEnabled === undefined)
      fields.bibleEnabled = source.bibleEnabled;
    if (old?.bibleTranslation === undefined)
      fields.bibleTranslation = source.bibleTranslation;
    if (old?.readingScope === undefined)
      fields.readingScope = source.readingScope;
    if (copied.length) {
      if (old)
        await ctx.db.patch(old._id, { ...fields, updatedAt: Date.now() });
      else
        await ctx.db.insert("userSettings", {
          ...source,
          userId: DEFAULT_USER_ID,
          updatedAt: Date.now(),
        });
    }
    return { copied, preserved };
  },
});

export const importOne = internalMutation({
  args,
  returns: outcome,
  handler: async (ctx, input) => {
    const plan = await inspectItem(ctx, input);
    if (plan.status === "conflict")
      throw new ConvexError("Archive conflicts with existing library content.");
    if (plan.status === "replayed")
      return {
        status: plan.status,
        highlightsToCreate: 0,
        articleId: plan.existing?._id ?? null,
      };
    const { _id: sourceId, userId: _sourceUser, ...fields } = plan.item.article;
    let article: Doc<"articles"> | null = plan.existing;
    if (!article) {
      validateArticleSize({ ...fields, userId: DEFAULT_USER_ID });
      const id = await ctx.db.insert("articles", {
        ...fields,
        userId: DEFAULT_USER_ID,
      });
      article = await ctx.db.get("articles", id);
      if (!article) throw new Error("Imported article unavailable");
      await updateQueueStats(ctx, null, article);
    }
    await rememberImportIdentity(ctx, article, fields.guid, "");
    for (const {
      _id: _sourceId,
      userId: _userId,
      articleId: _articleId,
      ...highlight
    } of plan.newHighlights) {
      await ctx.db.insert("highlights", {
        ...highlight,
        userId: DEFAULT_USER_ID,
        articleId: article._id,
      });
    }
    for (const interaction of plan.item.interactions) {
      await ctx.db.insert("articleInteractions", {
        userId: DEFAULT_USER_ID,
        articleId: article._id,
        action: interaction.action,
        createdAt: interaction.createdAt,
        visitId: `archive:${plan.item.source}:${interaction._id}`,
      });
    }
    const place = plan.item.place;
    if (place.percent > 0 || (place.paragraphIndex ?? 0) > 0) {
      const capturedAt = plan.item.capturedAt;
      const visitId = `archive:${plan.item.archiveHash}:${sourceId}`;
      const day = new Date(capturedAt).toISOString().slice(0, 10);
      await ctx.db.insert("readingActivity", {
        userId: DEFAULT_USER_ID,
        articleId: article._id,
        visitId,
        day,
        startedAt: capturedAt,
        updatedAt: capturedAt,
        activeTimeMs: 0,
        visibleTimeMs: 0,
        timeSpentMs: 0,
        annotationsOpened: [],
        maxScrollPercent: place.percent,
        paragraphIndex: place.paragraphIndex ?? undefined,
        estimatedReadMinutes: article.estimatedReadMinutes,
      });
      await mergeResume(
        ctx,
        article,
        {
          articleId: article._id,
          updatedAt: capturedAt,
          maxScrollPercent: place.percent,
          paragraphIndex: place.paragraphIndex ?? undefined,
          visitId,
          day,
        },
        true,
      );
    }
    await ctx.db.insert("articleImportKeys", {
      userId: DEFAULT_USER_ID,
      key: plan.key,
      articleId: article._id,
    });
    return {
      status: plan.status,
      highlightsToCreate: plan.newHighlights.length,
      articleId: article._id,
    };
  },
});
