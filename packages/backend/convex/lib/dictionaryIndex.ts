import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DEFAULT_USER_ID } from "./constants";
import { sha256Hex } from "./tokens";

export const SEARCH_BYTES = 256;
export const SEARCH_CHUNK = 1024;
const OVERLAP = SEARCH_BYTES;

export function foldDictionary(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function dictionaryLetter(key: string) {
  const first = foldDictionary(key).charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

// ASCII UTF-16 encoding retains the old JS comparator (including astral
// characters), rather than substituting locale or UTF-8 index ordering.
export function dictionaryOrder(key: string) {
  const encode = (s: string) => {
    let result = "";
    for (let i = 0; i < s.length; i++)
      result += s.charCodeAt(i).toString(16).padStart(4, "0");
    return result;
  };
  return `${encode(foldDictionary(key))}!${encode(key)}!`;
}

export function dictionaryChunks(sense: string) {
  const chars = Array.from(foldDictionary(sense));
  const chunks: string[] = [];
  for (let at = 0; at < chars.length; at += SEARCH_CHUNK - OVERLAP) {
    chunks.push(chars.slice(at, at + SEARCH_CHUNK).join(""));
    if (at + SEARCH_CHUNK >= chars.length) break;
  }
  return chunks.length ? chunks : [""];
}

export function boundedDictionaryText(text: string, bytes: number) {
  let size = 0;
  let result = "";
  const encoder = new TextEncoder();
  for (const char of text) {
    const n = encoder.encode(char).length;
    if (size + n > bytes) return `${result}…`;
    size += n;
    result += char;
  }
  return result;
}

export async function dictionaryActive(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
) {
  if (userId === DEFAULT_USER_ID) return true;
  const reader = await ctx.db
    .query("readers")
    .withIndex("by_libraryId", (q) => q.eq("libraryId", userId))
    .unique();
  return reader?.status === "active" && reader.deletingAt === undefined;
}

export function dictionaryState(ctx: Pick<QueryCtx, "db">, userId: string) {
  return ctx.db
    .query("dictionaryState")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** Called in the same transaction as every record/retry, and by backfill. */
export async function indexDictionaryLookup(
  ctx: MutationCtx,
  row: Doc<"lookups">,
) {
  if (!row.wordKey) return;
  // Historical writers bounded terms to 200 code units. Refuse malformed
  // imports explicitly, never mark their migration complete or truncate keys.
  const foldedWord = foldDictionary(row.wordKey);
  if (
    new TextEncoder().encode(row.wordKey).length > 1600 ||
    row.wordKey.length > 400 ||
    foldedWord.length > 600
  )
    throw new Error("Dictionary headword exceeds the supported byte limit");
  let state = await dictionaryState(ctx, row.userId);
  if (!state) {
    const existingLookups = await ctx.db
      .query("lookups")
      .withIndex("by_user_created", (q) => q.eq("userId", row.userId))
      .take(2);
    const id = await ctx.db.insert("dictionaryState", {
      userId: row.userId,
      total: 0,
      complete:
        existingLookups.length === 1 && existingLookups[0]._id === row._id,
      cursor: null,
    });
    state = await ctx.db.get("dictionaryState", id);
  }
  const existing = await ctx.db
    .query("dictionaryHeadwords")
    .withIndex("by_user_word", (q) =>
      q.eq("userId", row.userId).eq("wordKey", row.wordKey),
    )
    .unique();
  const orderKey = dictionaryOrder(row.wordKey);
  const preview = boundedDictionaryText(row.sense, 1200);
  const adopted = row.dictionaryHeadwordId !== undefined;
  let headwordId = existing?._id;
  if (existing) {
    const first =
      row.createdAt < existing.firstSeen ||
      (row.createdAt === existing.firstSeen &&
        row._id.localeCompare(existing.firstLookupId) <= 0);
    const nextPreview = first ? preview : existing.preview;
    if (
      !adopted ||
      row.createdAt < existing.firstSeen ||
      nextPreview !== existing.preview
    )
      await ctx.db.patch("dictionaryHeadwords", existing._id, {
        firstSeen: Math.min(existing.firstSeen, row.createdAt),
        firstLookupId: first ? row._id : existing.firstLookupId,
        occurrences: existing.occurrences + (adopted ? 0 : 1),
        preview: nextPreview,
      });
  } else {
    headwordId = await ctx.db.insert("dictionaryHeadwords", {
      userId: row.userId,
      wordKey: row.wordKey,
      orderKey,
      letter: dictionaryLetter(row.wordKey),
      firstSeen: row.createdAt,
      firstLookupId: row._id,
      occurrences: 1,
      preview,
    });
    if (state)
      await ctx.db.patch("dictionaryState", state._id, {
        total: state.total + 1,
      });
  }
  if (!headwordId) throw new Error("Dictionary headword missing");
  const manifest = await ctx.db
    .query("dictionaryOccurrences")
    .withIndex("by_lookup", (q) => q.eq("lookupId", row._id))
    .unique();
  const senseHash = await sha256Hex(row.sense);
  const unchanged = manifest?.senseHash === senseHash;
  const generation = unchanged
    ? manifest.generation
    : (manifest?.generation ?? -1) + 1;
  if (!unchanged) {
    // Atomically publish the new version. Never bulk-read/delete a giant
    // historical sense during a retry; readers reject stale versions.
    const chunks = dictionaryChunks(row.sense);
    if (chunks.length > 3000)
      throw new Error("Dictionary search chunk limit exceeded");
    for (const [i, text] of chunks.entries())
      await ctx.db.insert("dictionarySearch", {
        userId: row.userId,
        headwordId,
        lookupId: row._id,
        generation,
        scanKey: `${orderKey}~${row._id}~${String(generation).padStart(12, "0")}~${String(i).padStart(4, "0")}`,
        foldedWord,
        letter: dictionaryLetter(row.wordKey),
        text,
      });
    if (manifest)
      await ctx.db.patch("dictionaryOccurrences", manifest._id, {
        generation,
        senseHash,
      });
    else
      await ctx.db.insert("dictionaryOccurrences", {
        userId: row.userId,
        lookupId: row._id,
        headwordId,
        generation,
        senseHash,
      });
  }
  // Ordinary retries leave no stale rows; huge legacy revisions clean up in
  // small batches here or via the explicit cleanup hook.
  const old = await ctx.db
    .query("dictionarySearch")
    .withIndex("by_lookup", (q) => q.eq("lookupId", row._id))
    .take(8);
  for (const chunk of old)
    if (chunk.generation !== generation)
      await ctx.db.delete("dictionarySearch", chunk._id);
  if (!adopted || row.dictionarySenseOrder !== row._id)
    await ctx.db.patch("lookups", row._id, {
      dictionaryHeadwordId: headwordId,
      dictionarySenseOrder: row._id,
    });
}

/** Account hook: call repeatedly until 0; only after disabling the reader.
 * No jobs are scheduled by dictionary migration, so the active gate fences
 * all late continuations. Keep numeric account step positions unchanged. */
export async function purgeDictionary(ctx: MutationCtx, userId: string) {
  const search = await ctx.db
    .query("dictionarySearch")
    .withIndex("by_user_scan", (q) => q.eq("userId", userId))
    .take(64);
  if (search.length) {
    for (const row of search) await ctx.db.delete("dictionarySearch", row._id);
    return search.length;
  }
  const heads = await ctx.db
    .query("dictionaryHeadwords")
    .withIndex("by_user_order", (q) => q.eq("userId", userId))
    .take(64);
  if (heads.length) {
    for (const row of heads)
      await ctx.db.delete("dictionaryHeadwords", row._id);
    return heads.length;
  }
  const occurrences = await ctx.db
    .query("dictionaryOccurrences")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(64);
  if (occurrences.length) {
    for (const row of occurrences)
      await ctx.db.delete("dictionaryOccurrences", row._id);
    return occurrences.length;
  }
  const state = await dictionaryState(ctx, userId);
  if (state) {
    await ctx.db.delete("dictionaryState", state._id);
    return 1;
  }
  return 0;
}
