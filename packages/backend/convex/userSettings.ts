import { ConvexError, v } from "convex/values";
import { mutation, query } from "./functions";
import {
  availableModels,
  MODEL_ROLES,
  type ModelRole,
  selectModel,
} from "./lib/providers";
import {
  readerProviders,
  savedModelChoices,
  settingsField,
  settingsRow,
} from "./lib/readerAI";

const role = v.union(
  v.literal("annotations"),
  v.literal("quick"),
  v.literal("deep"),
);

/**
 * The reader's model per role, from the models their own keys reach. A choice
 * whose key was removed falls back to a default; null means no key at all.
 */
export const getModels = query({
  args: {},
  returns: v.object({
    selected: v.object({
      annotations: v.union(v.string(), v.null()),
      quick: v.union(v.string(), v.null()),
      deep: v.union(v.string(), v.null()),
    }),
    available: v.array(
      v.object({ id: v.string(), name: v.string(), provider: v.string() }),
    ),
  }),
  handler: async (ctx) => {
    const { providers } = await readerProviders(ctx, ctx.readerId);
    const chosen = await savedModelChoices(ctx, ctx.readerId);
    const selected = Object.fromEntries(
      MODEL_ROLES.map((r) => [
        r,
        selectModel(chosen[r], r, providers)?.id ?? null,
      ]),
    ) as Record<ModelRole, string | null>;
    return {
      selected,
      available: availableModels(providers).map(({ id, name, provider }) => ({
        id,
        name,
        provider,
      })),
    };
  },
});

export const setModel = mutation({
  args: { role, model: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { providers } = await readerProviders(ctx, ctx.readerId);
    if (!availableModels(providers).some((m) => m.id === args.model))
      throw new ConvexError(
        "That model isn't available with your saved keys. Add its provider in Your account.",
      );
    const row = await settingsRow(ctx, ctx.readerId);
    const patch = {
      [settingsField(args.role)]: args.model,
      updatedAt: Date.now(),
    };
    if (row) {
      await ctx.db.patch("userSettings", row._id, patch);
    } else {
      await ctx.db.insert("userSettings", {
        userId: ctx.readerId,
        ...patch,
      });
    }
    return null;
  },
});
