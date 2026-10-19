/// <reference types="vite/client" />

import { getConvexSize } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { metadataTriggers } from "./lib/metadataTriggers";
import {
  migrateTagAliases,
  verifyAndActivateTagAliases,
} from "./lib/tagAliases";
import { boundedAssignmentView } from "./lib/tagAssignment";
import { matchTagEmbedding } from "./lib/tagMatching";
import {
  migrateTagVectors,
  purgeTagVectors,
  syncTagVectors,
  vectorState,
  verifyAndActivateTagVectors,
} from "./lib/tagVectors";
import { migrateTagVocabulary } from "./lib/tagVocabulary";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const userId = "default_user";
type Proposal = { name: string; embedding?: number[]; description?: string };

async function fixture(tags: Partial<Doc<"tags">>[] = []) {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId,
      guid: "vector-assign",
      url: "https://example.com/vector-assign",
      title: "Fixture",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 0,
    }),
  );
  const ids = await t.run(async (ctx) => {
    const ids: Id<"tags">[] = [];
    for (const [i, tag] of tags.entries())
      ids.push(
        await ctx.db.insert("tags", {
          userId,
          key: `topic${i}`,
          name: `topic${i}`,
          aliases: [],
          count: 0,
          status: "active",
          createdAt: i,
          ...tag,
        }),
      );
    return ids;
  });
  for (let i = 0; i <= tags.length; i++) {
    await t.run((ctx) => migrateTagVocabulary(ctx, userId));
    await t.run((ctx) => migrateTagAliases(ctx, userId));
    await t.run((ctx) => migrateTagVectors(ctx, userId));
  }
  await t.run(async (ctx) => {
    expect(await verifyAndActivateTagAliases(ctx, userId)).toBe(true);
  });
  await t.run(async (ctx) => {
    expect(await verifyAndActivateTagVectors(ctx, userId)).toBe(true);
  });
  return { t, articleId, ids };
}

/** Both executions start from the SAME canonical IDs/rows in one transaction.
 * Reset through generic writers, not a second library with different tie IDs. */
async function equivalent(tags: Partial<Doc<"tags">>[], proposals: Proposal[]) {
  const f = await fixture(tags);
  return f.t.run(async (ctx) => {
    const initial = await ctx.db.query("tags").collect();
    const oldIds = new Set(initial.map((tag) => tag._id));
    const args = { userId, articleId: f.articleId, proposals };
    expect(await boundedAssignmentView(ctx, userId, proposals)).not.toBeNull();
    const optimizedLinks = await ctx.runMutation(internal.tags.assign, args);
    const optimized = await ctx.db.query("tags").collect();
    const summarize = (rows: Doc<"tags">[], links: Id<"tags">[]) => {
      const identity = (id?: Id<"tags">) =>
        id && (oldIds.has(id) ? id : rows.find((t) => t._id === id)?.key);
      return {
        links: links.map(identity),
        rows: rows
          .map((tag) => ({
            id: identity(tag._id),
            key: tag.key,
            name: tag.name,
            description: tag.description,
            count: tag.count,
            status: tag.status,
            aliases: tag.aliases,
            embedding: tag.embedding,
            nearest: identity(tag.nearestTagId),
          }))
          .sort((a, b) => String(a.id).localeCompare(String(b.id))),
      };
    };
    const expected = summarize(optimized, optimizedLinks);
    const db = metadataTriggers.wrapDB(ctx).db;
    for (const edge of await ctx.db.query("articleTags").collect())
      await ctx.db.delete(edge._id);
    for (const tag of optimized)
      if (!oldIds.has(tag._id)) await db.delete(tag._id);
    for (const tag of initial) {
      const { _id, _creationTime: _, ...fields } = tag;
      await db.replace(_id, fields);
    }
    const state = await vectorState(ctx, userId);
    if (!state) throw new Error("Missing state");
    await ctx.db.patch(state._id, { ready: false });
    const vocabulary = await ctx.db
      .query("tagVocabularyState")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!vocabulary) throw new Error("Missing vocabulary state");
    await ctx.db.patch(vocabulary._id, { ready: false });
    const legacyLinks = await ctx.runMutation(internal.tags.assign, args);
    expect(
      summarize(await ctx.db.query("tags").collect(), legacyLinks),
    ).toEqual(expected);
    return expected;
  });
}

describe("bounded exact sequential assignment", () => {
  it("preserves candidate duplicate links, nearest linking and promotion", async () => {
    const f = await fixture([{ key: "visible", embedding: [1, 0] }]);
    const candidate = await f.t.run((ctx) =>
      metadataTriggers.wrapDB(ctx).db.insert("tags", {
        userId,
        key: "waiting",
        name: "waiting",
        status: "candidate",
        count: 1,
        nearestTagId: f.ids[0],
        aliases: [],
        embedding: [0.85, Math.sqrt(1 - 0.85 ** 2)],
        createdAt: 0,
      }),
    );
    const links = await f.t.mutation(internal.tags.assign, {
      userId,
      articleId: f.articleId,
      proposals: [{ name: "waiting" }, { name: "waiting" }],
    });
    expect(links).toEqual([candidate, f.ids[0]]);
    expect(await f.t.run((ctx) => ctx.db.get(candidate))).toMatchObject({
      count: 2,
      status: "candidate",
    });
    expect(
      await f.t.mutation(internal.tags.assign, {
        userId,
        articleId: f.articleId,
        proposals: [{ name: "waiting" }],
      }),
    ).toEqual(links); // Unlink before count reads: replacement is not recurrence.
    await equivalent(
      [{ key: "waiting", count: 2, status: "candidate", embedding: [1, 0] }],
      [{ name: "waiting" }],
    );
  });

  it("recomputes semantic matches after creation and alias edits, stops at three links, supports >3 proposals", async () => {
    const result = await equivalent(
      [{ key: "old", embedding: [1, 0] }],
      [
        { name: "fresh", embedding: [0, 1] },
        { name: "synonym", embedding: [0, 1] },
        { name: "synonym" },
        { name: "fresh" },
        { name: "other", embedding: [-1, 0] },
        { name: "never", embedding: [0, -1] },
        { name: "stopped", embedding: [0, -1] },
      ],
    );
    expect(result.rows.find((tag) => tag.key === "fresh")?.aliases).toEqual([
      "synonym",
    ]);
    expect(result.rows.some((tag) => tag.key === "stopped")).toBe(false);
  });

  it("preserves raw alias/direct collisions and duplicate canonical precedence", async () => {
    await equivalent(
      [
        {
          key: "aaa",
          aliases: ["collision", "raw_alias", "shared"],
          embedding: [1, 0],
        },
        { key: "collision", status: "candidate", embedding: [0, 1] },
        { key: "collision", count: 2, status: "candidate", embedding: [0, 1] },
        { key: "zzz", aliases: ["shared"], embedding: [-1, 0] },
      ],
      [
        { name: "collision" },
        { name: "shared" },
        { name: "raw_alias" },
        { name: "missing" },
      ],
    );
  });

  it.each([
    0.9, 0.8, 0.799, 0.899,
  ])("preserves exact threshold %s and near-miss linking", async (score) => {
    const result = await equivalent(
      [{ key: "visible", embedding: [1, 0] }],
      [
        { name: "new", embedding: [score, Math.sqrt(1 - score ** 2)] },
        { name: "new" },
      ],
    );
    expect(result.links).toHaveLength(score >= 0.8 && score < 0.9 ? 2 : 1);
    expect(result.rows).toHaveLength(score >= 0.9 ? 1 : 2);
  });

  it("shares exact cosine ties, ragged/zero/missing and first NaN behavior", async () => {
    await equivalent(
      [
        { key: "aaa", embedding: [NaN, 0] },
        { key: "bbb", embedding: [1, 0] },
        { key: "ccc", embedding: [1] },
        { key: "ddd", embedding: [0, 0] },
        { key: "eee" },
      ],
      [{ name: "novel", embedding: [1, 0] }],
    );
    await equivalent(
      [
        { key: "aaa", embedding: [1, 0] },
        { key: "bbb", embedding: [1, 0] },
      ],
      [{ name: "tied", embedding: [1, 0] }],
    );
    expect(
      matchTagEmbedding({ key: "q", embedding: [1, 0] }, [
        { id: "z", embedding: [1, 0] },
        { id: "a", embedding: [1, 0] },
      ]),
    ).toEqual({ kind: "existing", tagId: "a", alias: "q" });
  });

  it("relinks a missing nearest through its moved alias or exact semantic rank", async () => {
    const f = await fixture([{ key: "old", embedding: [1, 0] }]);
    const missing = f.ids[0];
    await f.t.run((ctx) => metadataTriggers.wrapDB(ctx).db.delete(missing));
    await equivalent(
      [
        {
          key: "candidate",
          status: "candidate",
          embedding: [1, 0],
          nearestTagId: missing,
        },
        { key: "kept", aliases: ["candidate"], embedding: [1, 0] },
      ],
      [{ name: "candidate" }, { name: "candidate" }],
    );
    await equivalent(
      [
        {
          key: "candidate",
          status: "candidate",
          embedding: [1, 0],
          nearestTagId: missing,
        },
        { key: "kept", embedding: [1, 0] },
      ],
      [{ name: "candidate" }, { name: "candidate" }],
    );
  });

  it("rejects unsupported/unready/overflow before canonical or vector reads", async () => {
    const f = await fixture([{ embedding: [1, 0] }]);
    await f.t.run(async (ctx) => {
      const db = new Proxy(ctx.db, {
        get(target, prop) {
          if (prop === "get")
            return () => {
              throw new Error("Speculative canonical read");
            };
          if (prop === "query")
            return (table: Parameters<typeof target.query>[0]) => {
              if (table === "tagVectors" || table === "tags")
                throw new Error("Speculative vector read");
              return target.query(table);
            };
          throw new Error(`Unexpected DB access: ${String(prop)}`);
        },
      });
      for (const proposals of [
        Array.from({ length: 9 }, () => ({ name: "new" })),
        [{ name: "x".repeat(65) }],
      ])
        expect(
          await boundedAssignmentView({ db }, userId, proposals),
        ).toBeNull();
      const state = await vectorState(ctx, userId);
      if (!state) throw new Error("Missing state");
      for (const patch of [
        { ready: false },
        { ready: true, overflow: 1 },
        { overflow: 0, vectorBytes: 8_000_001 },
        { vectorBytes: 0, count: 769 },
      ]) {
        await ctx.db.patch(state._id, patch);
        expect(
          await boundedAssignmentView({ db }, userId, [{ name: "new" }]),
        ).toBeNull();
      }
    });
  });

  it("backfill is idempotent and activation rejects an omitted/corrupt vector", async () => {
    const f = await fixture([{ embedding: [1, 0] }]);
    await f.t.run(async (ctx) => {
      const before = await vectorState(ctx, userId);
      expect(await migrateTagVectors(ctx, userId)).toEqual({
        done: true,
        migrated: 0,
      });
      expect(await vectorState(ctx, userId)).toEqual(before);
      const row = await ctx.db.query("tagVectors").first();
      if (!row) throw new Error("Missing vector");
      await ctx.db.patch(row._id, { embedding: [0, 1] });
      await expect(verifyAndActivateTagVectors(ctx, userId)).rejects.toThrow(
        "equality",
      );
    });
  });

  it("generic count/status/nearest writes do zero vector/source/state IO", async () => {
    const f = await fixture([{ embedding: [1, 0] }]);
    await f.t.run(async (ctx) => {
      const before = await ctx.db.get(f.ids[0]);
      if (!before) throw new Error("Missing tag");
      const db = new Proxy(ctx.db, {
        get() {
          throw new Error("Unexpected projection IO");
        },
      });
      await syncTagVectors({ ...ctx, db }, before, {
        ...before,
        count: 7,
        status: "candidate",
        nearestTagId: f.ids[0],
      });
    });
  });

  it("generic replace/rename/vector edits/ownership/delete publish atomically without alias readiness churn", async () => {
    const f = await fixture([{ key: "old", embedding: [1, 0] }]);
    await f.t.run(async (ctx) => {
      const db = metadataTriggers.wrapDB(ctx).db;
      await db.patch(f.ids[0], { embedding: [0, 1] });
      expect((await ctx.db.query("tagAliasState").first())?.ready).toBe(true);
      expect((await ctx.db.query("tagVectors").first())?.embedding).toEqual([
        0, 1,
      ]);
      const tag = await ctx.db.get(f.ids[0]);
      if (!tag) throw new Error("Missing tag");
      const { _id, _creationTime: _, ...fields } = tag;
      await db.replace(_id, { ...fields, key: "renamed", aliases: ["old"] });
      expect((await ctx.db.query("tagVectors").first())?.key).toBe("renamed");
      await db.patch(_id, { userId: "absent-library" });
      expect(await ctx.db.query("tagVectors").collect()).toEqual([]);
      expect(await ctx.db.query("tagVectorSources").collect()).toEqual([]);
      expect((await vectorState(ctx, userId))?.count).toBe(0);
      expect(await vectorState(ctx, "absent-library")).toBeNull();
      await db.delete(_id);
    });
  });

  it("never creates metadata for absent/deleting libraries and retains disabled metadata", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      await ctx.db.insert("readers", {
        authId: "disabled",
        libraryId: "disabled",
        status: "disabled",
        createdAt: 0,
      });
      await ctx.db.insert("readers", {
        authId: "deleting",
        libraryId: "deleting",
        status: "disabled",
        deletingAt: 1,
        createdAt: 0,
      });
      const db = metadataTriggers.wrapDB(ctx).db;
      for (const owner of ["disabled", "deleting", "absent"]) {
        await db.insert("tags", {
          userId: owner,
          key: "test",
          name: "test",
          aliases: [],
          count: 0,
          status: "active",
          embedding: [1, 0],
          createdAt: 0,
        });
        expect(!!(await vectorState(ctx, owner))).toBe(owner === "disabled");
      }
      expect(await purgeTagVectors(ctx, "deleting")).toBe(0);
      await expect(purgeTagVectors(ctx, "disabled")).rejects.toThrow(
        "retained",
      );
    });
  });

  it("overlapping assignments do not duplicate candidates and a third distinct article promotes", async () => {
    const f = await fixture();
    const articles = [f.articleId];
    for (let i = 0; i < 2; i++)
      articles.push(
        await f.t.run((ctx) =>
          ctx.db.insert("articles", {
            userId,
            guid: `overlap-${i}`,
            url: `https://example.com/overlap-${i}`,
            title: "Fixture",
            extractionStatus: "extracted",
            annotationStatus: "annotated",
            createdAt: 0,
          }),
        ),
      );
    const proposals = [{ name: "fresh", embedding: [1, 0] }];
    const result = await Promise.all(
      articles
        .slice(0, 2)
        .map((articleId) =>
          f.t.mutation(internal.tags.assign, { userId, articleId, proposals }),
        ),
    );
    expect(result[0]).toEqual(result[1]);
    expect(
      await f.t.run((ctx) => ctx.db.query("tags").collect()),
    ).toMatchObject([{ key: "fresh", count: 2, status: "candidate" }]);
    expect(
      await f.t.mutation(internal.tags.assign, {
        userId,
        articleId: articles[2],
        proposals,
      }),
    ).toEqual(result[0]);
    expect(
      await f.t.run((ctx) => ctx.db.query("tags").collect()),
    ).toMatchObject([{ key: "fresh", count: 3, status: "active" }]);
  });

  it("keeps a 1MiB canonical tag exactly the same size; projection size assertions are test-only cap guards", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const id = await ctx.db.insert("tags", {
        userId,
        key: "large",
        name: "large",
        aliases: [""],
        status: "candidate",
        count: 0,
        embedding: [1, 0],
        createdAt: 0,
      });
      const empty = await ctx.db.get(id);
      if (!empty) throw new Error("Missing tag");
      await ctx.db.patch(id, {
        aliases: ["x".repeat(1_048_576 - getConvexSize(empty))],
      });
      const before = await ctx.db.get(id);
      if (!before) throw new Error("Missing tag");
      expect(getConvexSize(before)).toBe(1_048_576);
      await syncTagVectors(ctx, null, before);
      await metadataTriggers.wrapDB(ctx).db.patch(id, { count: 1 });
      const after = await ctx.db.get(id);
      if (!after) throw new Error("Missing tag");
      expect(getConvexSize(after)).toBe(1_048_576);
      expect((await vectorState(ctx, userId))?.overflow).toBe(1);
      for (const table of [
        "tagVectors",
        "tagVectorSources",
        "tagVectorState",
      ] as const)
        for (const row of await ctx.db.query(table).collect())
          expect(getConvexSize(row)).toBeLessThan(65_536);
    });
  });
});
