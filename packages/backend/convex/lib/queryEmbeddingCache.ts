import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { type EmbeddingTarget, embeddingModel, embedText } from "./embeddings";

/** Entries kept per reader; the oldest go first when a new one is stored. */
export const QUERY_EMBEDDING_CAP = 500;
export const QUERY_EMBEDDING_TTL_MS = 30 * 24 * 60 * 60_000;
// Same limit the search path already applies before embedding
const MAX_QUERY_CHARS = 4000;

/**
 * Lower case, single spaces, no ends, so "Rust  Async " and "rust async"
 * share one entry. Case folding means a cached vector can stand in for a
 * near-identical query whose embedding would differ slightly.
 */
export function normaliseQuery(question: string): string {
  return question.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The query's embedding, from the reader's cache when a fresh entry from the
 * same model exists. Cache failures are logged and fall back to embedding, so
 * the cache can only make a search faster, never fail it.
 */
export async function cachedQueryEmbedding(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  userId: string,
  question: string,
  embedder: EmbeddingTarget,
): Promise<{ vector: number[]; cached: boolean }> {
  // Embed the normalised text, so every query sharing a key shares one vector
  const text = normaliseQuery(question.slice(0, MAX_QUERY_CHARS));
  const model = embeddingModel(embedder.provider);
  try {
    const hit: number[] | null = await ctx.runQuery(
      internal.queryEmbeddings.lookup,
      { userId, key: text, model, now: Date.now() },
    );
    if (hit) return { vector: hit, cached: true };
  } catch (error) {
    console.error("Query embedding cache read failed", error);
  }

  const vector = await embedText(embedder, text);
  try {
    await ctx.runMutation(internal.queryEmbeddings.store, {
      userId,
      key: text,
      model,
      embedding: vector,
      now: Date.now(),
    });
  } catch (error) {
    console.error("Query embedding cache write failed", error);
  }
  return { vector, cached: false };
}
