const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const MODEL = "openai/text-embedding-3-small";
const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export interface EmbeddingResult {
  index: number; // Index in the original texts array
  embedding: number[];
}

/**
 * Embed chunks, skipping failures gracefully.
 * Returns results paired with their original index so the caller
 * knows which chunks succeeded.
 */
export async function embedChunks(
  texts: string[],
  apiKey: string,
): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(texts.length / BATCH_SIZE);
    console.log(
      `  Embedding batch ${batchNum}/${totalBatches} (${batch.length} chunks)`,
    );

    try {
      const embeddings = await embedWithRetry(batch, apiKey);
      for (let j = 0; j < embeddings.length; j++) {
        results.push({ index: i + j, embedding: embeddings[j] });
      }
      succeeded += embeddings.length;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `  Batch ${batchNum} failed permanently, skipping ${batch.length} chunks: ${msg}`,
      );
      failed += batch.length;
    }

    // Rate limit buffer
    if (i + BATCH_SIZE < texts.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  console.log(`  Embeddings done: ${succeeded} succeeded, ${failed} failed`);
  return results;
}

async function embedWithRetry(
  texts: string[],
  apiKey: string,
  attempt = 1,
): Promise<number[][]> {
  const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: MODEL,
    }),
  });

  const raw = await response.text();

  if (!response.ok) {
    if (attempt < MAX_RETRIES) {
      console.warn(
        `    Attempt ${attempt} failed (${response.status}), retrying...`,
      );
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      return embedWithRetry(texts, apiKey, attempt + 1);
    }
    throw new Error(`${response.status} ${raw.slice(0, 200)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    if (attempt < MAX_RETRIES) {
      console.warn(`    Attempt ${attempt} returned invalid JSON, retrying...`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      return embedWithRetry(texts, apiKey, attempt + 1);
    }
    throw new Error(`Invalid JSON: ${raw.slice(0, 200)}`);
  }

  if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
    if (attempt < MAX_RETRIES) {
      console.warn(
        `    Attempt ${attempt} returned unexpected shape, retrying...`,
      );
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      return embedWithRetry(texts, apiKey, attempt + 1);
    }
    throw new Error(
      `Unexpected response: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }

  const sorted = [...data.data].sort((a: any, b: any) => a.index - b.index);
  return sorted.map((d: any) => d.embedding);
}
