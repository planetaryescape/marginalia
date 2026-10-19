/// <reference types="vite/client" />
import { appendFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { addReader } from "../test/owner";
import { api, components } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import authSchema from "./betterAuth/schema";
import { buildGraph, type Graph } from "./ideaGraph";
import { nodeKey, pairKey, ReadBudget } from "./lib/ideaGraph";
import { articleCleanupPending, articleTitle, loadNode } from "./lib/ideaNodes";
import { gatherCandidates, RequestArticleReads } from "./lib/ideaSignals";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
type NativeMetrics = Awaited<
  ReturnType<MutationCtx["meta"]["getTransactionMetrics"]>
>;
function evidence(
  label: string,
  value: NativeMetrics | { memo: NativeMetrics; oldPhaseHelper: NativeMetrics },
) {
  if (process.env.GRAPH_MEMO_EVIDENCE)
    appendFileSync(
      process.env.GRAPH_MEMO_EVIDENCE,
      `${label} ${JSON.stringify(value)}\n`,
    );
}
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("./betterAuth/**/*.ts"),
  );
  return t;
}
function article(ctx: MutationCtx, userId: string, title = "Shared source") {
  return ctx.db.insert("articles", {
    userId,
    title,
    guid: title,
    url: `https://example.com/${title}`,
    content: "x".repeat(300_000),
    extractionStatus: "extracted",
    annotationStatus: "annotated",
    createdAt: 1,
  });
}
async function notes(
  ctx: MutationCtx,
  userId: string,
  articleId: Awaited<ReturnType<typeof article>>,
  count = 6,
) {
  const ids = [];
  for (let i = 0; i < count; i++)
    ids.push(
      await ctx.db.insert("userNotes", {
        userId,
        articleId,
        selectedText: "",
        content: `Note ${i}`,
        contentPlain: `Note ${i}`,
        createdAt: i + 1,
        updatedAt: i + 1,
      }),
    );
  return ids;
}
const fullBudget = () =>
  new ReadBudget(10_000, 100, undefined, 100 * 1024 * 1024);

it("keeps the checking/post-delete fence and caches actual missing titles only inside a request", async () => {
  const t = fixture();
  const ids = await t.run(async (ctx) => {
    const articleId = await article(ctx, "a");
    const feedId = await ctx.db.insert("feeds", {
      userId: "a",
      title: "Fixture",
      url: "https://example.com/feed",
      isActive: true,
      createdAt: 1,
    });
    const runId = await ctx.db.insert("feedArticleCleanup", {
      userId: "a",
      feedId,
      choice: "all",
      phase: "feed",
      readerDeletes: 0,
    });
    const job = await ctx.db.insert("feedArticleCleanup", {
      userId: "a",
      articleId,
      phase: "checking",
      feedId,
      runId,
      choice: "all",
      revision: 0,
      resumeCursor: "",
      sourceDone: false,
      readerDeletes: 0,
    });
    await ctx.db.insert("annotations", {
      userId: "a",
      articleId,
      type: "cross_reference",
      anchorText: "a",
      anchorStartOffset: 0,
      anchorEndOffset: 1,
      content: "connection",
      relevanceScore: 1,
      wasViewed: false,
      wasDismissed: false,
      createdAt: 1,
      notePath: "one.md",
    });
    const memo = new RequestArticleReads(ctx, "a", fullBudget());
    expect(await articleCleanupPending(ctx, articleId)).toBe(false);
    expect(await memo.connectionsOn(articleId)).toHaveLength(1);
    expect(await memo.title(articleId)).toBe("Shared source");
    return { articleId, job };
  });
  await t.run(async (ctx) => {
    await ctx.db.delete(ids.articleId);
    await ctx.db.replace(ids.job, {
      userId: "a",
      articleId: ids.articleId,
      phase: "annotations",
    });
  });
  await t.run(async (ctx) => {
    const budget = fullBudget();
    const memo = new RequestArticleReads(ctx, "a", budget);
    expect(await articleCleanupPending(ctx, ids.articleId)).toBe(true);
    expect(await memo.connectionsOn(ids.articleId)).toEqual([]);
    expect(await memo.title(ids.articleId)).toBeNull();
    const after = budget.remaining;
    expect(await memo.title(ids.articleId)).toBeNull();
    expect(budget.remaining).toBe(after);
    expect(
      await loadNode(
        ctx,
        "a",
        nodeKey("article", ids.articleId),
        new ReadBudget(160, 0),
        true,
      ),
    ).toBeNull();
  });
});

it("retains the native 15-node cap and physical limits with seven distinct article neighbours", async () => {
  const t = fixture();
  const args = await t.run(async (ctx) => {
    await ctx.db.insert("noteChunks", {
      userId: "a",
      filePath: "centre.md",
      fileName: "centre.md",
      chunkIndex: 0,
      content: "centre",
      embedding: [1],
      fileHash: "centre",
      indexedAt: 1,
    });
    const similar = [];
    for (let i = 0; i < 7; i++) {
      const id = await article(ctx, "a", `Source ${i}`);
      const ids = await notes(ctx, "a", id, 2);
      similar.push({ key: nodeKey("note", ids[0]) });
    }
    return { centre: "vault:centre.md", similar };
  });
  await t.run(async (ctx) => {
    const graph = await buildGraph(ctx, "a", args);
    expect(graph.nodes).toHaveLength(15);
    const metrics = await ctx.meta.getTransactionMetrics();
    expect(metrics.bytesRead.used).toBeLessThan(12 * 1024 * 1024);
    expect(metrics.documentsRead.used).toBeLessThanOrEqual(160);
    expect(metrics.bytesWritten.used).toBe(0);
    evidence("15-node native", metrics);
  });
});

it("reuses a known owned title for second-ring reasons even when no further article read is affordable", async () => {
  const t = fixture();
  const centre = await t.run(async (ctx) => {
    const id = await article(ctx, "a");
    const ids = await notes(ctx, "a", id);
    for (let i = 0; i < 6; i++)
      await ctx.db.insert("highlights", {
        userId: "a",
        articleId: id,
        kind: "highlight",
        text: `Mark ${i}`,
        createdAt: i,
      });
    return nodeKey("note", ids[0]);
  });
  await t.run(async (ctx) => {
    const budget = new ReadBudget(160, 1);
    const graph = await buildGraph(ctx, "a", { centre }, budget);
    expect(budget.mayReadArticle).toBe(false);
    const outer = new Set(
      graph.nodes.filter((n) => n.hop === 2).map((n) => n.key),
    );
    expect(
      graph.edges
        .filter((e) => outer.has(e.b))
        .some((e) =>
          e.reasons.some((r) => r.text === "Same article: Shared source"),
        ),
    ).toBe(true);
    const metrics = await ctx.meta.getTransactionMetrics();
    // Only the title's canonical article is read; the source node falls back
    // to its summary/plain label, and memo hits do not reopen the article cap.
    expect(metrics.bytesRead.used).toBeLessThan(400_000);
    expect(metrics.bytesWritten.used).toBe(0);
    evidence("capped known-title enrichment", metrics);
  });
});

it("both public APIs match an independent full-budget literal; native reads drop and repeat requests read again", async () => {
  const t = fixture();
  const { client, libraryId } = await addReader(t, {
    email: "memo@example.com",
  });
  const auth = await t.query(components.betterAuth.adapter.findOne, {
    model: "session",
    where: [{ field: "userId", value: libraryId }],
  });
  if (!auth) throw new Error("Missing fixture session");
  const { articleId, ids } = await t.run(async (ctx) => {
    const articleId = await article(ctx, libraryId);
    return { articleId, ids: await notes(ctx, libraryId, articleId) };
  });
  const centre = nodeKey("note", ids[0]);
  const articleKey = nodeKey("article", articleId);
  const neighbours = ids
    .slice(1)
    .map((id, i) => ({
      key: nodeKey("note", id),
      kind: "note",
      label: `Note ${i + 1}`,
      hop: 1,
      createdAt: i + 2,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const literal = {
    centre,
    nodes: [
      { key: centre, kind: "note", label: "Note 0", hop: 0, createdAt: 1 },
      {
        key: articleKey,
        kind: "article",
        label: "Shared source",
        hop: 1,
        createdAt: 1,
      },
      ...neighbours,
    ],
    edges: [articleKey, ...neighbours.map((n) => n.key)].map((key) => ({
      id: pairKey(centre, key),
      a: centre,
      b: key,
      reasons: [
        {
          type: "article",
          text:
            key === articleKey
              ? "From this article"
              : "Same article: Shared source",
        },
      ],
      needsAi: false,
    })),
  };
  // Normalise optional undefined fields as Convex's public serializer does.
  const plain = (value: Graph | null) => JSON.parse(JSON.stringify(value));
  const read = () =>
    t.run(async (ctx) => {
      const graph = await buildGraph(ctx, libraryId, { centre }, fullBudget());
      return {
        graph: plain(graph),
        metrics: await ctx.meta.getTransactionMetrics(),
      };
    });
  const first = await read();
  expect(first.graph).toEqual(literal);
  const second = await read();
  expect(second).toEqual(first);
  expect(first.metrics.bytesWritten.used).toBe(0);
  // Restore the pre-change phase-local title helper: centre title and a
  // separate second-ring title (shared only among its neighbours).
  const negative = await t.run(async (ctx) => {
    let initial = true;
    const later = new Map<string, Promise<string | null>>();
    const budget = fullBudget();
    const title = vi
      .spyOn(RequestArticleReads.prototype, "title")
      .mockImplementation((id) => {
        if (initial) {
          initial = false;
          return articleTitle(ctx, libraryId, id, budget);
        }
        let read = later.get(id);
        if (!read) {
          read = articleTitle(ctx, libraryId, id, budget);
          later.set(id, read);
        }
        return read;
      });
    const graph = await buildGraph(ctx, libraryId, { centre }, budget);
    title.mockRestore();
    return {
      graph: plain(graph),
      metrics: await ctx.meta.getTransactionMetrics(),
    };
  });
  expect(negative.graph).toEqual(literal);
  expect(
    negative.metrics.bytesRead.used - first.metrics.bytesRead.used,
  ).toBeGreaterThan(300_000);
  expect(
    negative.metrics.documentsRead.used - first.metrics.documentsRead.used,
  ).toBe(1);
  const session = auth._id;
  const revision = await client.query(api.discoveryRevision.current, {
    session,
  });
  for (const modern of [false, true]) {
    const result = await client.run(async (ctx) => {
      const value = modern
        ? (
            await ctx.runQuery(api.discoveryRevision.graph, {
              session,
              revision,
              centre,
            })
          ).graph
        : await ctx.runQuery(api.ideaGraph.graph, { centre });
      return { value, metrics: await ctx.meta.getTransactionMetrics() };
    });
    expect(plain(result.value)).toEqual(literal);
    expect(result.metrics.bytesWritten.used).toBe(0);
    evidence(modern ? "public revision" : "public legacy", result.metrics);
  }
  evidence("helper memo vs old phase helper", {
    memo: first.metrics,
    oldPhaseHelper: negative.metrics,
  });
  await t.run((ctx) =>
    ctx.db.patch(articleId, { title: "Changed between requests" }),
  );
  const changed = await client.query(api.ideaGraph.graph, { centre });
  expect(changed.nodes.find((n) => n.key === articleKey)?.label).toBe(
    "Changed between requests",
  );
  expect(
    changed.edges
      .flatMap((e) => e.reasons)
      .some((r) => r.text === "Same article: Changed between requests"),
  ).toBe(true);
});

it("joins concurrent raw reads, keys exact limits, retains owned titles after cap, and never caches denial or another context", async () => {
  const t = fixture();
  await t.run(async (ctx) => {
    const id = await article(ctx, "a");
    await notes(ctx, "a", id);
    const budget = new ReadBudget(160, 1);
    const memo = new RequestArticleReads(ctx, "a", budget);
    const before = await ctx.meta.getTransactionMetrics();
    expect(
      await Promise.all([memo.title(id), memo.title(id), memo.title(id)]),
    ).toEqual(Array(3).fill("Shared source"));
    expect(budget.mayReadArticle).toBe(false);
    expect(await memo.title(id)).toBe("Shared source");
    const titled = await ctx.meta.getTransactionMetrics();
    expect(titled.documentsRead.used - before.documentsRead.used).toBe(1);
    const per = { notes: 2, highlights: 0, answers: 0 };
    const [a, b] = await Promise.all([
      memo.onArticle(id, per),
      memo.onArticle(id, per),
    ]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    expect(await memo.onArticle(id, { ...per, notes: 3 })).toHaveLength(3);
    const discovered = await ctx.meta.getTransactionMetrics();
    expect(discovered.documentsRead.used - titled.documentsRead.used).toBe(5);
    budget.charge({ body: "x".repeat(12 * 1024 * 1024) });
    const depleted = await ctx.meta.getTransactionMetrics();
    expect(budget.allow(1)).toBe(0);
    expect(await memo.title(id)).toBe("Shared source");
    expect(await memo.onArticle(id, per)).toEqual(a);
    expect(await ctx.meta.getTransactionMetrics()).toEqual(depleted);
    expect(memo.matches({ db: ctx.db }, "a", budget)).toBe(true);
    expect(memo.matches(ctx, "b", budget)).toBe(false);
    expect(memo.matches(ctx, "a", fullBudget())).toBe(false);
    expect(memo.matches({ db: new Proxy(ctx.db, {}) }, "a", budget)).toBe(
      false,
    );
    const denied = new RequestArticleReads(ctx, "a", new ReadBudget(0, 0));
    expect(await denied.title(id)).toBeNull();
    expect(await denied.onArticle(id, per)).toEqual([]);
    expect(
      await new RequestArticleReads(ctx, "a", fullBudget()).title(id),
    ).toBe("Shared source");
    expect(
      await new RequestArticleReads(ctx, "b", fullBudget()).title(id),
    ).toBeNull();
    const foreign = new RequestArticleReads(ctx, "b", fullBudget());
    const start = await ctx.meta.getTransactionMetrics();
    expect(await foreign.title(id)).toBeNull();
    expect(await foreign.title(id)).toBeNull();
    expect(
      (await ctx.meta.getTransactionMetrics()).documentsRead.used -
        start.documentsRead.used,
    ).toBe(1);
  });
});

it("raw reuse leaves per-idea links, exclusions, reasons and vault via intact; other readers and budgets cannot borrow it", async () => {
  const t = fixture();
  await t.run(async (ctx) => {
    const id = await article(ctx, "a");
    const ids = await notes(ctx, "a", id, 3);
    const keys = ids.map((id) => nodeKey("note", id));
    const via = await ctx.db.insert("noteChunks", {
      userId: "a",
      filePath: "one.md",
      fileName: "one.md",
      chunkIndex: 0,
      content: "passage",
      embedding: [1],
      fileHash: "one",
      indexedAt: 1,
    });
    const tagId = await ctx.db.insert("tags", {
      userId: "a",
      name: "Shared",
      key: "shared",
      status: "active",
      count: 1,
      aliases: [],
      createdAt: 1,
    });
    await ctx.db.insert("articleTags", {
      userId: "a",
      articleId: id,
      tagId,
      createdAt: 1,
    });
    await ctx.db.insert("annotations", {
      userId: "a",
      articleId: id,
      type: "cross_reference",
      anchorText: "a",
      anchorStartOffset: 0,
      anchorEndOffset: 1,
      content: "connection",
      relevanceScore: 1,
      wasViewed: false,
      wasDismissed: false,
      createdAt: 1,
      notePath: "one.md",
      noteChunkId: via,
    });
    await ctx.db.insert("ideaLinks", {
      userId: "a",
      from: keys[0],
      to: keys[2],
      createdAt: 1,
    });
    const budget = fullBudget();
    const memo = new RequestArticleReads(ctx, "a", budget);
    const loaded = await Promise.all(
      keys.map((key) => loadNode(ctx, "a", key)),
    );
    if (!loaded[0] || !loaded[1]) throw new Error("Missing fixture node");
    const first = (
      await gatherCandidates(ctx, "a", loaded[0], [], budget, memo)
    ).ranked(30);
    const beforeNext = await ctx.meta.getTransactionMetrics();
    const next = (
      await gatherCandidates(ctx, "a", loaded[1], [], budget, memo)
    ).ranked(30);
    expect((await ctx.meta.getTransactionMetrics()).documentsRead.used).toBe(
      beforeNext.documentsRead.used,
    );
    expect(first.some((c) => c.key === keys[0])).toBe(false);
    expect(next.some((c) => c.key === keys[1])).toBe(false);
    expect(
      first.find((c) => c.key === keys[2])?.reasons.map((r) => r.type),
    ).toEqual(["linked", "article"]);
    expect(
      next.find((c) => c.key === keys[2])?.reasons.map((r) => r.type),
    ).toEqual(["article"]);
    expect(next.find((c) => c.key === "vault:one.md")?.via).toBe(via);
    const source = await loadNode(ctx, "a", nodeKey("article", id));
    if (!source) throw new Error("Missing source");
    const sourceCandidates = (
      await gatherCandidates(ctx, "a", source, [], budget, memo)
    ).ranked(30);
    expect(sourceCandidates.find((c) => c.key === keys[0])?.reasons).toEqual([
      { type: "article", text: "From this article" },
    ]);
    const other = (
      await gatherCandidates(ctx, "b", loaded[0], [], fullBudget(), memo)
    ).ranked(30);
    expect(other.some((c) => c.key === keys[2])).toBe(false);
    const denied = (
      await gatherCandidates(
        ctx,
        "a",
        loaded[0],
        [],
        new ReadBudget(0, 0),
        memo,
      )
    ).ranked(30);
    expect(denied.some((c) => c.key === keys[2])).toBe(false);
  });
});
