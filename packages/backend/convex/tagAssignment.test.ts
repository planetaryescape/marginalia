/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { internal } from "./_generated/api";
import { metadataTriggers } from "./lib/metadataTriggers";
import { exactActiveAssignmentTags } from "./lib/tagAssignment";
import { matchTag, normaliseTag } from "./lib/tagMatching";

const modules = import.meta.glob("./**/*.ts");
const userId = "default_user";

async function fixture() {
  const f = await secondReaderTest(modules);
  await f.t.mutation(internal.tags.migrateVocabulary, { userId });
  const articleId = await f.t.run((ctx) =>
    ctx.db.insert("articles", {
      userId,
      guid: "exact-assignment",
      url: "https://example.com/exact-assignment",
      title: "Exact assignment",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );
  const add = (
    key: string,
    status: "active" | "candidate" = "active",
    aliases: string[] = [],
  ) =>
    f.t.run((raw) =>
      metadataTriggers.wrapDB(raw).db.insert("tags", {
        userId,
        key,
        name: key,
        aliases,
        status,
        count: 0,
        createdAt: 1,
        embedding: [1, 0],
      }),
    );
  return { ...f, articleId, add };
}

describe("exact active direct assignment preflight", () => {
  it("uses only small winner reads before canonical hydration; matches legacy Map for normalization and hostile names", async () => {
    const f = await fixture();
    await f.add("aaa", "active", ["constructor", "日本語", "story"]);
    const constructorTag = await f.add("constructor");
    const unicode = await f.add("日本語");
    const story = await f.add("story");
    await f.add("zzz", "active", ["constructor", "日本語", "story"]);
    await f.add("__proto__"); // raw malformed key is not the normalized proposal
    const proto = await f.add("proto");
    for (const proposals of [
      [{ name: "Constructor" }, { name: "日本語" }, { name: "Areas/Stories" }],
      [{ name: "__proto__" }, { name: "///###" }, { name: "__proto__" }],
      [],
    ]) {
      const result = await f.t.run(async (ctx) => {
        const canonical = await ctx.db
          .query("tags")
          .withIndex("by_user_key", (q) => q.eq("userId", userId))
          .collect();
        let gets = 0;
        const db = new Proxy(ctx.db, {
          get(target, property, receiver) {
            if (property === "query")
              return (table: Parameters<typeof target.query>[0]) => {
                if (table === "tags" || table === "tagVocabularyPayloads")
                  throw new Error("Unexpected whole vocabulary/payload read");
                return target.query(table);
              };
            if (property === "get")
              return async (...args: Parameters<typeof target.get>) => {
                gets++;
                return target.get(...args);
              };
            return Reflect.get(target, property, receiver);
          },
        });
        const selected = await exactActiveAssignmentTags(
          { db },
          userId,
          proposals,
        );
        const expected = proposals.flatMap(({ name }) => {
          const key = normaliseTag(name);
          if (!key) return [];
          const match = matchTag(
            { key },
            canonical.map((tag) => ({
              id: tag._id,
              key: tag.key,
              aliases: tag.aliases,
            })),
          );
          return match.kind === "existing" ? [match.tagId] : [];
        });
        expect(selected?.map((tag) => tag._id)).toEqual([...new Set(expected)]);
        expect(gets).toBe(new Set(expected).size);
        return selected?.map((tag) => tag._id);
      });
      if (proposals.length === 3 && proposals[0].name === "Constructor")
        expect(result).toEqual([constructorTag, unicode, story]);
      if (proposals[0]?.name === "__proto__") expect(result).toEqual([proto]);
    }
  });

  it("chooses the last canonical duplicate, not the recreated node order or first active row", async () => {
    const f = await fixture();
    const first = await f.add("duplicate");
    const last = await f.add("duplicate");
    await f.t.run((raw) =>
      metadataTriggers.wrapDB(raw).db.patch(first, { count: 9 }),
    );
    expect(
      await f.t.mutation(internal.tags.assign, {
        userId,
        articleId: f.articleId,
        proposals: [{ name: "duplicate" }],
      }),
    ).toEqual([last]);
    await f.t.run((raw) =>
      metadataTriggers
        .wrapDB(raw)
        .db.patch(last, { status: "candidate", nearestTagId: first }),
    );
    expect(
      await f.t.run((ctx) =>
        exactActiveAssignmentTags(ctx, userId, [{ name: "duplicate" }]),
      ),
    ).toBeNull();
    expect(
      await f.t.mutation(internal.tags.assign, {
        userId,
        articleId: f.articleId,
        proposals: [{ name: "duplicate" }],
      }),
    ).toEqual([last, first]);
  });

  it.each([
    "alias",
    "missing",
    "candidate",
    "long",
    "overflow",
    "unready",
    "oversized",
  ])("falls back for %s without hydrating any canonical vectors", async (kind) => {
    const f = await fixture();
    await f.add("alpha", "active", ["alias"]);
    await f.add("candidate", "candidate");
    const proposals = [
      { name: "alpha" },
      { name: kind === "oversized" ? "x".repeat(4097) : kind },
    ];
    if (kind === "long") proposals.push({ name: "alpha" }, { name: "alpha" });
    await f.t.run(async (ctx) => {
      const state = await ctx.db
        .query("tagVocabularyState")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique();
      if (!state) throw new Error("Missing state");
      if (kind === "overflow") await ctx.db.patch(state._id, { overflow: 1 });
      if (kind === "unready") await ctx.db.patch(state._id, { ready: false });
      const db = new Proxy(ctx.db, {
        get(target, property, receiver) {
          if (property === "get")
            return () => {
              throw new Error("Speculative vector hydration");
            };
          return Reflect.get(target, property, receiver);
        },
      });
      expect(
        await exactActiveAssignmentTags({ db }, userId, proposals),
      ).toBeNull();
    });
  });

  it("has same-snapshot legacy outputs/counts for duplicates, MAX3 and alias fallback", async () => {
    const f = await fixture();
    await f.add("alpha", "active", ["alias"]);
    await f.add("beta");
    await f.add("gamma");
    for (const names of [
      ["alpha", "beta", "gamma"],
      ["alpha", "alpha", "beta"],
      ["alias", "beta"],
      ["alpha", "beta", "gamma", "missing"],
      ["###", "alpha"],
    ]) {
      await f.t.run(async (ctx) => {
        const state = await ctx.db
          .query("tagVocabularyState")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .unique();
        if (!state) throw new Error("Missing state");
        const args = {
          userId,
          articleId: f.articleId,
          proposals: names.map((name) => ({ name })),
        };
        await ctx.db.patch(state._id, { ready: false });
        const legacy = await ctx.runMutation(internal.tags.assign, args);
        const counts = await ctx.db.query("tags").collect();
        await ctx.db.patch(state._id, { ready: true });
        expect(await ctx.runMutation(internal.tags.assign, args)).toEqual(
          legacy,
        );
        expect(await ctx.db.query("tags").collect()).toEqual(counts);
      });
    }
  });

  it("tracks atomic rename, merge deletion and transfer; never matches a foreign direct key", async () => {
    const f = await fixture();
    const old = await f.add("old");
    const kept = await f.add("kept");
    await f.t.run(async (raw) => {
      const { db } = metadataTriggers.wrapDB(raw);
      await db.patch(old, { key: "renamed" });
      expect(
        await exactActiveAssignmentTags({ db }, userId, [{ name: "old" }]),
      ).toBeNull();
      expect(
        (
          await exactActiveAssignmentTags({ db }, userId, [{ name: "renamed" }])
        )?.[0]._id,
      ).toBe(old);
      await db.patch(kept, { aliases: ["renamed"] });
      await db.delete(old);
      expect(
        await exactActiveAssignmentTags({ db }, userId, [{ name: "renamed" }]),
      ).toBeNull();
      await db.patch(kept, { userId: f.readerLibraryId });
      expect(
        await exactActiveAssignmentTags({ db }, userId, [{ name: "kept" }]),
      ).toBeNull();
    });
  });

  it("serializes simultaneous assignments without lost counts and decrements the last link", async () => {
    const f = await fixture();
    const id = await f.add("alpha");
    await Promise.all(
      Array.from({ length: 3 }, () =>
        f.t.mutation(internal.tags.assign, {
          userId,
          articleId: f.articleId,
          proposals: [{ name: "alpha" }],
        }),
      ),
    );
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.count).toBe(1);
    await f.t.mutation(internal.tags.assign, {
      userId,
      articleId: f.articleId,
      proposals: [],
    });
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.count).toBe(0);
  });

  it("rejects stale manual publication before unlinking or touching ready metadata", async () => {
    const f = await fixture();
    const alpha = await f.add("alpha");
    await f.add("beta");
    await f.t.mutation(internal.tags.assign, {
      userId,
      articleId: f.articleId,
      proposals: [{ name: "alpha" }],
    });
    await f.t.run((ctx) =>
      ctx.db.insert("manualAnnotationState", {
        userId,
        articleId: f.articleId,
        run: 2,
        input: "not evaluated for stale run",
        status: "running",
        attempts: 1,
        leaseUntil: Date.now() + 60_000,
        published: false,
      }),
    );
    await f.t.run(async (ctx) => {
      const tags = await ctx.db.query("tags").collect();
      const metadata = await ctx.db.query("tagVocabulary").collect();
      const links = await ctx.db.query("articleTags").collect();
      expect(links.map((link) => link.tagId)).toEqual([alpha]);
      expect(
        await ctx.runMutation(internal.tags.assign, {
          userId,
          articleId: f.articleId,
          generation: { run: 1 },
          proposals: [{ name: "beta" }],
        }),
      ).toEqual([]);
      expect(await ctx.db.query("tags").collect()).toEqual(tags);
      expect(await ctx.db.query("tagVocabulary").collect()).toEqual(metadata);
      expect(await ctx.db.query("articleTags").collect()).toEqual(links);
    });
  });

  it("fails closed on foreign canonical hydration instead of linking or scanning after vectors", async () => {
    const f = await fixture();
    const id = await f.add("alpha");
    await f.t.run((ctx) => ctx.db.patch(id, { userId: f.readerLibraryId }));
    await expect(
      f.t.mutation(internal.tags.assign, {
        userId,
        articleId: f.articleId,
        proposals: [{ name: "alpha" }],
      }),
    ).rejects.toThrow("metadata is inconsistent");
    expect(
      await f.t.run((ctx) => ctx.db.query("articleTags").collect()),
    ).toEqual([]);
  });
});
