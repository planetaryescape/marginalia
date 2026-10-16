// No "use node": embeddings are a plain fetch, so HTTP actions in the default
// runtime can use them as well as Node actions.
import { z } from "zod";
import { type EmbeddingProvider, providerFailure } from "./providers";

export interface EmbeddingTarget {
  provider: EmbeddingProvider;
  apiKey: string;
}

// The same model either way, so vectors stay compatible with the 1536-dimension indexes
const ENDPOINTS: Record<EmbeddingProvider, { url: string; model: string }> = {
  openai: {
    url: "https://api.openai.com/v1/embeddings",
    model: "text-embedding-3-small",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/embeddings",
    model: "openai/text-embedding-3-small",
  },
};

/** Stored with cached vectors, so a model change can't serve the old model's vectors. */
export function embeddingModel(provider: EmbeddingProvider): string {
  return ENDPOINTS[provider].model;
}

const responseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      embedding: z.array(z.number().finite()).length(1536),
    }),
  ),
});

/** Do not silently attach an incomplete or misordered vector to the wrong text. */
export function parseEmbeddings(body: unknown, count: number): number[][] {
  const { data } = responseSchema.parse(body);
  const sorted = data.sort((a, b) => a.index - b.index);
  if (
    sorted.length !== count ||
    sorted.some((item, index) => item.index !== index)
  ) {
    throw new Error("Embedding response did not match the requested texts");
  }
  return sorted.map((item) => item.embedding);
}

export async function embedText(
  target: EmbeddingTarget,
  text: string,
): Promise<number[]> {
  const [embedding] = await embedTexts(target, [text]);
  return embedding;
}

export async function embedTexts(
  target: EmbeddingTarget,
  texts: string[],
): Promise<number[][]> {
  if (!texts.length) return [];
  const { url, model } = ENDPOINTS[target.provider];
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${target.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: texts, model }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw providerFailure(
      response.status,
      await response.text().catch(() => ""),
    );
  }

  return parseEmbeddings(await response.json(), texts.length);
}
