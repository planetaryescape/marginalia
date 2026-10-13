// Query-side view of a reader's AI setup: which providers they can use and the
// models they chose. Never touches key material.
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { ownerDeploymentKey } from "./ownerTransition";
import {
  type CatalogModel,
  CHATGPT_MODEL_PREFIX,
  chatgptModel,
  isChatGPTEnabled,
  type ModelProvider,
  type ModelRole,
  type Provider,
} from "./providers";

type Db = Pick<QueryCtx, "db">;

export async function savedCredentials(ctx: Db, userId: string) {
  return ctx.db
    .query("providerCredentials")
    .withIndex("by_userId_and_provider", (q) => q.eq("userId", userId))
    .take(10);
}

/**
 * The models of the reader's ChatGPT plan, or null when the server doesn't
 * offer ChatGPT or the reader has no connection that may be used for answers.
 */
export async function usableChatGPTModels(
  ctx: Db,
  userId: string,
): Promise<CatalogModel[] | null> {
  if (!isChatGPTEnabled()) return null;
  const row = await ctx.db
    .query("chatgptConnections")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (!row || row.status !== "connected" || !row.planEnabled || !row.ciphertext)
    return null;
  return (row.models ?? [])
    .filter((model) => model.id.startsWith(CHATGPT_MODEL_PREFIX))
    .map((model) =>
      chatgptModel(model.id.slice(CHATGPT_MODEL_PREFIX.length), model.name),
    );
}

export async function keyProviders(
  ctx: Db,
  userId: string,
): Promise<{ providers: Provider[]; deploymentFallback: boolean }> {
  const rows = await savedCredentials(ctx, userId);
  if (ownerDeploymentKey(userId, rows.length))
    return { providers: ["openrouter"], deploymentFallback: true };
  return {
    providers: [...new Set(rows.map((row) => row.provider))],
    deploymentFallback: false,
  };
}

/** Every provider the reader can use, with their ChatGPT plan's models. */
export async function readerProviders(
  ctx: Db,
  userId: string,
): Promise<{
  providers: ModelProvider[];
  deploymentFallback: boolean;
  chatgptModels: CatalogModel[];
}> {
  const { providers, deploymentFallback } = await keyProviders(ctx, userId);
  const chatgpt = await usableChatGPTModels(ctx, userId);
  return {
    providers: chatgpt ? [...providers, "chatgpt"] : providers,
    deploymentFallback,
    chatgptModels: chatgpt ?? [],
  };
}

const FIELDS = {
  annotations: "annotationModel",
  quick: "quickModel",
  deep: "deepModel",
} as const satisfies Record<ModelRole, keyof Doc<"userSettings">>;

export function settingsField(role: ModelRole) {
  return FIELDS[role];
}

export async function settingsRow(ctx: Db, userId: string) {
  return ctx.db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export async function savedModelChoices(
  ctx: Db,
  userId: string,
): Promise<Record<ModelRole, string | undefined>> {
  const row = await settingsRow(ctx, userId);
  return {
    annotations: row?.annotationModel,
    quick: row?.quickModel,
    deep: row?.deepModel,
  };
}
