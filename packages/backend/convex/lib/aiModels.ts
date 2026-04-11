"use node";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, generateText } from "ai";
import type { ZodType } from "zod";

export const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

export const TEXT_MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-3-flash-preview",
] as const;

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";

function isAuthError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    const status = e.statusCode as number | undefined;
    if (status === 401 || status === 403) return true;
  }
  return false;
}

function isRetryableError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    if (e.statusCode === 429) return true;
    if (typeof e.message === "string" && e.message.includes("429")) return true;
    const status = e.statusCode as number | undefined;
    if (status && status >= 500 && status < 600) return true;
  }
  return false;
}

export async function generateObjectWithFallback<T>(options: {
  schema: ZodType<T, any, any>;
  prompt?: string;
  system?: string;
  modelIndex?: number;
}): Promise<{ object: T }> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const modelIndex = options.modelIndex ?? 0;
  if (modelIndex >= TEXT_MODELS.length) {
    throw new Error("All AI models failed. Try again later.");
  }

  const modelId = TEXT_MODELS[modelIndex];

  try {
    const result = await (generateObject as any)({
      model: openrouter.chat(modelId),
      schema: options.schema,
      prompt: options.prompt,
      system: options.system,
    });
    return { object: result.object as T };
  } catch (error) {
    if (isAuthError(error)) {
      throw new Error("AI service configuration error.");
    }
    if (isRetryableError(error) && modelIndex < TEXT_MODELS.length - 1) {
      return generateObjectWithFallback({
        ...options,
        modelIndex: modelIndex + 1,
      });
    }
    throw error;
  }
}

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not configured");
  return key;
}

export async function embedText(text: string): Promise<number[]> {
  const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Embedding API failed: ${response.status} ${body}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
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
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Embedding API failed: ${response.status} ${body}`);
  }

  const data = await response.json();
  return data.data
    .sort((a: any, b: any) => a.index - b.index)
    .map((d: any) => d.embedding);
}
