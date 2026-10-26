/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { internal } from "./_generated/api";
import { metadataTriggers } from "./lib/metadataTriggers";
import {
  aliasProjection,
  aliasState,
  migrateTagAliases,
  purgeTagAliases,
  verifyAndActivateTagAliases,
} from "./lib/tagAliases";
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
      guid: "alias-assignment",
      url: "https://example.com/alias-assignment",
      title: "Alias",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );
  const add = (
    key: string,
    aliases: string[] = [],
    status: "active" | "candidate" = "active",
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
  const ready = async () => {
    for (let i = 0; i < 100; i++) {
      if ((await f.t.run((ctx) => migrateTagAliases(ctx, userId))).done) break;
    }
    expect(
      await f.t.run((ctx) => verifyAndActivateTagAliases(ctx, userId)),
    ).toBe(true);
  };
  return { ...f, articleId, add, ready };
}

describe("bounded exact aliases", () => {
  it("exposes separate bounded migration and equality activation through the installed internal contracts", async () => {
    const f = await fixture();
    const id = await f.add("alpha", ["alias"]);
    expect(
      await f.t.mutation(internal.tags.verifyAndActivateAliases, { userId }),
    ).toBe(false);
    let complete = false;
    for (let page = 0; page < 10 && !complete; page++)
      complete = (await f.t.mutation(internal.tags.migrateAliases, { userId }))
        .done;
    expect(complete).toBe(true);
    expect(await f.t.run((ctx) => aliasState(ctx, userId))).toMatchObject({
      ready: false,
      backfilled: true,
    });
    expect(
      await f.t.mutation(internal.tags.verifyAndActivateAliases, { userId }),
    ).toBe(true);
    expect(
      await f.t.mutation(internal.tags.assign, {
        userId,
        articleId: f.articleId,
        proposals: [{ name: "alias" }],
      }),
    ).toEqual([id]);
  });
  it("serializes concurrent alias assignments and does not lose or double their counts", async () => {
    const f = await fixture();
    const id = await f.add("alpha", ["alias"]);
    await f.ready();
    await Promise.all(
      Array.from({ length: 3 }, () =>
        f.t.mutation(internal.tags.assign, {
          userId,
          articleId: f.articleId,
          proposals: [{ name: "alias" }],
        }),
      ),
    );
    expect(await f.t.run((ctx) => ctx.db.get(id))).toMatchObject({ count: 1 });
    expect(
      (await f.t.run((ctx) => ctx.db.query("articleTags").collect())).map(
        (link) => link.tagId,
      ),
    ).toEqual([id]);
    await f.t.mutation(internal.tags.assign, {
      userId,
      articleId: f.articleId,
      proposals: [],
    });
    expect(await f.t.run((ctx) => ctx.db.get(id))).toMatchObject({ count: 0 });
  });

  it("validates the canonical exact stored alias before use and fails closed without a post-hydration scan", async () => {
    const f = await fixture();
    const id = await f.add("alpha", ["alias"]);
    await f.ready();
    // Deliberately bypass the generic writer to simulate corrupt/stale sidecars.
    await f.t.run((ctx) => ctx.db.patch(id, { aliases: ["unrelated"] }));
    await expect(
      f.t.mutation(internal.tags.assign, {
        userId,
        articleId: f.articleId,
        proposals: [{ name: "alias" }],
      }),
    ).rejects.toThrow("metadata is inconsistent");
    expect(
      await f.t.run((ctx) => ctx.db.query("articleTags").collect()),
    ).toEqual([]);
  });
  it("rejects stale annotation publication before unlink/count/alias projection changes", async () => {
    const f = await fixture();
    const id = await f.add("alpha", ["alias"]);
    await f.ready();
    await f.t.mutation(internal.tags.assign, {
      userId,
      articleId: f.articleId,
      proposals: [{ name: "alias" }],
    });
    await f.t.run(async (ctx) => {
      await ctx.db.insert("manualAnnotationState", {
        userId,
        articleId: f.articleId,
        run: 2,
        input: "stale proof",
        status: "running",
        attempts: 1,
        leaseUntil: Date.now() + 60_000,
        published: false,
      });
      const tag = await ctx.db.get(id);
      const aliases = await ctx.db.query("tagAliases").collect();
      const state = await aliasState(ctx, userId);
      const links = await ctx.db.query("articleTags").collect();
      expect(
        await ctx.runMutation(internal.tags.assign, {
          userId,
          articleId: f.articleId,
          generation: { run: 1 },
          proposals: [{ name: "alias" }],
        }),
      ).toEqual([]);
      expect(await ctx.db.get(id)).toEqual(tag);
      expect(await ctx.db.query("tagAliases").collect()).toEqual(aliases);
      expect(await aliasState(ctx, userId)).toEqual(state);
      expect(await ctx.db.query("articleTags").collect()).toEqual(links);
    });
  });
  it("preserves candidate winners, nearest relinks, promotion and semantic alias publication through forced legacy", async () => {
    const f = await fixture();
    const active = await f.add("visible", ["overlap"]);
    const candidate = await f.add("aaa", ["waiting", "overlap"], "candidate");
    await f.t.run((raw) =>
      metadataTriggers
        .wrapDB(raw)
        .db.patch(candidate, { nearestTagId: active }),
    );
    await f.ready();
    for (const proposals of [
      [{ name: "waiting" }],
      [{ name: "overlap" }, { name: "visible" }],
      [{ name: "waiting" }, { name: "semantic", embedding: [1, 0] }],
      [
        { name: "waiting" },
        { name: "visible" },
        { name: "waiting" },
        { name: "ignored" },
      ],
    ])
      await f.t.run(async (ctx) => {
        const state = await ctx.db
          .query("tagVocabularyState")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .unique();
        if (!state) throw new Error("Missing vocabulary");
        await ctx.db.patch(state._id, { ready: false });
        const args = { userId, articleId: f.articleId, proposals };
        const expected = await ctx.runMutation(internal.tags.assign, args);
        const canonical = await ctx.db.query("tags").collect();
        await ctx.db.patch(state._id, { ready: true });
        expect(await ctx.runMutation(internal.tags.assign, args)).toEqual(
          expected,
        );
        expect(await ctx.db.query("tags").collect()).toEqual(canonical);
      });
    await f.t.run((raw) =>
      metadataTriggers.wrapDB(raw).db.patch(candidate, { count: 3 }),
    );
    expect(
      await f.t.mutation(internal.tags.assign, {
        userId,
        articleId: f.articleId,
        proposals: [{ name: "waiting" }],
      }),
    ).toEqual([candidate]);
    expect(await f.t.run((ctx) => ctx.db.get(candidate))).toMatchObject({
      status: "active",
      count: 3,
    });
  });

  it("sorts the chosen canonical subset using Convex value order even for raw non-BMP keys", async () => {
    const f = await fixture();
    await f.add("\uE000", ["shared", "privateuse"]);
    await f.add("😀", ["shared", "emoji"]);
    await f.ready();
    await f.t.run(async (ctx) => {
      const canonical = await ctx.db
        .query("tags")
        .withIndex("by_user_key", (q) => q.eq("userId", userId))
        .collect();
      for (const names of [
        ["emoji", "privateuse", "shared"],
        ["privateuse", "emoji", "shared"],
      ]) {
        const selected = await exactActiveAssignmentTags(
          ctx,
          userId,
          names.map((name) => ({ name })),
        );
        expect(selected?.map((tag) => tag._id)).toEqual(
          canonical.map((tag) => tag._id),
        );
      }
    });
  });
  it("proves first canonical alias / last direct, prototype and raw keys, independently of proposal order", async () => {
    const f = await fixture();
    const first = await f.add("aaa", [
      "shared",
      "constructor",
      "raw KEY",
      "rawkey",
      "日本語",
    ]);
    const last = await f.add("zzz", ["shared", "constructor", "own", "日本語"]);
    const direct1 = await f.add("direct", ["directlabel"]);
    const direct2 = await f.add("direct");
    await f.add("mmm", ["direct"]);
    await f.add("__proto__", ["proto"]);
    await f.t.run((raw) =>
      metadataTriggers.wrapDB(raw).db.patch(first, { count: 99 }),
    );
    await f.ready();
    for (const names of [
      ["own", "shared"],
      ["shared", "own"],
      ["direct", "directlabel"],
      ["constructor", "日本語", "shared"],
      ["__proto__", "shared", "shared"],
      ["raw-key", "direct", "shared"],
      ["###"],
      [],
    ])
      await f.t.run(async (ctx) => {
        const canonical = await ctx.db
          .query("tags")
          .withIndex("by_user_key", (q) => q.eq("userId", userId))
          .collect();
        const proposals = names.map((name) => ({ name }));
        const chosen = await exactActiveAssignmentTags(ctx, userId, proposals);
        expect(chosen, JSON.stringify(names)).not.toBeNull();
        for (const { name } of proposals) {
          const key = normaliseTag(name);
          if (!key) continue;
          const knownTags = (tags: typeof canonical) =>
            tags.map((t) => ({ id: t._id, key: t.key, aliases: t.aliases }));
          expect(matchTag({ key }, knownTags(chosen ?? []))).toEqual(
            matchTag({ key }, knownTags(canonical)),
          );
        }
        const state = await aliasState(ctx, userId);
        if (!state) throw new Error("Missing alias state");
        // Force the complete legacy matcher, not a second implementation oracle.
        const vocab = await ctx.db
          .query("tagVocabularyState")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .unique();
        if (!vocab) throw new Error("Missing vocabulary");
        await ctx.db.patch(vocab._id, { ready: false });
        const args = { userId, articleId: f.articleId, proposals };
        const legacy = await ctx.runMutation(internal.tags.assign, args);
        const counts = await ctx.db.query("tags").collect();
        const links = await ctx.db
          .query("articleTags")
          .withIndex("by_article", (q) => q.eq("articleId", f.articleId))
          .collect();
        await ctx.db.patch(vocab._id, { ready: true });
        expect(await ctx.runMutation(internal.tags.assign, args)).toEqual(
          legacy,
        );
        expect(await ctx.db.query("tags").collect()).toEqual(counts);
        expect(
          (
            await ctx.db
              .query("articleTags")
              .withIndex("by_article", (q) => q.eq("articleId", f.articleId))
              .collect()
          ).map((l) => l.tagId),
        ).toEqual(links.map((l) => l.tagId));
      });
    expect(first).not.toBe(last);
    expect(direct1).not.toBe(direct2);
  });

  it.each([
    "unready",
    "missing",
    "candidate",
    "overflow",
    "too-many",
    "raw-alias",
  ])("rejects %s before ANY canonical get", async (kind) => {
    const f = await fixture();
    await f.add("aaa", ["alias", "raw KEY"]);
    await f.add("candidate", ["waiting"], "candidate");
    if (kind !== "unready") await f.ready();
    await f.t.run(async (ctx) => {
      const state = await aliasState(ctx, userId);
      if (!state) throw new Error("Missing alias state");
      if (kind === "overflow") await ctx.db.patch(state._id, { overflow: 1 });
      const name =
        kind === "candidate"
          ? "waiting"
          : kind === "raw-alias"
            ? "raw KEY"
            : kind === "missing"
              ? "missing"
              : "alias";
      const proposals = [{ name: "aaa" }, { name }];
      if (kind === "too-many")
        proposals.push({ name: "alias" }, { name: "alias" });
      const db = new Proxy(ctx.db, {
        get(target, prop, receiver) {
          if (prop === "get")
            return () => {
              throw new Error("Speculative canonical/vector read");
            };
          return Reflect.get(target, prop, receiver);
        },
      });
      expect(
        await exactActiveAssignmentTags({ db }, userId, proposals),
      ).toBeNull();
    });
  });

  it("keeps generic replace/rename/merge/transfer atomic; count/status changes do not rewrite alias rows", async () => {
    const f = await fixture();
    const first = await f.add("aaa", ["shared"]);
    const kept = await f.add("zzz", ["shared"]);
    await f.ready();
    await f.t.run(async (raw) => {
      const { db } = metadataTriggers.wrapDB(raw);
      const rows = await db.query("tagAliases").collect();
      await db.patch(first, { count: 7, status: "candidate" });
      expect(await db.query("tagAliases").collect()).toEqual(rows);
      expect(
        await exactActiveAssignmentTags({ db }, userId, [{ name: "shared" }]),
      ).toBeNull();
      await db.patch(first, { status: "active", key: "zzzz" });
      expect(
        (
          await exactActiveAssignmentTags({ db }, userId, [{ name: "shared" }])
        )?.[0]._id,
      ).toBe(kept);
      const tag = await db.get(kept);
      if (!tag) throw new Error("Missing tag");
      const { _id, _creationTime, ...value } = tag;
      await db.replace(_id, { ...value, aliases: ["shared", "merged"] });
      await db.delete(first);
      expect(
        (
          await exactActiveAssignmentTags({ db }, userId, [{ name: "merged" }])
        )?.[0]._id,
      ).toBe(kept);
      await db.patch(kept, { userId: f.readerLibraryId });
      expect(
        await exactActiveAssignmentTags({ db }, userId, [{ name: "shared" }]),
      ).toBeNull();
      expect(
        await db
          .query("tagAliases")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .collect(),
      ).toEqual([]);
    });
  });

  it("bounds projection fanout and omits only provably unequal overlong raw aliases", async () => {
    const f = await fixture();
    const id = await f.add("alpha", [
      "a".repeat(4097),
      "é".repeat(2049),
      "short",
      "short",
    ]);
    const tag = await f.t.run((ctx) => ctx.db.get(id));
    if (!tag) throw new Error("Missing tag");
    expect(aliasProjection(tag)).toEqual({
      aliases: ["short"],
      overflow: false,
    });
    await f.ready();
    expect(
      (
        await f.t.run((ctx) =>
          exactActiveAssignmentTags(ctx, userId, [{ name: "short" }]),
        )
      )?.[0]._id,
    ).toBe(id);
    await f.t.run((raw) =>
      metadataTriggers.wrapDB(raw).db.patch(id, {
        aliases: Array.from({ length: 65 }, (_, n) => `alias${n}`),
      }),
    );
    expect(await f.t.run((ctx) => aliasState(ctx, userId))).toMatchObject({
      overflow: 1,
    });
    expect(
      await f.t.run((ctx) =>
        exactActiveAssignmentTags(ctx, userId, [{ name: "alias1" }]),
      ),
    ).toBeNull();
  });

  it("does not infer readiness from vocabulary.ready; migration is idempotent and activation checks actual winners", async () => {
    const f = await fixture();
    const id = await f.add("alpha", ["alias"]);
    expect(
      await f.t.run((ctx) =>
        exactActiveAssignmentTags(ctx, userId, [{ name: "alias" }]),
      ),
    ).toBeNull();
    await f.t.run((ctx) => migrateTagAliases(ctx, userId));
    expect(await f.t.run((ctx) => aliasState(ctx, userId))).toMatchObject({
      ready: false,
    });
    await f.ready();
    const rows = await f.t.run((ctx) => ctx.db.query("tagAliases").collect());
    await f.t.run((ctx) => migrateTagAliases(ctx, userId));
    expect(
      await f.t.run((ctx) => ctx.db.query("tagAliases").collect()),
    ).toEqual(rows);
    await f.t.run(async (ctx) => {
      const state = await aliasState(ctx, userId);
      if (!state) throw new Error("Missing state");
      await ctx.db.patch(state._id, { ready: false });
      await ctx.db.delete(rows[0]._id);
      await expect(verifyAndActivateTagAliases(ctx, userId)).rejects.toThrow(
        "verification failed",
      );
      expect((await aliasState(ctx, userId))?.ready).toBe(false);
    });
    expect(id).toBeDefined();
  });

  it("never resurrects absent/deleting libraries and purges in bounded batches", async () => {
    const f = await fixture();
    const id = await f.add("alpha", ["alias"]);
    await f.ready();
    await f.t.run(async (raw) => {
      const { db } = metadataTriggers.wrapDB(raw);
      const tag = await db.get(id);
      if (!tag) throw new Error("Missing tag");
      await db.patch(id, { userId: "nonexistent-library" });
      expect(await db.query("tagAliases").collect()).toEqual([]);
      expect(await db.query("tagAliasSources").collect()).toEqual([]);
      expect(await purgeTagAliases(raw, "nonexistent-library")).toBe(0);
    });
  });

  it("retains disabled metadata but never resurrects a deleting library after partial purge", async () => {
    const f = await fixture();
    await f.t.run(async (raw) => {
      const reader = await raw.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.readerLibraryId))
        .unique();
      if (!reader) throw new Error("Missing reader");
      await raw.db.patch(reader._id, { status: "disabled" });
      const { db } = metadataTriggers.wrapDB(raw);
      const id = await db.insert("tags", {
        userId: f.readerLibraryId,
        name: "retained",
        key: "retained",
        count: 0,
        createdAt: 1,
        status: "active",
        aliases: Array.from({ length: 64 }, (_, n) => `label${n}`),
      });
      expect(
        await db
          .query("tagAliases")
          .withIndex("by_tagId", (q) => q.eq("tagId", id))
          .collect(),
      ).toHaveLength(64);
      await raw.db.patch(reader._id, { deletingAt: 1 });
      expect(await purgeTagAliases(raw, f.readerLibraryId)).toBe(32);
      // An alias/key edit arrives while account cleanup has removed half of
      // this tag's projection. It must not use or recreate a partial baseline.
      await db.patch(id, { aliases: ["late"], key: "late" });
      expect(
        await db
          .query("tagAliases")
          .withIndex("by_userId", (q) => q.eq("userId", f.readerLibraryId))
          .collect(),
      ).toEqual([]);
      expect(await purgeTagAliases(raw, f.readerLibraryId)).toBe(1);
      expect(await purgeTagAliases(raw, f.readerLibraryId)).toBe(0);
    });
  });
});
