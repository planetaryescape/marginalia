"use node";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { ConvexError } from "convex/values";
import type { ZodType } from "zod";
import { PROVIDER_NAMES } from "./providers";
import type { ProviderTarget } from "./router";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** An AI SDK model that calls the target's provider with the reader's own key. */
function languageModel(target: ProviderTarget) {
  switch (target.provider) {
    case "openrouter":
      return createOpenAI({
        baseURL: OPENROUTER_BASE_URL,
        apiKey: target.apiKey,
        headers: { "X-Title": "Marginalia" },
      }).chat(target.model);
    case "openai":
      return createOpenAI({ apiKey: target.apiKey }).chat(target.model);
    case "anthropic":
      return createAnthropic({ apiKey: target.apiKey })(target.model);
  }
}

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const status = (error as Record<string, unknown>).statusCode;
    if (typeof status === "number") return status;
  }
  return undefined;
}

function isAuthError(error: unknown): boolean {
  const status = statusOf(error);
  return status === 401 || status === 403;
}

function isRetryableError(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 429 || (status && status >= 500 && status < 600)) return true;
  const message =
    error && typeof error === "object"
      ? (error as Record<string, unknown>).message
      : undefined;
  return typeof message === "string" && message.includes("429");
}

export async function generateObjectWithFallback<T>(options: {
  schema: ZodType<T, any, any>;
  prompt?: string;
  system?: string;
  /** The reader's own models, tried in order after a retryable failure. */
  targets: ProviderTarget[];
  /** Bound output reservation for tasks that need only a short response. */
  maxOutputTokens?: number;
}): Promise<{ object: T; modelId: string }> {
  if (!options.targets.length)
    throw new Error("No AI model is available for this library");
  let lastError: unknown;
  for (const [index, target] of options.targets.entries()) {
    const isLast = index === options.targets.length - 1;
    try {
      const result = await (generateObject as any)({
        model: languageModel(target),
        schema: options.schema,
        prompt: options.prompt,
        system: options.system,
        maxOutputTokens: options.maxOutputTokens,
      });
      return { object: result.object as T, modelId: target.id };
    } catch (error) {
      lastError = error;
      // A refused key may belong to one of the reader's providers; another may still work
      if (isAuthError(error)) {
        if (isLast)
          throw new ConvexError(
            `${PROVIDER_NAMES[target.provider]} didn't accept your saved key. Update it in Your account.`,
          );
        continue;
      }
      if (isRetryableError(error) && !isLast) continue;
      throw error;
    }
  }
  throw lastError;
}
