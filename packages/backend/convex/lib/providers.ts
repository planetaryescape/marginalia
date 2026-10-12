// The AI providers a reader can connect, and the small curated set of models
// each one offers. Model IDs are namespaced ("provider:model") so the router
// knows which API to call; `model` is the provider's own ID.

export const PROVIDERS = ["openrouter", "openai", "anthropic"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_NAMES: Record<Provider, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

/** Providers that can make 1536-dimension `text-embedding-3-small` vectors, preferred first. */
export const EMBEDDING_PROVIDERS = ["openai", "openrouter"] as const;
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];

export const MODEL_ROLES = ["annotations", "quick", "deep"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export interface CatalogModel {
  id: string;
  provider: Provider;
  model: string;
  name: string;
}

function entry(provider: Provider, model: string, name: string): CatalogModel {
  return { id: `${provider}:${model}`, provider, model, name };
}

// Keep this short and current. Correct a provider's model ID here only.
export const MODEL_CATALOG: readonly CatalogModel[] = [
  entry("openrouter", "anthropic/claude-haiku-5.5", "Claude Haiku 5.5"),
  entry("openrouter", "deepseek/deepseek-v4.1-flash", "DeepSeek V4.1 Flash"),
  entry("openrouter", "openai/gpt-6-luna", "GPT-6 Luna"),
  entry("openrouter", "google/gemini-3.8-flash", "Gemini 3.8 Flash"),
  entry("openai", "gpt-6-luna", "GPT-6 Luna"),
  entry("openai", "gpt-6.1-sol", "GPT-6.1 Sol"),
  entry("anthropic", "claude-haiku-5-5", "Claude Haiku 5.5"),
  entry("anthropic", "claude-sonnet-5-5", "Claude Sonnet 5.5"),
];

// First available wins. OpenRouter's picks match the defaults before
// reader-supplied keys, so the owner's answers don't change.
const ROLE_DEFAULTS: Record<ModelRole, string[]> = {
  annotations: [
    "openrouter:anthropic/claude-haiku-5.5",
    "anthropic:claude-haiku-5-5",
    "openai:gpt-6-luna",
  ],
  quick: [
    "openrouter:deepseek/deepseek-v4.1-flash",
    "openai:gpt-6-luna",
    "anthropic:claude-haiku-5-5",
  ],
  deep: [
    "openrouter:openai/gpt-6-luna",
    "openai:gpt-6.1-sol",
    "anthropic:claude-sonnet-5-5",
  ],
};

/** Tried when the chosen model fails (rate limit, outage), first available wins. */
const FALLBACKS = [
  "openrouter:google/gemini-3.8-flash",
  "openrouter:anthropic/claude-haiku-5.5",
  "openai:gpt-6-luna",
  "anthropic:claude-haiku-5-5",
  "openai:gpt-6.1-sol",
  "anthropic:claude-sonnet-5-5",
];

export const NO_PROVIDER_MESSAGE = "Add an AI provider key in Your account.";
export const NO_EMBEDDINGS_MESSAGE =
  "Search needs an OpenAI or OpenRouter key. Add one in Your account.";

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

/** Settings saved before keys were per reader hold bare OpenRouter IDs. */
export function normalizeModelId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.includes(":") ? id : `openrouter:${id}`;
}

export function availableModels(
  providers: readonly Provider[],
): CatalogModel[] {
  return MODEL_CATALOG.filter((model) => providers.includes(model.provider));
}

/** The reader's chosen model if their keys still reach it, else a default they can use. */
export function selectModel(
  chosen: string | undefined,
  role: ModelRole,
  providers: readonly Provider[],
): CatalogModel | null {
  const available = availableModels(providers);
  const byId = (id: string | undefined) =>
    available.find((model) => model.id === id);
  return (
    byId(normalizeModelId(chosen)) ??
    ROLE_DEFAULTS[role].map(byId).find(Boolean) ??
    available[0] ??
    null
  );
}

/** The chosen model followed by a different one of the reader's own models. */
export function modelChain(
  chosen: string | undefined,
  role: ModelRole,
  providers: readonly Provider[],
): CatalogModel[] {
  const primary = selectModel(chosen, role, providers);
  if (!primary) return [];
  const available = availableModels(providers);
  const fallback = [
    ...FALLBACKS.map((id) => available.find((model) => model.id === id)),
    ...available,
  ].find((model) => model && model.id !== primary.id);
  return fallback ? [primary, fallback] : [primary];
}

export function embeddingProvider(
  providers: readonly Provider[],
): EmbeddingProvider | null {
  return EMBEDDING_PROVIDERS.find((p) => providers.includes(p)) ?? null;
}

/**
 * A loggable provider failure. Auth errors can quote part of the key that was
 * sent, so their bodies are dropped.
 */
export function providerFailure(status: number, body: string): Error {
  if (status === 401 || status === 403)
    return new Error(`Provider refused the key (${status})`);
  return new Error(`Provider returned ${status}: ${body.slice(0, 500)}`);
}
