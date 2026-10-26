// Resolves which provider, model and key serve a library's AI request. Keys
// come only from that library's own saved credentials (plus the owner's
// transition key); a request never falls back to another reader's key. A
// ChatGPT plan, when the server offers it, is the reader's own connection too.

import { ConvexError } from "convex/values";
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
import type { TargetCredential } from "./providerTarget";

/** For a ChatGPT model, `apiKey` is the reader's fresh plan access token. */
export type ProviderTarget = CatalogModel & TargetCredential;

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
  {
    text = true,
    signal,
  }: {
    text?: boolean;
    roles?: ModelRole[];
    signal?: AbortSignal;
  } = {},
): Promise<ReaderAI> {
  signal?.throwIfAborted();
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
  const availableProviders: ModelProvider[] = [
    ...keys.keys(),
    ...(routing.chatgptModels ? ["chatgpt" as const] : []),
  ];
  // Deliberately not tied to caller cancellation: rotating refresh tokens must
  // finish publishing under their lease even when the caller presses Stop.
  let planToken: Promise<string> | undefined;
  const resolvePlan = () => {
    planToken ??= chatgptAccessToken(ctx, userId)
      .catch((error) => {
        if (error instanceof ConvexError)
          throw new ChatGPTRequestError(401, "invalid_client");
        throw error;
      })
      .then((token) => {
        if (!token) throw new ChatGPTRequestError(401, "invalid_user");
        return token;
      });
    return planToken;
  };
  const providers = text ? availableProviders : [...keys.keys()];
  signal?.throwIfAborted();

  return {
    providers,
    chain: (role) =>
      modelChain(routing.models[role], role, providers, chatgptModels).map(
        (model) => {
          const target: ProviderTarget = {
            ...model,
            apiKey: keys.get(model.provider) ?? "",
          };
          if (model.provider === "chatgpt") target.resolveApiKey = resolvePlan;
          return target;
        },
      ),
    embedder: () => {
      const provider = embeddingProvider(providers);
      const apiKey = provider && keys.get(provider);
      if (!provider || !apiKey) return null;
      const target: EmbeddingTarget = { provider, apiKey };
      if (signal) target.signal = signal;
      return target;
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
