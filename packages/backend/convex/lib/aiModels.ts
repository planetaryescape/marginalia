"use node";
import { generateObject } from "ai";
import type { ZodType } from "zod";
import { openrouter, type TextModel } from "./openrouter";

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
  /** Tried in order; later models are used only after a retryable failure. */
  models: TextModel[];
  modelIndex?: number;
}): Promise<{ object: T; modelId: TextModel }> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const modelIndex = options.modelIndex ?? 0;
  if (modelIndex >= options.models.length) {
    throw new Error("All AI models failed. Try again later.");
  }

  const modelId = options.models[modelIndex];

  try {
    const result = await (generateObject as any)({
      model: openrouter.chat(modelId),
      schema: options.schema,
      prompt: options.prompt,
      system: options.system,
    });
    return { object: result.object as T, modelId };
  } catch (error) {
    if (isAuthError(error)) {
      throw new Error("AI service configuration error.");
    }
    if (isRetryableError(error) && modelIndex < options.models.length - 1) {
      return generateObjectWithFallback({
        ...options,
        modelIndex: modelIndex + 1,
      });
    }
    throw error;
  }
}

export { embedText, embedTexts } from "./embeddings";
