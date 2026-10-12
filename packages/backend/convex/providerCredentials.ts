import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./functions";
import {
  cleanProviderKey,
  encryptProviderKey,
  validateProviderKey,
} from "./lib/providerKeys";
import { embeddingProvider } from "./lib/providers";
import {
  readerProviders,
  savedCredentials,
  savedModelChoices,
} from "./lib/readerAI";

const provider = v.union(
  v.literal("openrouter"),
  v.literal("openai"),
  v.literal("anthropic"),
);

/** What the browser may know about saved keys: never the key or its ciphertext. */
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      provider,
      last4: v.string(),
      validatedAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) =>
    (await savedCredentials(ctx, ctx.readerId)).map((row) => ({
      provider: row.provider,
      last4: row.last4,
      validatedAt: row.validatedAt,
      updatedAt: row.updatedAt,
    })),
});

export const capabilities = query({
  args: {},
  returns: v.object({
    text: v.boolean(),
    embeddings: v.boolean(),
    providers: v.array(provider),
    deploymentFallback: v.boolean(),
  }),
  handler: async (ctx) => {
    const { providers, deploymentFallback } = await readerProviders(
      ctx,
      ctx.readerId,
    );
    return {
      text: providers.length > 0,
      embeddings: embeddingProvider(providers) !== null,
      providers,
      deploymentFallback,
    };
  },
});

export const save = action({
  args: { provider, apiKey: v.string() },
  returns: v.object({ provider, last4: v.string() }),
  handler: async (ctx, args) => {
    const key = cleanProviderKey(args.apiKey);
    // Sealing first means a server without its encryption key never sends
    // the reader's key anywhere, and never stores it in plain text
    const sealed = await encryptProviderKey(key, ctx.readerId, args.provider);
    await validateProviderKey(args.provider, key);
    const last4 = key.slice(-4);
    await ctx.runMutation(internal.providerCredentials.store, {
      userId: ctx.readerId,
      provider: args.provider,
      ...sealed,
      last4,
    });
    return { provider: args.provider, last4 };
  },
});

export const store = internalMutation({
  args: {
    userId: v.string(),
    provider,
    ciphertext: v.string(),
    iv: v.string(),
    last4: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("providerCredentials")
      .withIndex("by_userId_and_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", args.provider),
      )
      .unique();
    const fields = {
      ciphertext: args.ciphertext,
      iv: args.iv,
      last4: args.last4,
      updatedAt: now,
      validatedAt: now,
    };
    if (existing)
      await ctx.db.patch("providerCredentials", existing._id, fields);
    else
      await ctx.db.insert("providerCredentials", {
        userId: args.userId,
        provider: args.provider,
        createdAt: now,
        ...fields,
      });
    return null;
  },
});

export const remove = mutation({
  args: { provider },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("providerCredentials")
      .withIndex("by_userId_and_provider", (q) =>
        q.eq("userId", ctx.readerId).eq("provider", args.provider),
      )
      .unique();
    if (row) await ctx.db.delete("providerCredentials", row._id);
    return null;
  },
});

/**
 * Sealed keys and model choices for the provider router (lib/router.ts).
 * Internal only: the ciphertext leaves the database solely for actions that
 * decrypt it to call that provider.
 */
export const routing = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => ({
    credentials: (await savedCredentials(ctx, args.userId)).map((row) => ({
      provider: row.provider,
      ciphertext: row.ciphertext,
      iv: row.iv,
    })),
    models: await savedModelChoices(ctx, args.userId),
  }),
});
