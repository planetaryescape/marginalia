import { MAX_CHUNK_BYTES } from "./chunker";
import { HttpError, type RequestOptions, requestJson } from "./network";

export interface EmbeddingResult {
  index: number;
  embedding: number[];
}

function parseEmbeddings(value: unknown, count: number): number[][] {
  if (
    typeof value !== "object" ||
    value === null ||
    !("data" in value) ||
    !Array.isArray(value.data) ||
    value.data.length !== count
  )
    throw new Error("Invalid embedding response");
  const results = new Map<number, number[]>();
  for (const row of value.data) {
    if (
      typeof row !== "object" ||
      row === null ||
      !Number.isInteger(row.index) ||
      row.index < 0 ||
      row.index >= count ||
      results.has(row.index) ||
      !Array.isArray(row.embedding) ||
      row.embedding.length !== 1536 ||
      row.embedding.some(
        (n: unknown) => typeof n !== "number" || !Number.isFinite(n),
      )
    )
      throw new Error("Invalid embedding response");
    results.set(row.index, row.embedding);
  }
  return Array.from({ length: count }, (_, index) => {
    const embedding = results.get(index);
    if (!embedding) throw new Error("Missing embedding");
    return embedding;
  });
}

/** Invalid individual inputs never poison neighboring valid chunks. */
export async function embedChunks(
  texts: string[],
  apiKey: string,
  options: RequestOptions = {},
): Promise<EmbeddingResult[]> {
  const valid = texts
    .map((text, index) => ({ text, index }))
    .filter(
      ({ text }) =>
        text.trim().length > 0 &&
        Buffer.byteLength(text, "utf8") <= MAX_CHUNK_BYTES,
    );
  const results: EmbeddingResult[] = [];
  for (let i = 0; i < valid.length; i += 10) {
    options.signal?.throwIfAborted();
    const batch = valid.slice(i, i + 10);
    try {
      const raw = await requestJson(
        "https://openrouter.ai/api/v1/embeddings",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input: batch.map(({ text }) => text),
            model: "openai/text-embedding-3-small",
          }),
        },
        options,
      );
      const embeddings = parseEmbeddings(raw, batch.length);
      for (const [index, embedding] of embeddings.entries())
        results.push({ index: batch[index].index, embedding });
    } catch (error) {
      options.signal?.throwIfAborted();
      if (
        error instanceof HttpError &&
        (error.status === 401 || error.status === 403)
      )
        throw error;
      console.warn(
        `Embedding batch failed; keeping affected files unchanged (${error instanceof Error ? error.message : "request failed"})`,
      );
      // The caller checkpoints whole files. Once a batch fails, more paid work
      // cannot complete this file; release it and allow the next file to run.
      break;
    }
  }
  return results;
}
