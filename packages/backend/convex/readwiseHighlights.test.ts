/// <reference types="vite/client" />

import { getFunctionName } from "convex/server";
import { getDocumentSize } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadataContext } from "../test/metadata";
import { ownerTest, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { purgeArticleMetadata } from "./articleMetadata";
import { articleProjection } from "./lib/articleMetadata";
import { purgeFeedPolls } from "./lib/feedPollLifecycle";
import { purgeFingerprintMetadata } from "./lib/fingerprintMetadata";
import {
  hasHighlightText,
  purgeHighlightIdentities,
  syncHighlightIdentity,
} from "./lib/highlightIdentity";
import { purgeManualAnnotations } from "./lib/manualAnnotations";
import { purgePreparedPage } from "./preparedArticles";
import { purgeReadingResumes } from "./readingResume";
import schema from "./schema";
import { purgeMetadata } from "./vaultFiles";

// Main owns registration. Exercise the exact pending registration hunk without
// editing its shared metadataTriggers.ts file in this worker.
vi.mock("./lib/metadataTriggers", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./lib/metadataTriggers")>();
  const { highlightIdentityTrigger, highlightArticleIdentityTrigger } =
    await import("./lib/highlightIdentity");
  if (
    !original.metadataTriggers.registered.highlights?.includes(
      highlightIdentityTrigger,
    )
  )
    original.metadataTriggers.register("highlights", highlightIdentityTrigger);
  if (
    !original.metadataTriggers.registered.articles?.includes(
      highlightArticleIdentityTrigger,
    )
  )
    original.metadataTriggers.register(
      "articles",
      highlightArticleIdentityTrigger,
    );
  return original;
});
vi.mock("./lib/router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/router")>()),
  embedForLibrary: vi.fn().mockResolvedValue(null),
}));
const modules = import.meta.glob("./**/*.ts");
const userId = "default_user";
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("READWISE_TOKEN", "");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Unexpected fixture network request")),
  );
});
const article = (owner = userId, readerDocumentId = "parent") => ({
  userId: owner,
  guid: readerDocumentId,
  url: `https://example.com/${readerDocumentId}`,
  title: "Synthetic Reader parent",
  readerDocumentId,
  extractionStatus: "extracted" as const,
  annotationStatus: "annotated" as const,
  createdAt: 1,
});
type Test = Pick<ReturnType<typeof convexTest>, "run" | "mutation">;
async function parent(t: Test, owner = userId, readerId = "parent") {
  return t.run((raw) =>
    metadataContext(raw).db.insert("articles", article(owner, readerId)),
  );
}
async function prepare(t: Test, articleId: Id<"articles">, owner = userId) {
  for (let i = 0; i < 100; i++) {
    const result = await t.mutation(
      internal.readwise.prepareHighlightIdentities,
      {
        userId: owner,
        articleId,
      },
    );
    if (result.ready || result.unavailable) return result;
  }
  throw new Error("Synthetic identity migration exceeded 100 pages");
}
const passage = (
  articleId: Id<"articles">,
  text = "Same passage",
  id = "r1",
) => ({
  userId,
  articleId,
  readerHighlightId: id,
  text,
});
async function phase(t: Test, token = "fixture-lease") {
  await t.mutation(internal.readwiseSyncState.claim, { userId, token });
  await t.run(async (ctx) => {
    const state = await ctx.db.query("readwiseSyncState").first();
    if (!state) throw new Error("Missing fixture lease");
    await ctx.db.patch(state._id, { phase: 3 });
  });
}
async function measuredSync(
  t: ReturnType<typeof convexTest>,
  afterQuery?: (name: string) => Promise<void>,
) {
  const { sync } = await import("./actions/readwiseSync");
  // SAFETY: Convex runtime registration exposes _handler (registration_impl.ts), but
  // its published declarations strip that internal test seam. Keep the adapter
  // narrow: the real action/context/args are unchanged, with no production cast.
  const registered = sync as typeof sync & {
    _handler: (ctx: ActionCtx, args: { userId: string }) => Promise<void>;
  };
  let bytesRead = 0;
  let parentQueries = 0;
  await t.action((ctx) =>
    registered._handler(
      {
        ...ctx,
        runQuery: async (ref, ...args) => {
          if (getFunctionName(ref) === "readwise:findArticle") parentQueries++;
          const measured = await t.query(async (qctx) => {
            const value = await qctx.runQuery(ref, ...args);
            return { value, metrics: await qctx.meta.getTransactionMetrics() };
          });
          bytesRead += measured.metrics.bytesRead.used;
          await afterQuery?.(getFunctionName(ref));
          return measured.value;
        },
        runMutation: async (ref, ...args) => {
          const measured = await t.mutation(async (mctx) => {
            const value = await mctx.runMutation(ref, ...args);
            return { value, metrics: await mctx.meta.getTransactionMetrics() };
          });
          bytesRead += measured.metrics.bytesRead.used;
          return measured.value;
        },
      },
      { userId },
    ),
  );
  return { bytesRead, parentQueries };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("B11 account and article lifecycle integration", () => {
  it("lets empty identity cleanup reach the actual vault page and then finish the existing metadata step", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { bytesRead: 4 * 1024 * 1024 },
    });
    const removedUser = "deleted-b11-library";
    await t.run((ctx) =>
      ctx.db.insert("vaultFiles", {
        userId: removedUser,
        filePath: "x".repeat(990_000),
        fileHash: "fixture",
      }),
    );
    // Exact c733 account metadata ordering, with the pending main-owned B11
    // addition immediately before vault cleanup. One real transaction/guard.
    const metadataStep = () =>
      t.run(async (ctx) => {
        for (const purge of [
          purgePreparedPage,
          purgeFeedPolls,
          purgeFingerprintMetadata,
          purgeReadingResumes,
          purgeArticleMetadata,
          purgeManualAnnotations,
          purgeHighlightIdentities,
        ]) {
          const removed = await purge(ctx, removedUser);
          if (removed) return removed;
        }
        return (await purgeMetadata(ctx, removedUser)) || -2;
      });
    expect(await metadataStep()).toBe(1);
    // Empty/exhausted is finite, not a negative sentinel that loops forever.
    expect(await metadataStep()).toBe(-2);
    expect(await t.run((ctx) => ctx.db.query("vaultFiles").take(1))).toEqual(
      [],
    );
  });

  it("purges only compact metadata in bounded take batches without reading near-limit source bodies", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { bytesRead: 128 * 1024 },
    });
    const libraryId = "b11-purge-library";
    const readerId = await t.run((ctx) =>
      ctx.db.insert("readers", {
        authId: "synthetic-b11-auth",
        libraryId,
        status: "active",
        createdAt: 0,
      }),
    );
    const articleId = await parent(t, libraryId);
    for (let i = 0; i < 33; i++)
      await t.run(async (ctx) => {
        const fields = {
          userId: libraryId,
          articleId,
          kind: "highlight" as const,
          text: "x".repeat(990_000),
          embedding: Array(1536).fill(0.125),
          createdAt: i,
        };
        const highlightId = await ctx.db.insert("highlights", fields);
        // Supply the insertion's source snapshot without rereading its giant body.
        await syncHighlightIdentity(ctx, null, {
          ...fields,
          _id: highlightId,
          _creationTime: i,
        });
      });
    for (let i = 0; i < 65; i++)
      await t.run(async (ctx) => {
        const stateArticleId =
          i === 0
            ? articleId
            : await ctx.db.insert(
                "articles",
                article(libraryId, `state-parent-${i}`),
              );
        await ctx.db.insert("highlightIdentityState", {
          userId: libraryId,
          articleId: stateArticleId,
          ready: false,
          cursor: `synthetic-cursor-${i}`,
        });
      });
    const metadata = await t.run(async (ctx) => [
      ...(await ctx.db.query("highlightIdentities").take(33)),
      ...(await ctx.db.query("highlightIdentityState").take(65)),
    ]);
    const maxMetadataRowBytes = Math.max(
      ...metadata.map((row) => getDocumentSize(row)),
    );
    expect(maxMetadataRowBytes).toBeLessThan(1024);
    await t.run((ctx) => ctx.db.patch(readerId, { deletingAt: 1 }));
    const removed: number[] = [];
    const physicalReadBytes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const result = await t.run(async (ctx) => {
        const count = await purgeHighlightIdentities(ctx, libraryId);
        return { count, metrics: await ctx.meta.getTransactionMetrics() };
      });
      expect(result.metrics.bytesRead.used).toBeLessThan(128 * 1024);
      physicalReadBytes.push(result.metrics.bytesRead.used);
      removed.push(result.count);
      if (!result.count) break;
    }
    expect(removed).toEqual([32, 1, 64, 1, 0]);
    console.info("B11 compact purge physical bounds:", {
      removed,
      physicalReadBytes,
      maxMetadataRowBytes,
    });
  });

  it.each([
    "ready",
    "partial",
  ] as const)("invalidates %s readiness on owner transfer without adopting another reader's marks", async (initial) => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    const articleId = await parent(t);
    const oldIds = await t.run(async (ctx) => {
      const ids: Id<"highlights">[] = [];
      for (let i = 0; i < 40; i++)
        ids.push(
          await ctx.db.insert("highlights", {
            userId,
            articleId,
            kind: "underline",
            color: "cobalt",
            text:
              i === 0
                ? "Private A passage"
                : i === 1
                  ? "x".repeat(990_000)
                  : `A legacy ${i}`,
            createdAt: i,
          }),
        );
      return ids;
    });
    if (initial === "ready") await prepare(t, articleId);
    else
      expect(
        await t.mutation(internal.readwise.prepareHighlightIdentities, {
          userId,
          articleId,
        }),
      ).toMatchObject({ ready: false });
    const before = await t.run((ctx) =>
      ctx.db.query("highlightIdentityState").first(),
    );
    expect(before?.ready).toBe(initial === "ready");
    await t.run((raw) =>
      metadataContext(raw).db.patch(articleId, { userId: readerLibraryId }),
    );
    expect(
      await t.run((ctx) => ctx.db.query("highlightIdentityState").first()),
    ).toBeNull();
    // Also recover safely from stale derived state that predates invalidation;
    // the new owner must restart, never adopt this foreign cursor or readiness.
    if (!before) throw new Error("Missing prior identity state");
    await t.run((ctx) =>
      ctx.db.insert("highlightIdentityState", {
        userId,
        articleId,
        ready: before.ready,
        cursor: before.cursor,
      }),
    );
    expect(
      await t.mutation(internal.readwise.prepareHighlightIdentities, {
        userId,
        articleId,
      }),
    ).toEqual({ ready: false, unavailable: true });
    await expect(
      t.mutation(
        internal.readwise.importHighlight,
        passage(articleId, "Stale old-owner publication", "old-owner-replay"),
      ),
    ).rejects.toThrow("Article not found");
    const b = await t.run(async (ctx) => {
      const result = await ctx.runMutation(
        internal.readwise.prepareHighlightIdentities,
        { userId: readerLibraryId, articleId },
        { transactionLimits: { bytesRead: 128 * 1024 } },
      );
      return { result, metrics: await ctx.meta.getTransactionMetrics() };
    });
    expect(b.result).toEqual({ ready: true, unavailable: false });
    expect(b.metrics.bytesRead.used).toBeLessThan(128 * 1024);
    console.info("B11 owner-transfer preparation physical bytes:", {
      initial,
      bytesRead: b.metrics.bytesRead.used,
    });
    expect(
      await t.mutation(internal.readwise.importHighlight, {
        ...passage(articleId, "Private A passage", "new-owner"),
        userId: readerLibraryId,
      }),
    ).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(oldIds[0]))).toMatchObject({
      userId,
      text: "Private A passage",
      color: "cobalt",
    });
    const bIdentities = await t.run((ctx) =>
      ctx.db
        .query("highlightIdentities")
        .withIndex("by_userId", (q) => q.eq("userId", readerLibraryId))
        .take(2),
    );
    expect(bIdentities).toHaveLength(1);
    expect(oldIds).not.toContain(bIdentities[0].highlightId);
    await t.run((raw) => metadataContext(raw).db.delete(articleId));
    expect(
      await t.run((ctx) => ctx.db.query("highlightIdentityState").first()),
    ).toBeNull();
    expect(
      await t.mutation(internal.readwise.prepareHighlightIdentities, {
        userId: readerLibraryId,
        articleId,
      }),
    ).toEqual({ ready: false, unavailable: true });
  });

  it("removes partial readiness on actual article deletion and late replay cannot recreate it", async () => {
    const t = await ownerTest(modules);
    const articleId = await parent(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 40; i++)
        await ctx.db.insert("highlights", {
          userId,
          articleId,
          kind: "highlight",
          text: `Partial ${i}`,
          createdAt: i,
        });
    });
    expect(
      await t.mutation(internal.readwise.prepareHighlightIdentities, {
        userId,
        articleId,
      }),
    ).toMatchObject({ ready: false });
    await t.run((raw) => metadataContext(raw).db.delete(articleId));
    expect(
      await t.run((ctx) => ctx.db.query("highlightIdentityState").first()),
    ).toBeNull();
    expect(
      await t.mutation(internal.readwise.prepareHighlightIdentities, {
        userId,
        articleId,
      }),
    ).toEqual({ ready: false, unavailable: true });
    expect(
      await t.run((ctx) => ctx.db.query("highlights").take(50)),
    ).toHaveLength(40);
  });
});

describe("exact private Reader highlight identities", () => {
  it("does not guess readiness, normalizes complete whitespace only, and preserves native colours/baselines", async () => {
    const t = await ownerTest(modules);
    const articleId = await parent(t);
    const native = await t.run((raw) =>
      metadataContext(raw).db.insert("highlights", {
        userId,
        articleId,
        kind: "underline",
        text: " Same\n\tpassage ",
        color: "vermilion",
        createdAt: 1,
      }),
    );
    await expect(
      t.mutation(internal.readwise.importHighlight, passage(articleId)),
    ).rejects.toThrow("not ready");
    await prepare(t, articleId);
    expect(
      await t.mutation(internal.readwise.importHighlight, passage(articleId)),
    ).toBe(false);
    expect(
      await t.mutation(
        internal.readwise.importHighlight,
        passage(articleId, "same passage", "case"),
      ),
    ).toBe(true);
    await t.mutation(internal.readwise.setHighlightReaderId, {
      highlightId: native,
      readerHighlightId: "arrived-late",
    });
    expect(
      await t.mutation(
        internal.readwise.importHighlight,
        passage(articleId, "Changed upstream text", "arrived-late"),
      ),
    ).toBe(false);
    expect(await t.run((ctx) => ctx.db.get(native))).toMatchObject({
      text: " Same\n\tpassage ",
      color: "vermilion",
      kind: "underline",
    });
    expect(
      await t.run((ctx) => ctx.db.query("legacyMarkDefaults").take(2)),
    ).toEqual([]);
  });

  it("isolates readers/articles and follows native edits, ID completion, replacement and deletion", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    const a = await parent(t);
    const b = await parent(t, userId, "second");
    const c = await parent(t, readerLibraryId, "other-reader");
    await prepare(t, a);
    await prepare(t, b);
    await prepare(t, c, readerLibraryId);
    expect(
      await t.mutation(internal.readwise.importHighlight, passage(a)),
    ).toBe(true);
    expect(
      await t.mutation(
        internal.readwise.importHighlight,
        passage(b, "Same passage", "r2"),
      ),
    ).toBe(true);
    expect(
      await t.mutation(internal.readwise.importHighlight, {
        ...passage(c),
        userId: readerLibraryId,
      }),
    ).toBe(true);
    await expect(
      t.mutation(
        internal.readwise.importHighlight,
        passage(c, "Private", "r3"),
      ),
    ).rejects.toThrow("Article not found");
    const source = await t.run((ctx) =>
      ctx.db
        .query("highlights")
        .withIndex("by_article", (q) => q.eq("articleId", a))
        .first(),
    );
    if (!source) throw new Error("Missing fixture mark");
    await t.run((raw) =>
      metadataContext(raw).db.patch(source._id, {
        text: "Edited text",
        readerHighlightId: undefined,
      }),
    );
    expect(
      await t.mutation(
        internal.readwise.importHighlight,
        passage(a, "Edited\ntext", "edited"),
      ),
    ).toBe(false);
    expect(
      await t.mutation(
        internal.readwise.importHighlight,
        passage(a, "Same passage", "original"),
      ),
    ).toBe(true);
    await t.run((raw) => metadataContext(raw).db.delete(source._id));
    expect(
      await t.mutation(
        internal.readwise.importHighlight,
        passage(a, "Edited text", "after-delete"),
      ),
    ).toBe(true);
  });

  it("serializes overlapping import replays with native echo publication and rejects a changed cached parent", async () => {
    const t = await ownerTest(modules);
    const articleId = await parent(t);
    await prepare(t, articleId);
    const native = await t.mutation(api.highlights.create, {
      articleId,
      kind: "underline",
      text: "Concurrent native passage",
    });
    expect(
      await Promise.all([
        t.mutation(
          internal.readwise.importHighlight,
          passage(articleId, "Concurrent\nnative passage", "echo-one"),
        ),
        t.mutation(
          internal.readwise.importHighlight,
          passage(articleId, "Concurrent native passage", "echo-two"),
        ),
      ]),
    ).toEqual([false, false]);
    expect(
      await Promise.all([
        t.mutation(
          internal.readwise.importHighlight,
          passage(articleId, "New concurrent import", "new-one"),
        ),
        t.mutation(
          internal.readwise.importHighlight,
          passage(articleId, "New concurrent import", "new-two"),
        ),
      ]),
    ).toEqual([true, false]);
    await t.run((raw) =>
      metadataContext(raw).db.patch(articleId, { readerDocumentId: "changed" }),
    );
    await expect(
      t.mutation(internal.readwise.importHighlight, {
        ...passage(articleId, "Stale parent", "stale-parent"),
        readerDocumentId: "parent",
      }),
    ).rejects.toThrow("parent changed");
    expect(await t.run((ctx) => ctx.db.get(native))).toMatchObject({
      text: "Concurrent native passage",
    });
    expect(
      await t.run((ctx) => ctx.db.query("highlights").take(5)),
    ).toHaveLength(2);
  });

  it("preserves library-wide Reader-ID dedup before another article's text identities migrate", async () => {
    const t = await ownerTest(modules);
    const a = await parent(t);
    const b = await parent(t, userId, "unmigrated-parent");
    await t.run((ctx) =>
      ctx.db.insert("highlights", {
        userId,
        articleId: b,
        kind: "highlight",
        text: "Existing on a legacy parent",
        readerHighlightId: "global-id",
        createdAt: 1,
      }),
    );
    await prepare(t, a);
    expect(
      await t.mutation(
        internal.readwise.importHighlight,
        passage(a, "Different upstream passage", "global-id"),
      ),
    ).toBe(false);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("highlights")
          .withIndex("by_article", (q) => q.eq("articleId", a))
          .take(1),
      ),
    ).toEqual([]);
  });

  it("does not truncate long shared prefixes or initialize/repaint an existing canonical baseline", async () => {
    const t = await ownerTest(modules);
    const articleId = await parent(t);
    const legacy = await t.run((ctx) =>
      ctx.db.insert("highlights", {
        userId,
        articleId,
        kind: "highlight",
        text: "Uncoloured legacy",
        createdAt: 1,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("legacyMarkDefaults", {
        userId,
        kind: "highlight",
        color: "blue",
        version: 1,
        status: "done",
        cursor: null,
      }),
    );
    const baseline = await t.run((ctx) =>
      ctx.db.query("legacyMarkDefaults").first(),
    );
    await prepare(t, articleId);
    const prefix = "p".repeat(200_000);
    expect(
      await t.mutation(
        internal.readwise.importHighlight,
        passage(articleId, `${prefix}A`, "long-a"),
      ),
    ).toBe(true);
    expect(
      await t.mutation(
        internal.readwise.importHighlight,
        passage(articleId, `${prefix}B`, "long-b"),
      ),
    ).toBe(true);
    expect(
      await t.mutation(
        internal.readwise.importHighlight,
        passage(articleId, ` ${prefix}B\n`, "long-echo"),
      ),
    ).toBe(false);
    expect((await t.run((ctx) => ctx.db.get(legacy)))?.color).toBeUndefined();
    expect(
      await t.run((ctx) => ctx.db.query("legacyMarkDefaults").first()),
    ).toEqual(baseline);
  });

  it("backfills beyond 500 with byte-bounded pages, retaining concurrent inserts/edits/deletes behind its cursor", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { bytesRead: 4 * 1024 * 1024 },
    });
    const articleId = await parent(t);
    let first: Id<"highlights"> | undefined;
    for (let offset = 0; offset < 510; offset += 30) {
      await t.run(async (ctx) => {
        for (let i = offset; i < Math.min(offset + 30, 510); i++) {
          const id = await ctx.db.insert("highlights", {
            userId,
            articleId,
            kind: "highlight",
            text: `legacy ${i}`,
            embedding: Array(1536).fill(0.125),
            createdAt: i,
          });
          if (i === 0) first = id;
        }
      });
    }
    expect(
      await t.mutation(internal.readwise.prepareHighlightIdentities, {
        userId,
        articleId,
      }),
    ).toEqual({ ready: false, unavailable: false });
    if (!first) throw new Error("Missing first mark");
    const firstId = first;
    await t.run(async (raw) => {
      const ctx = metadataContext(raw);
      await ctx.db.patch(firstId, { text: "edited behind cursor" });
      await ctx.db.insert("highlights", {
        userId,
        articleId,
        kind: "underline",
        text: "new while migrating",
        createdAt: 2,
      });
    });
    await prepare(t, articleId);
    for (const text of [
      "legacy 509",
      "edited behind cursor",
      "new while migrating",
    ])
      expect(
        await t.mutation(
          internal.readwise.importHighlight,
          passage(articleId, text, text),
        ),
      ).toBe(false);
    await t.run((raw) => metadataContext(raw).db.delete(firstId));
    expect(
      await t.mutation(
        internal.readwise.importHighlight,
        passage(articleId, "edited behind cursor", "after-delete"),
      ),
    ).toBe(true);
  });

  it("compares the full passage even on hash collisions and refuses an incomplete collision bucket", async () => {
    const t = await ownerTest(modules);
    const articleId = await parent(t);
    await prepare(t, articleId);
    await t.mutation(
      internal.readwise.importHighlight,
      passage(articleId, "prefix A", "one"),
    );
    const { sha256Hex } = await import("./lib/tokens");
    await t.run(async (ctx) => {
      const row = await ctx.db.query("highlightIdentities").first();
      if (!row) throw new Error("Missing identity");
      await ctx.db.patch(row._id, { textHash: await sha256Hex("prefix B") });
    });
    expect(
      await t.mutation(
        internal.readwise.importHighlight,
        passage(articleId, "prefix B", "two"),
      ),
    ).toBe(true);
    await t.run(async (ctx) => {
      const mark = await ctx.db.query("highlights").first();
      if (!mark) throw new Error("Missing source");
      const textHash = await sha256Hex("budget collision");
      for (let i = 0; i < 33; i++)
        await ctx.db.insert("highlightIdentities", {
          userId,
          articleId,
          highlightId: mark._id,
          textHash,
        });
    });
    await expect(
      t.mutation(
        internal.readwise.importHighlight,
        passage(articleId, "budget collision", "collision"),
      ),
    ).rejects.toThrow("bucket exceeds budget");
  });

  it("commits source, exact identity, embedding schedule and page acknowledgement atomically, and fences stale leases", async () => {
    vi.useFakeTimers();
    const t = await ownerTest(modules);
    const articleId = await parent(t);
    await prepare(t, articleId);
    await phase(t);
    const args = { ...passage(articleId), syncToken: "fixture-lease" };
    expect(await t.mutation(internal.readwise.importHighlight, args)).toBe(
      true,
    );
    expect(await t.mutation(internal.readwise.importHighlight, args)).toBe(
      false,
    );
    expect(
      await t.run((ctx) => ctx.db.query("readwiseSyncState").first()),
    ).toMatchObject({ highlights: 1, pageProcessedIds: ["r1"] });
    expect(
      await t.run((ctx) => ctx.db.query("highlights").take(5)),
    ).toHaveLength(1);
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      jobs.filter((job) => job.name.includes("embedHighlight")),
    ).toHaveLength(1);
    await expect(
      t.mutation(internal.readwise.importHighlight, {
        ...args,
        readerHighlightId: "stale",
        syncToken: "old",
      }),
    ).rejects.toThrow("lease expired");
    vi.setSystemTime(Date.now() + 16 * 60_000);
    await expect(
      t.mutation(internal.readwise.importHighlight, {
        ...args,
        readerHighlightId: "expired",
      }),
    ).rejects.toThrow("lease expired");
  });

  it("rolls back the mark, identity and acknowledgement when scheduling cannot commit", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { functionsScheduled: 0 },
    });
    const articleId = await parent(t);
    await prepare(t, articleId);
    await phase(t);
    await expect(
      t.mutation(internal.readwise.importHighlight, {
        ...passage(articleId),
        syncToken: "fixture-lease",
      }),
    ).rejects.toThrow(/schedul/i);
    expect(await t.run((ctx) => ctx.db.query("highlights").take(2))).toEqual(
      [],
    );
    expect(
      await t.run((ctx) => ctx.db.query("highlightIdentities").take(2)),
    ).toEqual([]);
    expect(
      await t.run((ctx) => ctx.db.query("readwiseSyncState").first()),
    ).toMatchObject({ highlights: 0, pageProcessedIds: [] });
  });

  it("does not resurrect a deleted/deleting library, retains disabled writers, and purges only the deleted owner", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    const a = await parent(t);
    const b = await parent(t, readerLibraryId);
    await prepare(t, a);
    await prepare(t, b, readerLibraryId);
    await t.mutation(internal.readwise.importHighlight, passage(a));
    await t.mutation(internal.readwise.importHighlight, {
      ...passage(b),
      userId: readerLibraryId,
    });
    await t.run(async (ctx) => {
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", readerLibraryId))
        .first();
      if (!reader) throw new Error("Missing reader");
      await ctx.db.patch(reader._id, { status: "disabled" });
    });
    await t.run(async (raw) => {
      const mark = await raw.db
        .query("highlights")
        .withIndex("by_userId", (q) => q.eq("userId", readerLibraryId))
        .first();
      if (!mark) throw new Error("Missing retained source");
      await metadataContext(raw).db.patch(mark._id, { text: "disabled edit" });
    });
    expect(
      await t.run((ctx) =>
        hasHighlightText(ctx, readerLibraryId, b, "disabled edit"),
      ),
    ).toBe(true);
    await expect(
      t.mutation(internal.readwise.importHighlight, {
        ...passage(b),
        userId: readerLibraryId,
      }),
    ).rejects.toThrow("Article not found");
    await t.run(async (ctx) => {
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", readerLibraryId))
        .first();
      if (reader) await ctx.db.patch(reader._id, { deletingAt: 1 });
    });
    for (let i = 0; i < 5; i++)
      if (
        !(await t.run((ctx) => purgeHighlightIdentities(ctx, readerLibraryId)))
      )
        break;
    expect(
      await t.mutation(internal.readwise.prepareHighlightIdentities, {
        userId: readerLibraryId,
        articleId: b,
      }),
    ).toEqual({ ready: false, unavailable: true });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("highlightIdentities")
          .withIndex("by_userId", (q) => q.eq("userId", readerLibraryId))
          .take(5),
      ),
    ).toEqual([]);
    await t.run(async (raw) => {
      const source = await raw.db
        .query("highlights")
        .withIndex("by_userId", (q) => q.eq("userId", readerLibraryId))
        .first();
      if (source)
        await metadataContext(raw).db.patch(source._id, {
          text: "late writer after purge",
        });
    });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("highlightIdentities")
          .withIndex("by_userId", (q) => q.eq("userId", readerLibraryId))
          .take(5),
      ),
    ).toEqual([]);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("highlightIdentities")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .take(5),
      ),
    ).toHaveLength(1);
    await t.run((raw) => metadataContext(raw).db.delete(a));
    await expect(
      t.mutation(
        internal.readwise.importHighlight,
        passage(a, "deleted parent", "new"),
      ),
    ).rejects.toThrow("Article not found");
  });

  it("accepts exact near-limit legacy echoes, rejects new oversize UTF-8 safely, and ignores blank text", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { bytesRead: 4 * 1024 * 1024 },
    });
    const articleId = await parent(t);
    const text = "x".repeat(990_000);
    await t.run((ctx) =>
      ctx.db.insert("highlights", {
        userId,
        articleId,
        kind: "highlight",
        text,
        embedding: Array(1536).fill(0.125),
        createdAt: 1,
      }),
    );
    await prepare(t, articleId);
    expect(
      await t.mutation(
        internal.readwise.importHighlight,
        passage(articleId, text),
      ),
    ).toBe(false);
    expect(
      await t.mutation(
        internal.readwise.importHighlight,
        passage(articleId, "\n\t ", "empty"),
      ),
    ).toBe(false);
    await expect(
      t.mutation(
        internal.readwise.importHighlight,
        passage(articleId, "😀".repeat(262_145), "large"),
      ),
    ).rejects.toThrow("too large");
    await expect(
      t.mutation(
        internal.readwise.importHighlight,
        passage(articleId, "x".repeat(1_048_577), "too-large"),
      ),
    ).rejects.toThrow("too large");
    expect(
      await t.run((ctx) => ctx.db.query("highlights").take(2)),
    ).toHaveLength(1);
  });

  it("bounds physical source bytes in adversarial collision buckets without duplicate-producing early cutoff", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { bytesRead: 4 * 1024 * 1024 },
    });
    const articleId = await parent(t);
    await prepare(t, articleId);
    const { sha256Hex } = await import("./lib/tokens");
    const textHash = await sha256Hex("unmatched passage");
    for (let i = 0; i < 3; i++)
      await t.run(async (ctx) => {
        const highlightId = await ctx.db.insert("highlights", {
          userId,
          articleId,
          kind: "highlight",
          text: `${i}${"x".repeat(990_000)}`,
          createdAt: i,
        });
        await ctx.db.insert("highlightIdentities", {
          userId,
          articleId,
          highlightId,
          textHash,
        });
      });
    await expect(
      t.mutation(
        internal.readwise.importHighlight,
        passage(articleId, "unmatched passage", "budget"),
      ),
    ).rejects.toThrow("sources exceed budget");
    expect(
      await t.run((ctx) => ctx.db.query("highlights").take(4)),
    ).toHaveLength(3);
  });
});

describe("twenty-highlight Reader page physical budget", () => {
  it("does not cache a missing parent across later documents when it becomes linked during the page", async () => {
    vi.useFakeTimers();
    vi.stubEnv("READWISE_TOKEN", "isolated-test-token");
    const t = convexTest({ schema, modules });
    await phase(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("readwiseSyncState").first();
      if (row) await ctx.db.patch(row._id, { leaseUntil: 0, nextRunAt: 0 });
    });
    const results = Array.from({ length: 20 }, (_, i) => ({
      id: `late-parent-${i}`,
      parent_id: "parent",
      content: `Passage ${i}`,
    }));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ results, nextPageCursor: "next" })),
        ),
    );
    let linked = false;
    await measuredSync(t, async (name) => {
      if (name === "readwise:findArticle" && !linked) {
        linked = true;
        await parent(t);
      }
    });
    expect(
      await t.run((ctx) => ctx.db.query("readwiseSyncState").first()),
    ).toMatchObject({ highlights: 19, pageCursor: "next" });
    expect(
      await t.run((ctx) => ctx.db.query("highlights").take(21)),
    ).toHaveLength(19);
  });

  it("keeps ignored acknowledgements/cursor on incomplete migration, resumes safely, and refuses provider pages over 20", async () => {
    vi.useFakeTimers();
    vi.stubEnv("READWISE_TOKEN", "isolated-test-token");
    const t = await ownerTest(modules);
    const articleId = await parent(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 40; i++)
        await ctx.db.insert("highlights", {
          userId,
          articleId,
          kind: "highlight",
          text: `unmigrated ${i}`,
          createdAt: i,
        });
    });
    await phase(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("readwiseSyncState").first();
      if (row)
        await ctx.db.patch(row._id, {
          leaseUntil: 0,
          nextRunAt: 0,
          pageCursor: "interrupted-page",
        });
    });
    let results: unknown[] = [
      { id: "malformed", parent_id: "parent", content: { not: "text" } },
      { id: "valid", parent_id: "parent", content: "new after readiness" },
    ];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({ results, nextPageCursor: "next-page" }),
            ),
          ),
        ),
    );
    await t.action(internal.actions.readwiseSync.sync, { userId });
    expect(
      await t.run((ctx) => ctx.db.query("readwiseSyncState").first()),
    ).toMatchObject({
      phase: 3,
      pageCursor: "interrupted-page",
      pageProcessedIds: ["malformed"],
      highlights: 0,
      nextRunAt: Date.now() + 60_000,
      error: "Preparing highlight identities; resume this page",
    });
    await prepare(t, articleId);
    vi.setSystemTime(Date.now() + 61_000);
    await t.action(internal.actions.readwiseSync.sync, { userId });
    expect(
      await t.run((ctx) => ctx.db.query("readwiseSyncState").first()),
    ).toMatchObject({
      phase: 3,
      pageCursor: "next-page",
      highlights: 1,
      pageProcessedIds: [],
    });
    results = Array.from({ length: 21 }, (_, i) => ({
      id: `excess-${i}`,
      parent_id: "parent",
      content: "Must not import",
    }));
    vi.setSystemTime(Date.now() + 61_000);
    await t.action(internal.actions.readwiseSync.sync, { userId });
    expect(
      await t.run((ctx) => ctx.db.query("readwiseSyncState").first()),
    ).toMatchObject({
      phase: 3,
      pageCursor: "next-page",
      highlights: 1,
      pageProcessedIds: [],
      error: "Reader highlight page exceeds checkpoint limit",
    });
    expect(
      await t.run((ctx) => ctx.db.query("highlights").take(50)),
    ).toHaveLength(41);
  });

  it("reads a near-limit parent once and only exact candidate marks across twenty imports; the old 500-row scan fails", async () => {
    vi.useFakeTimers();
    vi.stubEnv("READWISE_TOKEN", "isolated-test-token");
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { bytesRead: 1_600_000 },
    });
    const articleId = await t.run(async (ctx) => {
      const fields = { ...article(), content: "x".repeat(990_000) };
      const id = await ctx.db.insert("articles", fields);
      await ctx.db.insert(
        "articleMetadata",
        articleProjection({ ...fields, _id: id, _creationTime: 1 }),
      );
      return id;
    });
    for (let offset = 0; offset < 500; offset += 20) {
      await t.run(async (raw) => {
        const ctx = metadataContext(raw);
        for (let i = offset; i < offset + 20; i++)
          await ctx.db.insert("highlights", {
            userId,
            articleId,
            kind: "underline",
            text: `existing ${i}`,
            embedding: Array(1536).fill(0.125),
            createdAt: i,
          });
      });
    }
    await prepare(t, articleId);
    await expect(
      t.run((ctx) =>
        ctx.db
          .query("highlights")
          .withIndex("by_article", (q) => q.eq("articleId", articleId))
          .take(500),
      ),
    ).rejects.toThrow("Read too much data");
    let totalBytes = 0;
    const parentRead = await t.query(async (ctx) => {
      const result = await ctx.runQuery(internal.readwise.findArticle, {
        userId,
        readerDocumentId: "parent",
      });
      return {
        id: result?._id,
        metrics: await ctx.meta.getTransactionMetrics(),
      };
    });
    expect(parentRead.id).toBe(articleId);
    totalBytes += parentRead.metrics.bytesRead.used;
    await phase(t);
    for (let i = 0; i < 20; i++) {
      const added = i >= 10;
      const result = await t.mutation(async (ctx) => {
        const result = await ctx.runMutation(
          internal.readwise.importHighlight,
          {
            ...passage(
              articleId,
              added ? `new ${i}` : ` existing\n${i} `,
              `page-${i}`,
            ),
            syncToken: "fixture-lease",
          },
        );
        return {
          added: result,
          metrics: await ctx.meta.getTransactionMetrics(),
        };
      });
      expect(result.added).toBe(added);
      expect(result.metrics.bytesRead.used).toBeLessThan(64_000);
      totalBytes += result.metrics.bytesRead.used;
    }
    expect(totalBytes).toBeLessThan(1_300_000);
    console.info(
      "B11 physical page bytes (parent + 20 atomic imports):",
      totalBytes,
    );
    const state = await t.run((ctx) =>
      ctx.db.query("readwiseSyncState").first(),
    );
    expect(state).toMatchObject({
      highlights: 10,
      pageProcessedIds: Array.from({ length: 20 }, (_, i) => `page-${i}`),
    });
    const docs = Array.from({ length: 20 }, (_, i) => ({
      id: `page-${i}`,
      parent_id: "parent",
      content: i < 10 ? `existing ${i}` : `new ${i}`,
      category: "highlight",
    }));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({ results: docs, nextPageCursor: "next-page" }),
            ),
          ),
        ),
    );
    // Simulate action interruption after committed per-mark acknowledgements.
    await t.run(async (ctx) => {
      const row = await ctx.db.query("readwiseSyncState").first();
      if (row) await ctx.db.patch(row._id, { leaseUntil: 0, nextRunAt: 0 });
    });
    await t.action(internal.actions.readwiseSync.sync, { userId });
    expect(
      await t.run((ctx) => ctx.db.query("readwiseSyncState").first()),
    ).toMatchObject({
      highlights: 10,
      pageCursor: "next-page",
      pageProcessedIds: [],
    });
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      jobs.filter((job) => job.name.includes("embedHighlight")),
    ).toHaveLength(10);
    // A subsequently repeated provider page executes the real phase loop. It
    // resolves the giant parent once, compares 20 exact candidates, and adds no
    // marks/schedules. Every query/mutation contributes actual storage bytes.
    await t.run(async (ctx) => {
      const row = await ctx.db.query("readwiseSyncState").first();
      if (row) await ctx.db.patch(row._id, { leaseUntil: 0, nextRunAt: 0 });
    });
    const realPage = await measuredSync(t);
    expect(realPage.parentQueries).toBe(1);
    expect(realPage.bytesRead).toBeLessThan(1_600_000);
    console.info("B11 repeated real page physical budget:", realPage);
    expect(
      await t.run((ctx) => ctx.db.query("readwiseSyncState").first()),
    ).toMatchObject({ highlights: 10 });
  });

  it("runs the real mocked-provider page, deduplicates within it, and keeps 60-second page pacing", async () => {
    vi.useFakeTimers();
    vi.stubEnv("READWISE_TOKEN", "isolated-test-token");
    const t = await ownerTest(modules);
    const articleId = await parent(t);
    await prepare(t, articleId);
    await phase(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("readwiseSyncState").first();
      if (row) await ctx.db.patch(row._id, { leaseUntil: 0, nextRunAt: 0 });
    });
    const docs = Array.from({ length: 20 }, (_, i) => ({
      id: `doc-${i}`,
      parent_id: "parent",
      content: i % 2 ? "same\npassage" : " same passage ",
      category: "highlight",
    }));
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ results: docs, nextPageCursor: "next" })),
      );
    vi.stubGlobal("fetch", fetch);
    await t.action(internal.actions.readwiseSync.sync, { userId });
    const state = await t.run((ctx) =>
      ctx.db.query("readwiseSyncState").first(),
    );
    expect(state).toMatchObject({
      highlights: 1,
      pageCursor: "next",
      phase: 3,
      pageProcessedIds: [],
      nextRunAt: Date.now() + 60_000,
    });
    expect(
      await t.run((ctx) => ctx.db.query("highlights").take(3)),
    ).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("limit")).toBe(
      "20",
    );
    expect(
      (await t.query(api.highlights.legacyDefaults, {})).highlighter,
    ).toBeNull();
  });
});
