import { createOpenAI } from "@ai-sdk/openai";

export const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Only these can be chosen in settings: the companion endpoint is public, so
// the model list is an allowlist rather than a free-text OpenRouter ID.
export const TEXT_MODELS = [
  "anthropic/claude-haiku-5.5",
  "deepseek/deepseek-v4.1-flash",
  "openai/gpt-6-luna",
  "google/gemini-3.8-flash",
] as const;

export type TextModel = (typeof TEXT_MODELS)[number];

export const MODEL_ROLES = ["annotations", "quick", "deep"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export const DEFAULT_MODELS: Record<ModelRole, TextModel> = {
  annotations: "anthropic/claude-haiku-5.5",
  quick: "deepseek/deepseek-v4.1-flash",
  deep: "openai/gpt-6-luna",
};

/** Tried when the chosen model fails (rate limit, outage). */
export const FALLBACK_MODEL: TextModel = "google/gemini-3.8-flash";
const SECOND_FALLBACK: TextModel = "anthropic/claude-haiku-5.5";

export function isTextModel(id: string | undefined): id is TextModel {
  return TEXT_MODELS.includes(id as TextModel);
}

/** The chosen model followed by a different model to fall back to. */
export function modelChain(
  chosen: string | undefined,
  role: ModelRole,
): TextModel[] {
  const primary = isTextModel(chosen) ? chosen : DEFAULT_MODELS[role];
  return [
    primary,
    primary === FALLBACK_MODEL ? SECOND_FALLBACK : FALLBACK_MODEL,
  ];
}
