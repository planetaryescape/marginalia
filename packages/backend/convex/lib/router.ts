// Resolves which provider, model and key serve a library's AI request. Keys
// come only from that library's own saved credentials (plus the owner's
// transition key); a request never falls back to another reader's key.
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { type EmbeddingTarget, embedTexts } from "./embeddings";
import { ownerDeploymentKey } from "./ownerTransition";
import { decryptProviderKey } from "./providerKeys";
import {
  type CatalogModel,
  embeddingProvider,
  type ModelRole,
  modelChain,
  type Provider,
} from "./providers";

export type ProviderTarget = CatalogModel & { apiKey: string };

export interface ReaderAI {
  providers: Provider[];
  /** The models to try in order for a role; empty when the reader has no key. */
  chain(role: ModelRole): ProviderTarget[];
  /** Where to embed text, or null without an OpenAI or OpenRouter key. */
  embedder(): EmbeddingTarget | null;
}

type Runner = Pick<ActionCtx, "runQuery">;

export async function loadReaderAI(
  ctx: Runner,
  userId: string,
): Promise<ReaderAI> {
  const routing = await ctx.runQuery(internal.providerCredentials.routing, {
    userId,
  });
  const keys = new Map<Provider, string>();
  for (const row of routing.credentials) {
    try {
      keys.set(row.provider, await decryptProviderKey({ ...row, userId }));
    } catch {
      // A row that won't open (moved, tampered, or a rotated server key) is unusable
      console.error(`Couldn't open a saved ${row.provider} key`);
    }
  }
  const deploymentKey = ownerDeploymentKey(userId, routing.credentials.length);
  if (deploymentKey) keys.set("openrouter", deploymentKey);
  const providers = [...keys.keys()];

  return {
    providers,
    chain: (role) =>
      modelChain(routing.models[role], role, providers).map((model) => ({
        ...model,
        apiKey: keys.get(model.provider) ?? "",
      })),
    embedder: () => {
      const provider = embeddingProvider(providers);
      const apiKey = provider && keys.get(provider);
      return provider && apiKey ? { provider, apiKey } : null;
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
  const target = (await loadReaderAI(ctx, userId)).embedder();
  if (!target) return null;
  return embedTexts(target, texts);
}
