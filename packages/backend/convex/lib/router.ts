// Resolves which provider, model and key serve a library's AI request. Keys
// come only from that library's own saved credentials (plus the owner's
// transition key); a request never falls back to another reader's key. A
// ChatGPT plan, when the server offers it, is the reader's own connection too.
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { ChatGPTRequestError } from "./chatgptResponses";
import { chatgptAccessToken } from "./chatgptTokens";
import { type EmbeddingTarget, embedTexts } from "./embeddings";
import { decryptProviderKey } from "./providerKeys";
import {
  type CatalogModel,
  embeddingProvider,
  type ModelProvider,
  type ModelRole,
  modelChain,
} from "./providers";

/** For a ChatGPT model, `apiKey` is the reader's fresh plan access token. */
export type ProviderTarget = CatalogModel & { apiKey: string };

export interface ReaderAI {
  providers: ModelProvider[];
  /** The models to try in order for a role; empty when the reader has no key. */
  chain(role: ModelRole): ProviderTarget[];
  /** Where to embed text, or null without an OpenAI or OpenRouter key. */
  embedder(): EmbeddingTarget | null;
  /** Records what a failed ChatGPT request says about the reader's connection. */
  noteFailure(error: unknown): Promise<void>;
}

type Runner = Pick<ActionCtx, "runQuery" | "runMutation">;

export async function loadReaderAI(
  ctx: Runner,
  userId: string,
  { text = true }: { text?: boolean } = {},
): Promise<ReaderAI> {
  const routing = await ctx.runQuery(internal.providerCredentials.routing, {
    userId,
  });
  const keys = new Map<ModelProvider, string>();
  for (const row of routing.credentials) {
    try {
      keys.set(row.provider, await decryptProviderKey({ ...row, userId }));
    } catch {
      // A row that won't open (moved, tampered, or a rotated server key) is unusable
      console.error(`Couldn't open a saved ${row.provider} key`);
    }
  }

  // Embedding-only callers don't need the plan, so they never refresh its token
  const chatgptModels = routing.chatgptModels ?? [];
  if (text && routing.chatgptModels) {
    try {
      const token = await chatgptAccessToken(ctx, userId);
      if (token) keys.set("chatgpt", token);
    } catch (error) {
      console.error("ChatGPT is unavailable for this request", error);
    }
  }
  const providers = [...keys.keys()];

  return {
    providers,
    chain: (role) =>
      modelChain(routing.models[role], role, providers, chatgptModels).map(
        (model) => ({
          ...model,
          apiKey: keys.get(model.provider) ?? "",
        }),
      ),
    embedder: () => {
      const provider = embeddingProvider(providers);
      const apiKey = provider && keys.get(provider);
      return provider && apiKey ? { provider, apiKey } : null;
    },
    noteFailure: async (error) => {
      if (!(error instanceof ChatGPTRequestError)) return;
      if (error.kind === "reconnect")
        await ctx.runMutation(internal.chatgpt.markReconnect, { userId });
      else if (error.kind === "not_eligible")
        await ctx.runMutation(internal.chatgpt.markPlanUnavailable, { userId });
    },
  };
}

/**
 * Embeds with the library's own key. Returns null, without calling anyone,
 * when the library has no embedding-capable key, so the write can go ahead
 * unembedded and be backfilled later.
 */
export async function embedForLibrary(
  ctx: Runner,
  userId: string,
  texts: string[],
): Promise<number[][] | null> {
  const target = (await loadReaderAI(ctx, userId, { text: false })).embedder();
  if (!target) return null;
  return embedTexts(target, texts);
}
