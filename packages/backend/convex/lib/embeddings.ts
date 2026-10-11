// No "use node": embeddings are a plain fetch, so HTTP actions in the default
// runtime can use them as well as Node actions.
import { z } from "zod";

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";

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

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not configured");
  return key;
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  return embedding;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: EMBEDDING_MODEL,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Embedding API failed: ${response.status} ${body}`);
  }

  return parseEmbeddings(await response.json(), texts.length);
}
