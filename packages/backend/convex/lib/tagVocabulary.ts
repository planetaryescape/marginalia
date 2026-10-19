import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { metadataLibraryRetained } from "./shelfCounts";
import { MAX_VOCABULARY_IN_PROMPT } from "./tagMatching";

type Node = Doc<"tagVocabulary">;
type Payload = Doc<"tagVocabularyPayloads">;
type NodeId = Id<"tagVocabulary"> | null;
type ReadCtx = Pick<QueryCtx, "db">;
export const TAG_METADATA_BYTES = 16_384;
export const TAG_KEY_BYTES = 4_096;
export const TAG_EMBED_BATCH = 50;
const MAX_DEPTH = 64;
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

/** An overflow is explicit, never a truncated identity or guessed ready baseline.
 * Canonical tags remain untouched; operators can inspect/fix the oversized tag. */
export function tagProjection(tag: Doc<"tags">) {
  const text = tag.description ? `${tag.name}: ${tag.description}` : tag.name;
  const overflow =
    bytes(tag.key) > TAG_KEY_BYTES ||
    bytes(JSON.stringify({ name: tag.name, aliases: tag.aliases, text })) >
      TAG_METADATA_BYTES;
  return {
    userId: tag.userId,
    tagId: tag._id,
    sourceCreationTime: tag._creationTime,
    key: overflow ? "" : tag.key,
    count: tag.count,
    active: tag.status === "active" && !overflow,
    missing: !tag.embedding && !overflow,
    overflow,
    name: overflow ? "" : tag.name,
    aliases: overflow ? [] : tag.aliases,
    text: overflow ? "" : text,
  };
}

export function vocabularyState(ctx: ReadCtx, userId: string) {
  return ctx.db
    .query("tagVocabularyState")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

// AVL ordering calls the SAME runtime comparator as the legacy query. A binary
// count/key index does not preserve localeCompare at the 150th-place tie.
function compare(a: Node, b: Node) {
  return (
    b.count - a.count ||
    a.key.localeCompare(b.key) ||
    a.sourceCreationTime - b.sourceCreationTime ||
    (a.tagId < b.tagId ? -1 : a.tagId === b.tagId ? 0 : 1)
  );
}

class Tree {
  private cache = new Map<Id<"tagVocabulary">, Node>();
  constructor(private ctx: MutationCtx) {}
  async get(id: NodeId): Promise<Node | null> {
    if (!id) return null;
    const cached = this.cache.get(id);
    if (cached) return cached;
    const row = await this.ctx.db.get(id);
    if (!row) throw new Error("Tag vocabulary tree is incomplete");
    this.cache.set(id, row);
    return row;
  }
  async write(node: Node, left: NodeId, right: NodeId) {
    const height =
      1 +
      Math.max(
        (await this.get(left))?.height ?? 0,
        (await this.get(right))?.height ?? 0,
      );
    const next = { ...node, left, right, height };
    this.cache.set(node._id, next);
    await this.ctx.db.patch(node._id, { left, right, height });
    return next;
  }
  async rotateLeft(node: Node) {
    const pivot = await this.get(node.right);
    if (!pivot) throw new Error("Missing AVL right child");
    await this.write(node, node.left, pivot.left);
    return this.write(pivot, node._id, pivot.right);
  }
  async rotateRight(node: Node) {
    const pivot = await this.get(node.left);
    if (!pivot) throw new Error("Missing AVL left child");
    await this.write(node, pivot.right, node.right);
    return this.write(pivot, pivot.left, node._id);
  }
  async balance(node: Node, left: NodeId, right: NodeId): Promise<Node> {
    let next = await this.write(node, left, right);
    const l = await this.get(left);
    const r = await this.get(right);
    const skew = (l?.height ?? 0) - (r?.height ?? 0);
    if (skew > 1 && l) {
      if (
        ((await this.get(l.left))?.height ?? 0) <
        ((await this.get(l.right))?.height ?? 0)
      ) {
        const rotated = await this.rotateLeft(l);
        next = await this.write(next, rotated._id, right);
      }
      return this.rotateRight(next);
    }
    if (skew < -1 && r) {
      if (
        ((await this.get(r.right))?.height ?? 0) <
        ((await this.get(r.left))?.height ?? 0)
      ) {
        const rotated = await this.rotateRight(r);
        next = await this.write(next, left, rotated._id);
      }
      return this.rotateLeft(next);
    }
    return next;
  }
  async insert(root: NodeId, node: Node, depth = 0): Promise<NodeId> {
    if (depth >= MAX_DEPTH) throw new Error("Tag vocabulary depth exceeded");
    const parent = await this.get(root);
    if (!parent) return (await this.write(node, null, null))._id;
    if (compare(node, parent) < 0)
      return (
        await this.balance(
          parent,
          await this.insert(parent.left, node, depth + 1),
          parent.right,
        )
      )._id;
    return (
      await this.balance(
        parent,
        parent.left,
        await this.insert(parent.right, node, depth + 1),
      )
    )._id;
  }
  async remove(root: NodeId, node: Node, depth = 0): Promise<NodeId> {
    if (depth >= MAX_DEPTH) throw new Error("Tag vocabulary depth exceeded");
    const parent = await this.get(root);
    if (!parent) throw new Error("Tag vocabulary node not found");
    if (parent._id === node._id) {
      if (!parent.left) return parent.right;
      if (!parent.right) return parent.left;
      let successor = await this.get(parent.right);
      if (!successor) throw new Error("Missing AVL successor");
      for (let i = 0; successor.left; i++) {
        if (i >= MAX_DEPTH) throw new Error("Tag vocabulary depth exceeded");
        const next = await this.get(successor.left);
        if (!next) throw new Error("Missing AVL successor");
        successor = next;
      }
      const right = await this.remove(parent.right, successor, depth + 1);
      return (await this.balance(successor, parent.left, right))._id;
    }
    if (compare(node, parent) < 0)
      return (
        await this.balance(
          parent,
          await this.remove(parent.left, node, depth + 1),
          parent.right,
        )
      )._id;
    return (
      await this.balance(
        parent,
        parent.left,
        await this.remove(parent.right, node, depth + 1),
      )
    )._id;
  }
}

/** Register on tags using innerDb: insert/patch/replace/delete all publish in the
 * canonical transaction. Disabled libraries are retained; absent/deleting aren't. */
export async function syncTagVocabulary(
  ctx: MutationCtx,
  before: Doc<"tags"> | null,
  after: Doc<"tags"> | null,
) {
  const source = after ?? before;
  if (!source) return;
  const prior = await ctx.db
    .query("tagVocabulary")
    .withIndex("by_tagId", (q) => q.eq("tagId", source._id))
    .unique();
  // Purge can already have removed arbitrary tree nodes. Never traverse or
  // resurrect that tree after the library is absent/deleting.
  if (prior && !(await metadataLibraryRetained(ctx, prior.userId))) {
    await ctx.db.delete(prior.payloadId);
    await ctx.db.delete(prior._id);
    if (!after || after.userId === prior.userId) return;
    return syncTagVocabulary(ctx, null, after);
  }
  const projected =
    after && (await metadataLibraryRetained(ctx, after.userId))
      ? tagProjection(after)
      : null;
  // The trigger's canonical before/after pair is transaction-local evidence:
  // count/status-only changes cannot have changed the already-published payload.
  // Migration (no before row) and payload edits still validate persisted data.
  const sameSourcePayload =
    prior &&
    before &&
    projected &&
    JSON.stringify(payloadFields(tagProjection(before))) ===
      JSON.stringify(payloadFields(projected));
  const payload =
    prior && !sameSourcePayload ? await ctx.db.get(prior.payloadId) : null;
  if (prior && !payload && !sameSourcePayload)
    throw new Error("Missing tag vocabulary payload");
  const reusePayload =
    sameSourcePayload ||
    (payload &&
      projected &&
      JSON.stringify(payloadFields(payload)) ===
        JSON.stringify(payloadFields(projected)));
  if (
    prior &&
    projected &&
    JSON.stringify(structureFields(prior)) ===
      JSON.stringify(structureFields(projected))
  ) {
    if (!reusePayload)
      await ctx.db.replace(prior.payloadId, payloadFields(projected));
    return;
  }
  // Count/status/tree updates do not rewrite or recreate the large payload.
  // This comparison is local to this transaction, never a cross-tx cache.
  if (prior) {
    const state = await vocabularyState(ctx, prior.userId);
    if (!state) throw new Error("Missing tag vocabulary state");
    const root = prior.active
      ? await new Tree(ctx).remove(state.root, prior)
      : state.root;
    await ctx.db.patch(state._id, {
      root,
      overflow: state.overflow - Number(prior.overflow),
    });
    await ctx.db.delete(prior._id);
    if (!reusePayload) await ctx.db.delete(prior.payloadId);
  }
  if (!projected) return;
  let state = await vocabularyState(ctx, projected.userId);
  if (!state) {
    // The first canonical insert proves a genuinely new/empty vocabulary. Two
    // bounded rows distinguish it from a legacy library needing migration.
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_user_key", (q) => q.eq("userId", projected.userId))
      .take(2);
    const ready = existing.length === 1 && existing[0]._id === projected.tagId;
    const id = await ctx.db.insert("tagVocabularyState", {
      userId: projected.userId,
      root: null,
      overflow: 0,
      ready,
      cursor: null,
    });
    state = await ctx.db.get(id);
  }
  if (!state) throw new Error("Missing tag vocabulary state");
  const payloadId =
    reusePayload && prior
      ? prior.payloadId
      : await ctx.db.insert("tagVocabularyPayloads", payloadFields(projected));
  const id = await ctx.db.insert("tagVocabulary", {
    ...structureFields(projected),
    payloadId,
    left: null,
    right: null,
    height: 1,
  });
  const node = await ctx.db.get(id);
  if (!node) throw new Error("Missing tag vocabulary node");
  const root = node.active
    ? await new Tree(ctx).insert(state.root, node)
    : state.root;
  await ctx.db.patch(state._id, {
    root,
    overflow: state.overflow + Number(node.overflow),
  });
}

function payloadFields(
  payload: Pick<
    Payload,
    | "userId"
    | "tagId"
    | "sourceCreationTime"
    | "key"
    | "missing"
    | "name"
    | "aliases"
    | "text"
  >,
) {
  const {
    userId,
    tagId,
    sourceCreationTime,
    key,
    missing,
    name,
    aliases,
    text,
  } = payload;
  return {
    userId,
    tagId,
    sourceCreationTime,
    key,
    missing,
    name,
    aliases,
    text,
  };
}

function structureFields(
  node: Pick<
    Node,
    | "userId"
    | "tagId"
    | "sourceCreationTime"
    | "key"
    | "count"
    | "active"
    | "overflow"
  >,
) {
  const { userId, tagId, sourceCreationTime, key, count, active, overflow } =
    node;
  return {
    userId,
    tagId,
    sourceCreationTime,
    key,
    count,
    active,
    overflow,
  };
}

export async function requireVocabulary(ctx: ReadCtx, userId: string) {
  if (!(await metadataLibraryRetained(ctx, userId))) return null;
  const state = await vocabularyState(ctx, userId);
  // Compatibility for genuinely empty pre-registration libraries, not a ready
  // default for existing tags. Nonempty legacy libraries still fail closed.
  if (
    !state &&
    !(await ctx.db
      .query("tags")
      .withIndex("by_user_key", (q) => q.eq("userId", userId))
      .first())
  )
    return null;
  if (!state?.ready) throw new Error("Tag vocabulary migration required");
  if (state.overflow)
    throw new Error(
      "Tag vocabulary exceeds metadata byte budget; inspect oversized tags",
    );
  return state;
}

export async function promptVocabulary(ctx: ReadCtx, userId: string) {
  const state = await requireVocabulary(ctx, userId);
  if (!state) return [];
  const result: { name: string; key: string; aliases: string[] }[] = [];
  const stack: Node[] = [];
  let next = state.root;
  let reads = 0;
  while ((next || stack.length) && result.length < MAX_VOCABULARY_IN_PROMPT) {
    while (next) {
      // A valid AVL visits <=150 + its height nodes, never a vocabulary scan.
      if (++reads > MAX_VOCABULARY_IN_PROMPT + MAX_DEPTH)
        throw new Error("Tag vocabulary read budget exceeded");
      const node = await ctx.db.get(next);
      if (!node || node.userId !== userId || !node.active)
        throw new Error("Invalid tag vocabulary tree");
      stack.push(node);
      next = node.left;
    }
    const node = stack.pop();
    if (!node) break;
    const payload = await ctx.db.get(node.payloadId);
    if (
      !payload ||
      payload.userId !== userId ||
      payload.tagId !== node.tagId ||
      payload.key !== node.key
    )
      throw new Error("Invalid tag vocabulary payload");
    result.push({
      name: payload.name,
      key: node.key,
      aliases: payload.aliases,
    });
    next = node.right;
  }
  return result;
}

export async function missingVocabularyEmbeddings(
  ctx: ReadCtx,
  userId: string,
) {
  if (!(await requireVocabulary(ctx, userId))) return [];
  const tags = await ctx.db
    .query("tagVocabularyPayloads")
    .withIndex("by_userId_and_missing_and_key", (q) =>
      q.eq("userId", userId).eq("missing", true),
    )
    .take(TAG_EMBED_BATCH);
  return tags.map((tag) => ({ id: tag.tagId, text: tag.text }));
}

/** Explicit, bounded and resumable. It never schedules paid work. Live triggers
 * cover concurrent changes before/behind the cursor; only the last page is ready. */
export async function migrateTagVocabulary(ctx: MutationCtx, userId: string) {
  if (!(await metadataLibraryRetained(ctx, userId)))
    return { done: true, migrated: 0 };
  let state = await vocabularyState(ctx, userId);
  if (!state) {
    const id = await ctx.db.insert("tagVocabularyState", {
      userId,
      root: null,
      overflow: 0,
      ready: false,
      cursor: null,
    });
    state = await ctx.db.get(id);
  }
  if (!state) throw new Error("Missing tag vocabulary state");
  if (state.ready) return { done: true, migrated: 0 };
  const page = await ctx.db
    .query("tags")
    .withIndex("by_user_key", (q) => q.eq("userId", userId))
    .paginate({
      cursor: state.cursor,
      // One canonical row plus one AVL insertion: even near-limit legacy tag
      // documents cannot multiply this transaction's vector/metadata budget.
      numItems: 1,
      maximumRowsRead: 1,
      maximumBytesRead: 1_000_000,
    });
  for (const tag of page.page) await syncTagVocabulary(ctx, null, tag);
  await ctx.db.patch(state._id, {
    cursor: page.continueCursor,
    ready: page.isDone,
  });
  return { done: page.isDone, migrated: page.page.length };
}

export async function purgeTagVocabulary(
  ctx: MutationCtx,
  userId: string,
): Promise<number> {
  if (await metadataLibraryRetained(ctx, userId))
    throw new Error("Cannot purge retained tag vocabulary");
  const rows = await ctx.db
    .query("tagVocabulary")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(32);
  for (const row of rows) {
    await ctx.db.delete(row.payloadId);
    await ctx.db.delete(row._id);
  }
  if (rows.length) return rows.length;
  const payloads = await ctx.db
    .query("tagVocabularyPayloads")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(32);
  for (const row of payloads) await ctx.db.delete(row._id);
  if (payloads.length) return payloads.length;
  const state = await vocabularyState(ctx, userId);
  if (state) {
    await ctx.db.delete(state._id);
    return 1;
  }
  return 0;
}
