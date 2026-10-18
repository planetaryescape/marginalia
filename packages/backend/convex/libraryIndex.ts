import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./functions";
import {
  articleContentHash,
  INDEX_LEASE_MS,
  INDEX_MODEL,
  importLibraryActive,
  libraryIndexText,
  MAX_IMPORT_ATTEMPTS,
  MAX_IMPORT_CONCURRENCY,
} from "./lib/importJobs";

async function activeIndexes(ctx: MutationCtx, userId: string) {
  return ctx.db
    .query("articles")
    .withIndex("by_userId_and_libraryIndex_status_and_leaseUntil", (q) =>
      q
        .eq("userId", userId)
        .eq("libraryIndex.status", "running")
        .gt("libraryIndex.leaseUntil", Date.now()),
    )
    .take(MAX_IMPORT_CONCURRENCY);
}

/** At most two article rows (each <1 MiB), never a scan over a library's bodies. */
export async function wakeLibraryIndex(ctx: MutationCtx, userId: string) {
  if (!(await importLibraryActive(ctx, userId))) return;
  const slots =
    MAX_IMPORT_CONCURRENCY - (await activeIndexes(ctx, userId)).length;
  if (!slots) return;
  const ready = await ctx.db
    .query("articles")
    .withIndex("by_userId_and_libraryIndex_status_and_retryAt", (q) =>
      q
        .eq("userId", userId)
        .eq("libraryIndex.status", "pending")
        .lte("libraryIndex.retryAt", Date.now()),
    )
    .take(slots);
  for (const row of ready)
    await ctx.scheduler.runAfter(0, internal.libraryIndex.start, {
      articleId: row._id,
      userId,
    });
}

/** Called inside the readable publication transaction, never after saving. */
export async function queueLibraryIndex(
  ctx: MutationCtx,
  articleId: Id<"articles">,
) {
  const article = await ctx.db.get("articles", articleId);
  if (
    !article ||
    article.extractionStatus !== "extracted" ||
    article.embedding ||
    !libraryIndexText(article)
  )
    return;
  const hash = await articleContentHash(article);
  const old = article.libraryIndex;
  if (old?.hash === hash && old.model === INDEX_MODEL) {
    // A credential/backfill wake must not reset exhausted/permanent failures.
    if (
      old.status === "failed" ||
      (old.status === "running" && (old.leaseUntil ?? 0) > Date.now())
    )
      return;
    if (old.status === "pending") {
      // A disabled library may have consumed its original wake. A subsequent
      // import/backfill can wake it safely; claiming still prevents paid duplicates.
      await ctx.scheduler.runAfter(
        Math.max(0, (old.retryAt ?? 0) - Date.now()),
        internal.libraryIndex.start,
        {
          articleId,
          userId: article.userId,
        },
      );
      return;
    }
    if (old.status === "running") {
      await ctx.db.patch(articleId, {
        libraryIndex: { ...old, status: "pending", leaseUntil: undefined },
      });
      await ctx.scheduler.runAfter(0, internal.libraryIndex.start, {
        articleId,
        userId: article.userId,
      });
      return;
    }
  }
  await ctx.db.patch(articleId, {
    libraryIndex: {
      revision: (old?.revision ?? 0) + 1,
      hash,
      model: INDEX_MODEL,
      status: "pending",
      attempts: 0,
      run: old?.run ?? 0,
    },
  });
  await ctx.scheduler.runAfter(0, internal.libraryIndex.start, {
    articleId,
    userId: article.userId,
  });
}

export const enqueue = internalMutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    if (article && (await importLibraryActive(ctx, article.userId)))
      await queueLibraryIndex(ctx, article._id);
  },
});

export const claim = internalMutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    const job = article?.libraryIndex;
    if (!article || !job || !(await importLibraryActive(ctx, article.userId)))
      return null;
    if (
      article.embedding ||
      article.extractionStatus !== "extracted" ||
      !libraryIndexText(article)
    ) {
      await ctx.db.patch(article._id, {
        libraryIndex: {
          ...job,
          status: article.embedding ? "ready" : "unavailable",
          leaseUntil: undefined,
          retryAt: undefined,
        },
      });
      await wakeLibraryIndex(ctx, article.userId);
      return null;
    }
    if ((job.retryAt ?? 0) > Date.now()) return null;
    if (
      job.status !== "pending" &&
      !(job.status === "running" && (job.leaseUntil ?? 0) <= Date.now())
    )
      return null;
    if (
      job.hash !== (await articleContentHash(article)) ||
      job.model !== INDEX_MODEL
    ) {
      await queueLibraryIndex(ctx, article._id);
      return null;
    }
    if (job.attempts >= MAX_IMPORT_ATTEMPTS) {
      await ctx.db.patch(article._id, {
        libraryIndex: {
          ...job,
          status: "failed",
          leaseUntil: undefined,
          retryAt: undefined,
        },
      });
      await wakeLibraryIndex(ctx, article.userId);
      return null;
    }
    if (job.status === "running") {
      // Recovery may find both slots taken by newer work. Keep this expired
      // claim visible to a later release, rather than losing its only timer.
      await ctx.db.patch(article._id, {
        libraryIndex: {
          ...job,
          status: "pending",
          leaseUntil: undefined,
          retryAt: undefined,
        },
      });
    }
    // Completion/failure wakes the next eligible rows; these leases are only
    // crash recovery. A full pool never starts a zero-delay reschedule loop.
    if (
      (await activeIndexes(ctx, article.userId)).length ===
      MAX_IMPORT_CONCURRENCY
    )
      return null;
    const claimed = {
      ...job,
      status: "running" as const,
      run: job.run + 1,
      attempts: job.attempts + 1,
      leaseUntil: Date.now() + INDEX_LEASE_MS,
      retryAt: undefined,
    };
    await ctx.db.patch(article._id, { libraryIndex: claimed });
    // A process crash after claiming cannot strand work; at most three provider attempts.
    await ctx.scheduler.runAfter(INDEX_LEASE_MS, internal.libraryIndex.start, {
      ...args,
      userId: article.userId,
    });
    return {
      userId: article.userId,
      text: libraryIndexText(article),
      ...claimed,
    };
  },
});

/** Scheduled mutations retry atomically: a killed action cannot lose the
 * interval between dispatch and claiming its durable recovery wake. */
export const start = internalMutation({
  args: { articleId: v.id("articles"), userId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const claim:
      | (NonNullable<Doc<"articles">["libraryIndex"]> & {
          userId: string;
          text: string;
        })
      | null = await ctx.runMutation(internal.libraryIndex.claim, {
      articleId: args.articleId,
    });
    if (claim)
      await ctx.scheduler.runAfter(
        0,
        internal.actions.indexLibraryArticle.runClaimed,
        {
          articleId: args.articleId,
          userId: claim.userId,
          text: claim.text,
          revision: claim.revision,
          run: claim.run,
          hash: claim.hash,
          model: claim.model,
        },
      );
    // The user ID on recovery also covers an article removed after dispatch.
    const userId =
      claim?.userId ??
      args.userId ??
      (await ctx.db.get("articles", args.articleId))?.userId;
    if (userId) await wakeLibraryIndex(ctx, userId);
  },
});

const fence = {
  articleId: v.id("articles"),
  userId: v.string(),
  revision: v.number(),
  run: v.number(),
  hash: v.string(),
  model: v.string(),
};

async function currentClaim(
  ctx: MutationCtx,
  args: {
    articleId: Id<"articles">;
    userId: string;
    revision: number;
    run: number;
    hash: string;
    model: string;
  },
): Promise<Doc<"articles"> | null> {
  const row = await ctx.db.get("articles", args.articleId);
  const job = row?.libraryIndex;
  if (
    !row ||
    row.userId !== args.userId ||
    !job ||
    job.status !== "running" ||
    job.revision !== args.revision ||
    job.run !== args.run ||
    job.hash !== args.hash ||
    job.model !== args.model ||
    args.model !== INDEX_MODEL ||
    (job.leaseUntil ?? 0) <= Date.now() ||
    !(await importLibraryActive(ctx, args.userId))
  )
    return null;
  if (
    row.embedding ||
    row.extractionStatus !== "extracted" ||
    !libraryIndexText(row)
  ) {
    await ctx.db.patch(row._id, {
      libraryIndex: {
        ...job,
        status: row.embedding ? "ready" : "unavailable",
        leaseUntil: undefined,
        retryAt: undefined,
      },
    });
    return null;
  }
  if ((await articleContentHash(row)) !== args.hash) {
    // Content changed outside ingestion: invalidate the old result and schedule this revision.
    await ctx.db.patch(row._id, { libraryIndex: { ...job, status: "failed" } });
    await queueLibraryIndex(ctx, row._id);
    return null;
  }
  return row;
}

export const validate = internalMutation({
  args: fence,
  handler: async (ctx, args) => Boolean(await currentClaim(ctx, args)),
});

export const complete = internalMutation({
  args: { ...fence, embedding: v.optional(v.array(v.float64())) },
  handler: async (ctx, args) => {
    const row = await currentClaim(ctx, args);
    if (!row?.libraryIndex) {
      await wakeLibraryIndex(ctx, args.userId);
      return false;
    }
    if (
      args.embedding &&
      (args.embedding.length !== 1536 ||
        args.embedding.some((n) => !Number.isFinite(n)))
    )
      throw new Error("Invalid library vector");
    await ctx.db.patch(row._id, {
      ...(args.embedding
        ? { embedding: args.embedding, embeddedAt: Date.now() }
        : {}),
      libraryIndex: {
        ...row.libraryIndex,
        status: args.embedding ? "ready" : "unavailable",
        leaseUntil: undefined,
        retryAt: undefined,
      },
    });
    await wakeLibraryIndex(ctx, args.userId);
    return true;
  },
});

export const fail = internalMutation({
  args: {
    ...fence,
    retryable: v.boolean(),
    unavailable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const row = await currentClaim(ctx, args);
    if (!row?.libraryIndex) {
      await wakeLibraryIndex(ctx, args.userId);
      return;
    }
    const retry =
      !args.unavailable &&
      args.retryable &&
      row.libraryIndex.attempts < MAX_IMPORT_ATTEMPTS;
    const delay = 5_000 * row.libraryIndex.attempts;
    await ctx.db.patch(row._id, {
      libraryIndex: {
        ...row.libraryIndex,
        status: args.unavailable ? "unavailable" : retry ? "pending" : "failed",
        leaseUntil: undefined,
        retryAt: retry ? Date.now() + delay : undefined,
      },
    });
    if (retry)
      await ctx.scheduler.runAfter(delay, internal.libraryIndex.start, {
        articleId: row._id,
        userId: args.userId,
      });
    await wakeLibraryIndex(ctx, args.userId);
  },
});
