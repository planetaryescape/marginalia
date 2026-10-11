import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalQuery,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";
import {
  DEFAULT_MODELS,
  isTextModel,
  type ModelRole,
  TEXT_MODELS,
  type TextModel,
} from "./lib/openrouter";

const FIELDS = {
  annotations: "annotationModel",
  quick: "quickModel",
  deep: "deepModel",
} as const satisfies Record<ModelRole, keyof Doc<"userSettings">>;

async function getRow(ctx: QueryCtx) {
  return ctx.db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
    .unique();
}

function resolve(
  row: Doc<"userSettings"> | null,
): Record<ModelRole, TextModel> {
  const pick = (role: ModelRole) => {
    const chosen = row?.[FIELDS[role]];
    return isTextModel(chosen) ? chosen : DEFAULT_MODELS[role];
  };
  return {
    annotations: pick("annotations"),
    quick: pick("quick"),
    deep: pick("deep"),
  };
}

export const getModels = query({
  args: {},
  handler: async (ctx) => {
    return {
      selected: resolve(await getRow(ctx)),
      available: [...TEXT_MODELS],
    };
  },
});

export const getModelsInternal = internalQuery({
  args: {},
  handler: async (ctx) => resolve(await getRow(ctx)),
});

export const setModel = mutation({
  args: {
    role: v.union(
      v.literal("annotations"),
      v.literal("quick"),
      v.literal("deep"),
    ),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    if (!isTextModel(args.model))
      throw new Error(`Unsupported model: ${args.model}`);
    const row = await getRow(ctx);
    const patch = { [FIELDS[args.role]]: args.model, updatedAt: Date.now() };
    if (row) {
      await ctx.db.patch("userSettings", row._id, patch);
    } else {
      await ctx.db.insert("userSettings", {
        userId: DEFAULT_USER_ID,
        ...patch,
      });
    }
  },
});
