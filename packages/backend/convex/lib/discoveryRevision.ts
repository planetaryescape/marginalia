import type { MutationCtx, QueryCtx } from "../_generated/server";
import { metadataLibraryRetained } from "./shelfCounts";

export const DISCOVERY_SHARDS = 32;
// Saturation is permanent fail-closed, not a wrapping counter or a failed source
// write. No reuse is allowed at this value, including for clients already open.
export const DISCOVERY_EXHAUSTED = Number.MAX_SAFE_INTEGER;

export function discoveryShard(id: string) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++)
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0) % DISCOVERY_SHARDS;
}

type Source = { _id: string; userId: string };
const supportedLibrary = (id: string) =>
  new TextEncoder().encode(id).byteLength <= 256;

/** Called with innerDb from canonical hooks, atomically with the source write.
 * Never hashes/serializes bodies or vectors; even timestamp-free patches bump.
 * Two source IDs in different shards write disjoint epoch rows. */
export async function advanceDiscoveryRevision(
  ctx: MutationCtx,
  before: Source | null,
  after: Source | null,
) {
  const source = after ?? before;
  if (!source) return;
  const shard = discoveryShard(source._id);
  const owners = new Set([before?.userId, after?.userId]);
  for (const userId of owners) {
    if (
      !userId ||
      !supportedLibrary(userId) ||
      !(await metadataLibraryRetained(ctx, userId))
    )
      continue;
    const rows = await ctx.db
      .query("discoveryEpochs")
      .withIndex("by_userId_and_shard", (q) =>
        q.eq("userId", userId).eq("shard", shard),
      )
      .take(2);
    // Duplicates/malformed rows disable the reader query. Do not delete or
    // reset them: that could create an ABA epoch matching a retained client.
    if (rows.length > 1) continue;
    const row = rows[0];
    if (!row)
      await ctx.db.insert("discoveryEpochs", { userId, shard, epoch: 1 });
    else if (
      Number.isSafeInteger(row.epoch) &&
      row.epoch >= 1 &&
      row.epoch < DISCOVERY_EXHAUSTED
    )
      await ctx.db.patch(row._id, { epoch: row.epoch + 1 });
  }
}

export async function readDiscoveryRevision(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
) {
  // Unsupported keys disable reuse on every read; they never masquerade as
  // epoch zero when their writes are not recorded.
  if (!supportedLibrary(userId)) return null;
  const rows = await ctx.db
    .query("discoveryEpochs")
    .withIndex("by_userId_and_shard", (q) => q.eq("userId", userId))
    .take(DISCOVERY_SHARDS + 1);
  if (rows.length > DISCOVERY_SHARDS) return null;
  const epochs = Array<number>(DISCOVERY_SHARDS).fill(0);
  for (const row of rows) {
    if (
      !Number.isInteger(row.shard) ||
      row.shard < 0 ||
      row.shard >= DISCOVERY_SHARDS ||
      !Number.isSafeInteger(row.epoch) ||
      row.epoch < 1 ||
      row.epoch >= DISCOVERY_EXHAUSTED ||
      epochs[row.shard] !== 0
    )
      return null;
    epochs[row.shard] = row.epoch;
  }
  return epochs.join(":");
}

/** Account's existing compact-metadata phase; never adds a paginate or a source
 * scan. Deleted libraries cannot resurrect epochs through source purge hooks. */
export async function purgeDiscoveryRevision(
  ctx: MutationCtx,
  userId: string,
): Promise<number> {
  if (await metadataLibraryRetained(ctx, userId))
    throw new Error("Retained discovery library");
  const rows = await ctx.db
    .query("discoveryEpochs")
    .withIndex("by_userId_and_shard", (q) => q.eq("userId", userId))
    .take(33);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}
