// The AI providers a reader can connect, and the small curated set of models
// each one offers. Model IDs are namespaced ("provider:model") so the router
// knows which API to call; `model` is the provider's own ID.

/** Providers a reader connects with an API key. */
export const PROVIDERS = ["openrouter", "openai", "anthropic"] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * Every provider a model can come from. "chatgpt" is a reader's ChatGPT plan,
 * connected with Sign in with ChatGPT; it exists only when the server enables
 * it (see isChatGPTEnabled) and its models come from the reader's account.
 */
export type ModelProvider = Provider | "chatgpt";

export const PROVIDER_NAMES: Record<ModelProvider, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  chatgpt: "ChatGPT",
};

/**
 * ChatGPT plan usage needs OpenAI's approval of this hosted app. Until the
 * deployment sets all three values it stays off: no models, no routes, no UI.
 */
export function isChatGPTEnabled(): boolean {
  if (process.env.CHATGPT_PLAN_ENABLED?.trim() !== "true") return false;
  if (!process.env.CHATGPT_CLIENT_ID?.trim()) return false;
  const redirect = process.env.CHATGPT_REDIRECT_URI?.trim();
  if (!redirect) return false;
  try {
    return new URL(redirect).protocol === "https:";
  } catch {
    return false;
  }
}

export const CHATGPT_MODEL_PREFIX = "chatgpt:";

export function chatgptModel(slug: string, name: string): CatalogModel {
  return {
    id: `${CHATGPT_MODEL_PREFIX}${slug}`,
    provider: "chatgpt",
    model: slug,
    name,
  };
}

/** Providers that can make 1536-dimension `text-embedding-3-small` vectors, preferred first. */
export const EMBEDDING_PROVIDERS = ["openai", "openrouter"] as const;
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];

export const MODEL_ROLES = ["annotations", "quick", "deep"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export interface CatalogModel {
  id: string;
  provider: ModelProvider;
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
  // Stronger and slower, for readers who want depth over speed
  entry("openrouter", "anthropic/claude-sonnet-5.5", "Claude Sonnet 5.5"),
  // OpenRouter has no GPT-6 Terra yet; this alias always runs the newest
  // Terra (GPT-5.6 Terra on 2026-10-16) and moves up when 6 Terra lands
  entry("openrouter", "~openai/gpt-terra-latest", "GPT Terra (latest)"),
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
    "chatgpt:gpt-6-luna",
  ],
  quick: [
    "openrouter:deepseek/deepseek-v4.1-flash",
    "openai:gpt-6-luna",
    "anthropic:claude-haiku-5-5",
    "chatgpt:gpt-6-luna",
  ],
  deep: [
    "openrouter:openai/gpt-6-luna",
    "openai:gpt-6.1-sol",
    "anthropic:claude-sonnet-5-5",
    "chatgpt:gpt-6.1-sol",
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

/**
 * The models the reader's providers reach. `chatgpt` holds the models their
 * ChatGPT plan lists, used only while "chatgpt" is among their providers.
 */
export function availableModels(
  providers: readonly ModelProvider[],
  chatgpt: readonly CatalogModel[] = [],
): CatalogModel[] {
  return [
    ...MODEL_CATALOG.filter((model) => providers.includes(model.provider)),
    ...(providers.includes("chatgpt") ? chatgpt : []),
  ];
}

/** The reader's chosen model if their keys still reach it, else a default they can use. */
export function selectModel(
  chosen: string | undefined,
  role: ModelRole,
  providers: readonly ModelProvider[],
  chatgpt: readonly CatalogModel[] = [],
): CatalogModel | null {
  const available = availableModels(providers, chatgpt);
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
  providers: readonly ModelProvider[],
  chatgpt: readonly CatalogModel[] = [],
): CatalogModel[] {
  const primary = selectModel(chosen, role, providers, chatgpt);
  if (!primary) return [];
  const available = availableModels(providers, chatgpt);
  const fallback = [
    ...FALLBACKS.map((id) => available.find((model) => model.id === id)),
    ...available,
  ].find((model) => model && model.id !== primary.id);
  return fallback ? [primary, fallback] : [primary];
}

export function embeddingProvider(
  providers: readonly ModelProvider[],
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

/**
 * Whether a call failed because the provider refused the reader's key (401 or
 * 403): from an embeddings request, a model call, or the model fallback's own
 * "didn't accept your saved key" error. Such a failure is the key's, not the
 * work's, so it pauses indexing instead of spending a try.
 */
export function isAuthFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { statusCode?: unknown }).statusCode;
  if (status === 401 || status === 403) return true;
  const data = (error as { data?: unknown }).data;
  const message =
    typeof data === "string" ? data : (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /refused the key|didn't accept your saved key/.test(message)
  );
}
