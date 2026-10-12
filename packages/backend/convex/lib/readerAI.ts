// Query-side view of a reader's AI setup: which providers they can use and the
// models they chose. Never touches key material.
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { ownerDeploymentKey } from "./ownerTransition";
import type { ModelRole, Provider } from "./providers";

type Db = Pick<QueryCtx, "db">;

export async function savedCredentials(ctx: Db, userId: string) {
  return ctx.db
    .query("providerCredentials")
    .withIndex("by_userId_and_provider", (q) => q.eq("userId", userId))
    .take(10);
}

export async function readerProviders(
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
