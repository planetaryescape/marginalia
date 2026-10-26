/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { metadataContext } from "../test/metadata";
import { addReader } from "../test/owner";
import { api, components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import authSchema from "./betterAuth/schema";
import {
  advanceDiscoveryRevision,
  DISCOVERY_EXHAUSTED,
  discoveryShard,
  purgeDiscoveryRevision,
  readDiscoveryRevision,
} from "./lib/discoveryRevision";
import { articleCleanupPending } from "./lib/ideaNodes";
import "./lib/discoveryRevisionTriggers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
function fixture() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("./betterAuth/**/*.ts"),
  );
  return t;
}
const owner = "default_user";
const article = {
  userId: owner,
  guid: "fixture",
  url: "https://example.com/revision",
  title: "Fixture",
  content: "Body",
  extractionStatus: "extracted" as const,
  annotationStatus: "annotated" as const,
  createdAt: 1,
};
const revision = (t: ReturnType<typeof fixture>, userId = owner) =>
  t.run((ctx) => readDiscoveryRevision(ctx, userId));

it("epoch zero is an empty CLIENT baseline, not an empty source dataset; old/new clients coexist without backfill", async () => {
  const t = fixture();
  // Pre-rollout source data has no epochs. Old client APIs still read it.
  const id = await t.run((ctx) => ctx.db.insert("articles", article));
  const zero = await revision(t);
  expect(zero).toBe(Array(32).fill(0).join(":"));
  await t.run((ctx) =>
    metadataContext(ctx).db.patch(id, {
      content: "Body-only change, unchanged timestamp",
    }),
  );
  expect(await revision(t)).not.toBe(zero);
  const epoch = await revision(t);
  await t.run((ctx) => metadataContext(ctx).db.patch(id, { embedding: [0.1] }));
  expect(await revision(t)).not.toBe(epoch);
  const embedded = await revision(t);
  await t.run((ctx) =>
    metadataContext(ctx).db.patch(id, { embedding: undefined }),
  );
  expect(await revision(t)).not.toBe(embedded);
});

it("generic insert/replace/delete, vault body/vector changes and old/new retained owners advance atomically", async () => {
  const t = fixture();
  const { libraryId } = await addReader(t, {
    email: "epoch-transfer@example.com",
  });
  const before = await revision(t);
  const id = await t.run((ctx) =>
    metadataContext(ctx).db.insert("noteChunks", {
      userId: owner,
      filePath: "fixture.md",
      fileName: "fixture",
      fileHash: "hash",
      chunkIndex: 0,
      content: "A",
      embedding: [0.1],
      indexedAt: 1,
    }),
  );
  expect(await revision(t)).not.toBe(before);
  const inserted = await revision(t);
  await t.run((ctx) =>
    metadataContext(ctx).db.patch(id, { content: "B", embedding: [] }),
  );
  expect(await revision(t)).not.toBe(inserted);
  const oldOwner = await revision(t);
  const newOwner = await revision(t, libraryId);
  await t.run((ctx) =>
    metadataContext(ctx).db.replace(id, {
      userId: libraryId,
      filePath: "fixture.md",
      fileName: "fixture",
      fileHash: "hash",
      chunkIndex: 0,
      content: "B",
      embedding: [],
      indexedAt: 1,
    }),
  );
  expect(await revision(t)).not.toBe(oldOwner);
  expect(await revision(t, libraryId)).not.toBe(newOwner);
  const moved = await revision(t, libraryId);
  await t.run((ctx) => metadataContext(ctx).db.delete(id));
  expect(await revision(t, libraryId)).not.toBe(moved);
  const rollback = await revision(t);
  await expect(
    t.run(async (ctx) => {
      await metadataContext(ctx).db.insert("ideaLinks", {
        userId: owner,
        from: "note:a",
        to: "note:b",
        createdAt: 1,
      });
      throw new Error("rollback source+epoch");
    }),
  ).rejects.toThrow("rollback");
  expect(await revision(t)).toBe(rollback);
});

it("link/tag membership and active-tag count/status changes invalidate, while engagement/metadata/reflections do not", async () => {
  const t = fixture();
  const articleId = await t.run((ctx) => ctx.db.insert("articles", article));
  const tagId = await t.run((ctx) =>
    metadataContext(ctx).db.insert("tags", {
      userId: owner,
      key: "fixture",
      name: "Fixture",
      count: 0,
      status: "candidate",
      aliases: [],
      createdAt: 1,
    }),
  );
  let prior = await revision(t);
  await t.run((ctx) =>
    metadataContext(ctx).db.patch(tagId, { count: 1, status: "active" }),
  );
  expect(await revision(t)).not.toBe(prior);
  prior = await revision(t);
  await t.run((ctx) =>
    metadataContext(ctx).db.insert("articleTags", {
      userId: owner,
      articleId,
      tagId,
      createdAt: 1,
    }),
  );
  expect(await revision(t)).not.toBe(prior);
  const interaction = await t.run((ctx) =>
    metadataContext(ctx).db.insert("articleInteractions", {
      userId: owner,
      articleId,
      action: "opened",
      createdAt: 1,
    }),
  );
  prior = await revision(t);
  await t.run((ctx) =>
    metadataContext(ctx).db.patch(interaction, {
      activeTimeMs: 800,
      maxScrollPercent: 42,
    }),
  );
  await t.run((ctx) =>
    metadataContext(ctx).db.insert("reflections", {
      userId: owner,
      articleId,
      strongestPoint: "",
      weakestAssumption: "",
      credibleCounterview: "",
      questionForYou: "",
      createdAt: 1,
    }),
  );
  expect(await revision(t)).toBe(prior);
  await t.run((ctx) =>
    metadataContext(ctx).db.patch(interaction, { action: "finished" }),
  );
  expect(await revision(t)).not.toBe(prior);
});

it("covers every additional canonical graph/search input and ignores source operational-only patches", async () => {
  const t = fixture();
  const articleId = await t.run((ctx) => ctx.db.insert("articles", article));
  const common = { userId: owner, articleId, createdAt: 1 };
  type Input = Id<
    | "userNotes"
    | "highlights"
    | "companionThreads"
    | "annotations"
    | "summaries"
    | "impressions"
    | "ideaLinks"
    | "feedArticleCleanup"
  >;
  const inserts: ((ctx: MutationCtx) => Promise<Input>)[] = [
    (ctx) =>
      ctx.db.insert("userNotes", {
        ...common,
        content: "A",
        contentPlain: "A",
        selectedText: "A",
        updatedAt: 1,
      }),
    (ctx) =>
      ctx.db.insert("highlights", { ...common, kind: "highlight", text: "A" }),
    (ctx) =>
      ctx.db.insert("companionThreads", {
        ...common,
        mode: "ask",
        selection: "A",
        turns: [],
        updatedAt: 1,
      }),
    (ctx) =>
      ctx.db.insert("annotations", {
        ...common,
        type: "cross_reference",
        anchorText: "A",
        anchorStartOffset: 0,
        anchorEndOffset: 1,
        content: "A",
        relevanceScore: 1,
        wasViewed: false,
        wasDismissed: false,
      }),
    (ctx) =>
      ctx.db.insert("summaries", { ...common, gist: "A", model: "fixture" }),
    (ctx) =>
      ctx.db.insert("impressions", {
        ...common,
        tags: [],
        note: "A",
        updatedAt: 1,
      }),
    (ctx) =>
      ctx.db.insert("ideaLinks", {
        userId: owner,
        from: "note:a",
        to: "note:b",
        createdAt: 1,
      }),
    (ctx) =>
      ctx.db.insert("feedArticleCleanup", {
        userId: owner,
        articleId,
        phase: "annotations",
      }),
  ];
  for (const insert of inserts) {
    const before = await revision(t);
    const id = await t.run((ctx) => insert(metadataContext(ctx)));
    expect(await revision(t)).not.toBe(before);
    const inserted = await revision(t);
    await t.run((ctx) => metadataContext(ctx).db.delete(id));
    expect(await revision(t)).not.toBe(inserted);
  }
  const before = await revision(t);
  await t.run((ctx) =>
    metadataContext(ctx).db.patch(articleId, {
      annotationStatus: "pending",
      extractionLeaseUntil: 500,
    }),
  );
  expect(await revision(t)).toBe(before);
  await t.run((ctx) =>
    metadataContext(ctx).db.patch(articleId, { extractionStatus: "failed" }),
  );
  expect(await revision(t)).not.toBe(before);
});

it("bounds revision reads to 33 compact rows and rejects malformed shard state", async () => {
  const t = fixture();
  await t.run(async (ctx) => {
    for (let shard = 0; shard < 32; shard++)
      await ctx.db.insert("discoveryEpochs", {
        userId: owner,
        shard,
        epoch: 1,
      });
  });
  await t.run(async (ctx) => {
    expect(await readDiscoveryRevision(ctx, owner)).toBe(
      Array(32).fill(1).join(":"),
    );
    const metrics = await ctx.meta.getTransactionMetrics();
    expect(metrics.documentsRead.used).toBe(32);
    expect(metrics.bytesRead.used).toBeLessThan(16_384);
  });
  await t.run((ctx) =>
    ctx.db.insert("discoveryEpochs", { userId: owner, shard: 32, epoch: 1 }),
  );
  expect(await revision(t)).toBeNull();
  await t.run((ctx) =>
    ctx.db.insert("discoveryEpochs", {
      userId: "malformed",
      shard: 0.5,
      epoch: 1,
    }),
  );
  expect(await revision(t, "malformed")).toBeNull();
});

it("invalidates checking-job presence when deleting the first row reveals a later hidden cleanup job", async () => {
  const t = fixture();
  const articleId = await t.run((ctx) => ctx.db.insert("articles", article));
  const feedId = await t.run((ctx) =>
    ctx.db.insert("feeds", {
      userId: owner,
      title: "Fixture",
      url: "https://example.com/feed",
      isActive: true,
      createdAt: 1,
    }),
  );
  const runId = await t.run((ctx) =>
    ctx.db.insert("feedArticleCleanup", {
      userId: owner,
      feedId,
      choice: "all",
      phase: "feed",
      readerDeletes: 0,
    }),
  );
  const checking = await t.run((ctx) =>
    metadataContext(ctx).db.insert("feedArticleCleanup", {
      userId: owner,
      articleId,
      feedId,
      runId,
      choice: "all",
      phase: "checking",
      revision: 0,
      resumeCursor: "",
      sourceDone: false,
      readerDeletes: 0,
    }),
  );
  await t.run((ctx) =>
    metadataContext(ctx).db.insert("feedArticleCleanup", {
      userId: owner,
      articleId,
      phase: "annotations",
    }),
  );
  expect(await t.run((ctx) => articleCleanupPending(ctx, articleId))).toBe(
    false,
  );
  const before = await revision(t);
  await t.run((ctx) =>
    metadataContext(ctx).db.patch(checking, { revision: 1, cursor: "next" }),
  );
  expect(await revision(t)).toBe(before);
  await t.run((ctx) => metadataContext(ctx).db.delete(checking));
  expect(await t.run((ctx) => articleCleanupPending(ctx, articleId))).toBe(
    true,
  );
  expect(await revision(t)).not.toBe(before);
});

it("uses disjoint source-ID shards, never wraps/ABA, and fails closed for duplicate/oversized unsupported state", async () => {
  const t = fixture();
  const a = "source-a";
  const b = "source-b";
  expect(discoveryShard(a)).not.toBe(discoveryShard(b));
  await t.run(async (ctx) => {
    await advanceDiscoveryRevision(ctx, null, { _id: a, userId: owner });
    await advanceDiscoveryRevision(ctx, null, { _id: b, userId: owner });
  });
  const rows = await t.run((ctx) => ctx.db.query("discoveryEpochs").collect());
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.epoch)).toEqual([1, 1]);
  const shardA = rows.find((row) => row.shard === discoveryShard(a));
  if (!shardA) throw new Error("Missing fixture shard");
  await t.run((ctx) =>
    ctx.db.patch(shardA._id, { epoch: DISCOVERY_EXHAUSTED - 1 }),
  );
  await t.run((ctx) =>
    advanceDiscoveryRevision(ctx, null, { _id: a, userId: owner }),
  );
  expect(await revision(t)).toBeNull();
  await t.run((ctx) =>
    advanceDiscoveryRevision(ctx, null, { _id: a, userId: owner }),
  );
  expect(await revision(t)).toBeNull();
  const large = "u".repeat(257);
  await t.run((ctx) =>
    advanceDiscoveryRevision(ctx, null, { _id: a, userId: large }),
  );
  expect(await revision(t, large)).toBeNull();
  await t.run((ctx) =>
    ctx.db.insert("discoveryEpochs", {
      userId: "duplicate",
      shard: 0,
      epoch: 1,
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("discoveryEpochs", {
      userId: "duplicate",
      shard: 0,
      epoch: 2,
    }),
  );
  expect(await revision(t, "duplicate")).toBeNull();
});

it("public revisions bind live session/current reader, reject mismatched graph reservations and stay bounded", async () => {
  const t = fixture();
  const { client, libraryId } = await addReader(t, {
    email: "epoch-private@example.com",
  });
  const authSession = await t.query(components.betterAuth.adapter.findOne, {
    model: "session",
    where: [{ field: "userId", value: libraryId }],
  });
  if (!authSession) throw new Error("Missing fixture session");
  const session = authSession._id;
  const initial = await client.query(api.discoveryRevision.current, {
    session,
  });
  expect(initial).toBe(await revision(t, libraryId));
  expect(
    await client.query(api.discoveryRevision.current, {
      session: "other-session",
    }),
  ).toBeNull();
  const articleId = await t.run((ctx) =>
    metadataContext(ctx).db.insert("articles", {
      ...article,
      userId: libraryId,
    }),
  );
  await t.run((ctx) =>
    metadataContext(ctx).db.insert("userNotes", {
      userId: libraryId,
      articleId,
      content: "Private fixture",
      contentPlain: "Private fixture",
      selectedText: "A",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  expect(
    await client.query(api.discoveryRevision.graph, {
      session,
      revision: initial,
    }),
  ).toMatchObject({ graph: null });
  const current = await client.query(api.discoveryRevision.current, {
    session,
  });
  const graph = await client.query(api.discoveryRevision.graph, {
    session,
    revision: current,
  });
  expect(graph.revision).toBe(current);
  expect(graph.graph?.nodes[0].label).toBe("Private fixture");
  expect(graph.graph?.nodes.length).toBeLessThanOrEqual(15);
  expect(await revision(t)).toBe(Array(32).fill(0).join(":"));
  await expect(
    t.query(api.discoveryRevision.current, { session }),
  ).rejects.toThrow("Sign in");
  await t.run(async (ctx) => {
    const reader = await ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId))
      .first();
    if (!reader) throw new Error("Missing fixture reader");
    await ctx.db.patch(reader._id, { deletingAt: 1 });
  });
  expect(
    await client.query(api.discoveryRevision.current, { session }),
  ).toBeNull();
  expect(
    await client.query(api.discoveryRevision.graph, {
      session,
      revision: current,
    }),
  ).toEqual({ revision: null, graph: null });
});

it("purges compact rows without recreating absent/deleting library metadata", async () => {
  const t = fixture();
  const { libraryId } = await addReader(t, {
    email: "epoch-purge@example.com",
  });
  await t.run((ctx) =>
    advanceDiscoveryRevision(ctx, null, { _id: "fixture", userId: libraryId }),
  );
  await expect(
    t.run((ctx) => purgeDiscoveryRevision(ctx, libraryId)),
  ).rejects.toThrow("Retained");
  await t.run(async (ctx) => {
    const reader = await ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId))
      .first();
    if (!reader) throw new Error("fixture reader missing");
    await ctx.db.patch(reader._id, { deletingAt: 1 });
    expect(await purgeDiscoveryRevision(ctx, libraryId)).toBe(1);
    await advanceDiscoveryRevision(
      ctx,
      { _id: "fixture", userId: libraryId },
      null,
    );
    await advanceDiscoveryRevision(ctx, null, {
      _id: "fixture",
      userId: "absent",
    });
    expect(await ctx.db.query("discoveryEpochs").collect()).toEqual([]);
  });
});
