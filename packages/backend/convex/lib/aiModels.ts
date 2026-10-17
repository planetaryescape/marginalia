"use node";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, NoObjectGeneratedError } from "ai";
import { ConvexError } from "convex/values";
import { toJSONSchema, type ZodType } from "zod";
import {
  ChatGPTRequestError,
  completeResponses,
  isTerminalChatGPTError,
} from "./chatgptResponses";
import { PROVIDER_NAMES, type Provider } from "./providers";
import type { ProviderTarget } from "./router";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** An AI SDK model that calls the target's provider with the reader's own key. */
function languageModel(target: ProviderTarget & { provider: Provider }) {
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
  /** Told about each failure, so a ChatGPT connection can record its state. */
  onFailure?: (error: unknown) => Promise<void>;
}): Promise<{ object: T; modelId: string }> {
  if (!options.targets.length)
    throw new Error("No AI model is available for this library");
  let lastError: unknown;
  for (const [index, target] of options.targets.entries()) {
    const isLast = index === options.targets.length - 1;
    if (target.provider === "chatgpt") {
      try {
        return {
          object: await generateWithChatGPT(target, options),
          modelId: target.id,
        };
      } catch (error) {
        lastError = error;
        await options.onFailure?.(error).catch(() => {});
        // The plan's own limits are the reader's to see, not a reason to
        // quietly spend one of their API keys instead
        if (isTerminalChatGPTError(error))
          throw new ConvexError(error.readerMessage);
        if (!isLast) {
          console.error(`${target.id} failed`, error);
          continue;
        }
        if (error instanceof ChatGPTRequestError)
          throw new ConvexError(error.readerMessage);
        throw error;
      }
    }
    try {
      return {
        object: await generateParsedObject<T>(
          target.id,
          languageModel({ ...target, provider: target.provider }),
          options,
        ),
        modelId: target.id,
      };
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
      if (
        (isRetryableError(error) || NoObjectGeneratedError.isInstance(error)) &&
        !isLast
      )
        continue;
      throw error;
    }
  }
  throw lastError;
}

/**
 * One model call, asked a second time when its answer doesn't parse. A model
 * now and then falls into repeating words inside a string until it runs out of
 * tokens; that is a sampling accident, so the same model usually answers
 * cleanly when asked again.
 */
async function generateParsedObject<T>(
  modelId: string,
  model: ReturnType<typeof languageModel>,
  options: {
    schema: ZodType<T, any, any>;
    prompt?: string;
    system?: string;
    maxOutputTokens?: number;
  },
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await (generateObject as any)({
        model,
        schema: options.schema,
        prompt: options.prompt,
        system: options.system,
        maxOutputTokens: options.maxOutputTokens,
      });
      return result.object as T;
    } catch (error) {
      if (
        attempt >= PARSE_ATTEMPTS ||
        !NoObjectGeneratedError.isInstance(error)
      )
        throw error;
      console.warn(`${modelId} answered unparseably; asking again`);
    }
  }
}

const PARSE_ATTEMPTS = 2;

/**
 * Plan usage streams through the Responses API with no output cap, so the
 * schema travels in the instructions and the answer is checked here.
 */
async function generateWithChatGPT<T>(
  target: ProviderTarget,
  options: { schema: ZodType<T, any, any>; prompt?: string; system?: string },
): Promise<T> {
  const content = await completeResponses({
    accessToken: target.apiKey,
    model: target.model,
    messages: [
      ...(options.system
        ? [{ role: "system" as const, content: options.system }]
        : []),
      { role: "user", content: options.prompt ?? "" },
    ],
    jsonSchema: toJSONSchema(options.schema as any),
  });
  return options.schema.parse(JSON.parse(content));
}
