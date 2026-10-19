import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { metadataLibraryRetained } from "./shelfCounts";

export type FingerprintKind = Doc<"marginaliaSourceStamps">["kind"];
type Source = Doc<FingerprintKind>;
type Stamp = Omit<Doc<"marginaliaSourceStamps">, "_id" | "_creationTime">;

export function sourceStamp(kind: FingerprintKind, row: Source): Stamp {
  return {
    sourceId: row._id,
    kind,
    userId: row.userId,
    sourceCreationTime: row._creationTime,
    updatedAt: "updatedAt" in row ? row.updatedAt : undefined,
    embeddedAt: "embeddedAt" in row ? row.embeddedAt : undefined,
    indexedAt: "indexedAt" in row ? row.indexedAt : undefined,
  };
}

function equalStamp(a: Stamp, b: Stamp) {
  return (
    a.sourceId === b.sourceId &&
    a.kind === b.kind &&
    a.userId === b.userId &&
    a.sourceCreationTime === b.sourceCreationTime &&
    a.updatedAt === b.updatedAt &&
    a.embeddedAt === b.embeddedAt &&
    a.indexedAt === b.indexedAt
  );
}

/** Caller supplies innerDb. Publication, transfer and removal commit with the
 * source, including generic patch/replace and embedding timestamp CLEARs.
 * Do not synthesize times from content/vector changes: legacy reads the stamps
 * themselves, even when the embedding is absent. */
export async function syncFingerprintSource(
  ctx: MutationCtx,
  kind: FingerprintKind,
  before: Source | null,
  after: Source | null,
) {
  const source = after ?? before;
  if (!source) return;
  const fields = after ? sourceStamp(kind, after) : null;
  if (before && fields && equalStamp(sourceStamp(kind, before), fields)) return;
  const prior = await ctx.db
    .query("marginaliaSourceStamps")
    .withIndex("by_sourceId", (q) => q.eq("sourceId", source._id))
    .unique();
  if (!fields || !(await metadataLibraryRetained(ctx, fields.userId))) {
    if (prior) await ctx.db.delete(prior._id);
    return;
  }
  if (prior) {
    if (!equalStamp(prior, fields)) await ctx.db.replace(prior._id, fields);
  } else await ctx.db.insert("marginaliaSourceStamps", fields);
}

export async function fingerprintState(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
) {
  return ctx.db
    .query("marginaliaFingerprintState")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/** This is an explicit account-purge hook, not a public deletion API. Return
 * positive immediately after a batch; account must continue in a fresh tx. */
export async function purgeFingerprintMetadata(
  ctx: MutationCtx,
  userId: string,
): Promise<number> {
  if (await metadataLibraryRetained(ctx, userId))
    throw new Error(
      "Cannot purge fingerprint metadata from a retained library",
    );
  const rows = await ctx.db
    .query("marginaliaSourceStamps")
    .withIndex("by_userId_and_kind_and_sourceCreationTime", (q) =>
      q.eq("userId", userId),
    )
    .take(64);
  for (const row of rows) await ctx.db.delete(row._id);
  if (rows.length) return rows.length;
  const state = await fingerprintState(ctx, userId);
  if (state) {
    await ctx.db.delete(state._id);
    return 1;
  }
  return 0;
}
