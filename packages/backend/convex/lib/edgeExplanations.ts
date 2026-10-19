import { defineTable } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { cleanReason, pairFingerprint, pairKey, snippet } from "./ideaGraph";
import { articleTitle, type LoadedNode, loadNode } from "./ideaNodes";
import { pairReasons } from "./ideaSignals";
import { availableModels, modelChain } from "./providers";
import {
  savedCredentials,
  savedModelChoices,
  usableChatGPTModels,
} from "./readerAI";
import { metadataLibraryActive, metadataLibraryRetained } from "./shelfCounts";
import { sha256Hex } from "./tokens";

export const EDGE_LEASE_MS = 20 * 60_000;
export const EDGE_ATTEMPTS = 3;
export const EDGE_JOIN_READS = 30;
export const EDGE_JOIN_MS = 2000;
export const EDGE_TOKENS = 160;
export const EDGE_REASON_DESCRIPTION =
  "One sentence, under 35 words, saying what connects the two.";
export function validEdgeReason(text: string) {
  const reason = cleanReason(text);
  return reason && reason.split(/\s+/).length < 35 ? reason : null;
}
export const EDGE_SYSTEM = `You sit beside a reader looking at two of their own ideas that the app has put near each other.
In one sentence of under 35 words, say what connects them: the shared subject, the shared claim, or the way they pull against each other.
Describe the link; don't judge it, advise, summarise either idea or draw a conclusion, and don't speak as the reader. Use only the two texts given. If they share little, say what little they share.`;

export const edgeGeneration = v.object({
  id: v.id("edgeExplanationState"),
  run: v.number(),
});
export const edgeDispatchTarget = v.object({
  provider: v.string(),
  id: v.string(),
  model: v.string(),
});
export const edgeExplanationState = defineTable({
  userId: v.string(),
  pair: v.string(),
  a: v.string(),
  b: v.string(),
  aVia: v.optional(v.string()),
  bVia: v.optional(v.string()),
  aArticleId: v.optional(v.id("articles")),
  bArticleId: v.optional(v.id("articles")),
  input: v.string(),
  routing: v.string(),
  run: v.number(),
  status: v.union(
    v.literal("running"),
    v.literal("complete"),
    v.literal("failed"),
  ),
  attempts: v.number(),
  leaseUntil: v.number(),
  dispatchRouting: v.optional(v.string()),
  dispatchTargets: v.optional(v.array(edgeDispatchTarget)),
})
  .index("by_user_pair", ["userId", "pair"])
  .index("by_userId", ["userId"])
  .index("by_user_a_aVia", ["userId", "a", "aVia"])
  .index("by_user_b_bVia", ["userId", "b", "bVia"])
  .index("by_user_aArticleId", ["userId", "aArticleId"])
  .index("by_user_bArticleId", ["userId", "bArticleId"]);

type Db = Pick<QueryCtx, "db">;
export const edgeRequest = {
  userId: v.string(),
  a: v.string(),
  b: v.string(),
  aVia: v.optional(v.string()),
  bVia: v.optional(v.string()),
};
export interface EdgeRequest {
  userId: string;
  a: string;
  b: string;
  aVia?: string;
  bVia?: string;
}
export const edgeState = (ctx: Db, userId: string, pair: string) =>
  ctx.db
    .query("edgeExplanationState")
    .withIndex("by_user_pair", (q) => q.eq("userId", userId).eq("pair", pair))
    .unique();

/** No plaintext keys in persisted identity. Credential rotation fences dispatch,
 * but access-token refresh does not change semantic quick routing. */
export function edgeRoutingIdentity(snapshot: unknown) {
  // JSON's property-list replacer is a canonical whitelist, including nested
  // objects. Deep/annotation choices and display names do not define quick work.
  return sha256Hex(
    JSON.stringify(snapshot, [
      "credentials",
      "provider",
      "ciphertext",
      "iv",
      "models",
      "quick",
      "chatgptModels",
      "id",
      "model",
    ]),
  );
}

export function edgeResolvedRoutingIdentity(
  snapshot: string,
  targets: readonly { provider: string; id: string; model: string }[],
) {
  return sha256Hex(
    JSON.stringify([
      snapshot,
      targets.map((target) => [target.provider, target.id, target.model]),
    ]),
  );
}

export async function edgeRouting(ctx: Db, userId: string) {
  const [models, credentials, chatgptModels] = await Promise.all([
    savedModelChoices(ctx, userId),
    savedCredentials(ctx, userId),
    usableChatGPTModels(ctx, userId),
  ]);
  const providers = [...new Set(credentials.map((r) => r.provider))];
  const targets = modelChain(
    models.quick,
    "quick",
    chatgptModels ? [...providers, "chatgpt"] : providers,
    chatgptModels ?? [],
  );
  const snapshot = await edgeRoutingIdentity({
    credentials: credentials.map((r) => ({
      provider: r.provider,
      ciphertext: r.ciphertext,
      iv: r.iv,
    })),
    models,
    chatgptModels,
  });
  const available = availableModels(
    chatgptModels ? [...providers, "chatgpt"] : providers,
    chatgptModels ?? [],
  );
  // This is the current catalog/snapshot fence, not a prediction that every
  // saved key can decrypt. The actual ordered chain is bound before dispatch.
  const identity = await edgeResolvedRoutingIdentity(snapshot, available);
  return { identity, snapshot, targets: targets.map((m) => m.id), available };
}

export function edgeTargetAvailable(
  target: { provider: string; id: string; model: string },
  available: readonly { provider: string; id: string; model: string }[],
) {
  return available.some(
    (current) =>
      current.provider === target.provider &&
      current.id === target.id &&
      current.model === target.model,
  );
}

export async function currentEdge(ctx: Db, args: EdgeRequest) {
  if (!(await metadataLibraryActive(ctx, args.userId))) return null;
  // Canonicalize before assigning the two prompt labels, including each via.
  const ordered =
    args.a < args.b
      ? ([
          [args.a, args.aVia],
          [args.b, args.bVia],
        ] as const)
      : ([
          [args.b, args.bVia],
          [args.a, args.aVia],
        ] as const);
  const nodes = await Promise.all(
    ordered.map(([key, via]) =>
      loadNode(ctx, args.userId, key, undefined, false, via),
    ),
  );
  const [a, b] = nodes;
  if (!a || !b || a.key === b.key) return null;
  const titles = await Promise.all(
    [a, b].map((n) =>
      n.articleId ? articleTitle(ctx, args.userId, n.articleId) : null,
    ),
  );
  // A surviving child is not proof its parent still exists or belongs here.
  if ([a, b].some((n, i) => n.articleId && titles[i] === null)) return null;
  const forModel = (n: LoadedNode, title: string | null) => ({
    kind: n.kind,
    text: snippet(n.text, 600),
    article: title ? snippet(title, 120) : null,
  });
  const one = forModel(a, titles[0]);
  const two = forModel(b, titles[1]);
  const describe = (n: typeof one, label: string) =>
    `${label} (${n.kind}${n.article ? `, from “${n.article}”` : ""}):\n${n.text}`;
  const prompt = `${describe(one, "Idea one")}\n\n${describe(two, "Idea two")}`;
  const routing = await edgeRouting(ctx, args.userId);
  // Full source equality also detects Unicode/tail changes outside the bounded
  // prompt. This is exact current equality, NOT a global monotonic ABA stamp.
  const sources = await Promise.all(
    [a, b].map(async (n, i) => [
      n.key,
      n.id,
      n.articleId ?? null,
      await sha256Hex(n.text),
      titles[i],
    ]),
  );
  const input = await sha256Hex(
    JSON.stringify([
      "edge-explanation-v1",
      args.userId,
      sources,
      EDGE_SYSTEM,
      prompt,
      EDGE_TOKENS,
      ["reason", "string", EDGE_REASON_DESCRIPTION],
      routing.identity,
    ]),
  );
  const pair = pairKey(a.key, b.key);
  // The historical display/cache key uses a delimiter which can also occur in
  // vault paths. Claims must distinguish exact key tuples, not that delimiter.
  const claimPair = await sha256Hex(JSON.stringify([a.key, b.key]));
  const cached = await ctx.db
    .query("edgeReasons")
    .withIndex("by_user_pair", (q) =>
      q.eq("userId", args.userId).eq("pair", pair),
    )
    .unique();
  const fingerprint = pairFingerprint(
    { key: a.key, text: snippet(a.text, 600) },
    { key: b.key, text: snippet(b.text, 600) },
  );
  return {
    pair,
    claimPair,
    input,
    routing,
    fingerprint,
    prompt,
    a: one,
    b: two,
    parents: { aArticleId: a.articleId, bArticleId: b.articleId },
    request: {
      userId: args.userId,
      a: a.key,
      b: b.key,
      aVia: a.kind === "vault" ? a.id : undefined,
      bVia: b.kind === "vault" ? b.id : undefined,
    },
    structural: await pairReasons(ctx, args.userId, a, b),
    // Historical rows intentionally retain the old 600-character policy. New
    // rows use exact identity, even if their claim has subsequently been purged.
    cached:
      cached &&
      (cached.input === undefined
        ? cached.fingerprint === fingerprint
        : cached.input === input)
        ? cached
        : null,
  };
}

export async function purgeEdgeExplanations(ctx: MutationCtx, userId: string) {
  if (await metadataLibraryRetained(ctx, userId))
    throw new Error("Cannot purge a retained library");
  const rows = await ctx.db
    .query("edgeExplanationState")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(32);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

/** Source-deletion cleanup reads at most 32 compact claims, never source bodies
 * or cache rows. Return true to continue in a fresh transaction. Vault reindex
 * only removes claims which actually selected the deleted passage. */
export async function pruneEdgeClaims(
  ctx: MutationCtx,
  args: {
    userId: string;
    node?: string;
    via?: string;
    articleId?: Id<"articles">;
  },
) {
  const { userId, node, via, articleId } = args;
  if (!articleId && !node) throw new Error("Missing edge source");
  if (articleId) {
    const article = await ctx.db.get(articleId);
    if (article?.userId === userId) return false;
  }
  const left = articleId
    ? ctx.db
        .query("edgeExplanationState")
        .withIndex("by_user_aArticleId", (q) =>
          q.eq("userId", userId).eq("aArticleId", articleId),
        )
    : via
      ? ctx.db.query("edgeExplanationState").withIndex("by_user_a_aVia", (q) =>
          q
            .eq("userId", userId)
            .eq("a", node ?? "")
            .eq("aVia", via),
        )
      : ctx.db
          .query("edgeExplanationState")
          .withIndex("by_user_a_aVia", (q) =>
            q.eq("userId", userId).eq("a", node ?? ""),
          );
  const right = articleId
    ? ctx.db
        .query("edgeExplanationState")
        .withIndex("by_user_bArticleId", (q) =>
          q.eq("userId", userId).eq("bArticleId", articleId),
        )
    : via
      ? ctx.db.query("edgeExplanationState").withIndex("by_user_b_bVia", (q) =>
          q
            .eq("userId", userId)
            .eq("b", node ?? "")
            .eq("bVia", via),
        )
      : ctx.db
          .query("edgeExplanationState")
          .withIndex("by_user_b_bVia", (q) =>
            q.eq("userId", userId).eq("b", node ?? ""),
          );
  // Via filtering must happen in the index: otherwise an unrelated surviving
  // first page could hide selected deleted passages forever.
  const [leftRows, rightRows] = await Promise.all([
    left.take(16),
    right.take(16),
  ]);
  const seen = new Set<string>();
  for (const row of [...leftRows, ...rightRows]) {
    if (seen.has(row._id)) continue;
    seen.add(row._id);
    await ctx.db.delete(row._id);
  }
  return leftRows.length === 16 || rightRows.length === 16;
}
