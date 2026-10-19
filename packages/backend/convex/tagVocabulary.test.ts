/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { metadataTriggers } from "./lib/metadataTriggers";
import {
  migrateTagVocabulary,
  missingVocabularyEmbeddings,
  promptVocabulary,
  purgeTagVocabulary,
  TAG_KEY_BYTES,
  TAG_METADATA_BYTES,
  tagProjection,
} from "./lib/tagVocabulary";

const modules = import.meta.glob("./**/*.ts");
const userId = "default_user";
const tag = (key: string, count = 0, embedded = true) => ({
  userId,
  key,
  name: key,
  aliases: [`alias-${key}`],
  count,
  status: "active" as const,
  createdAt: 1,
  embedding: embedded ? Array.from({ length: 1536 }, () => 0.125) : undefined,
});

async function migrate(
  t: Awaited<ReturnType<typeof secondReaderTest>>["t"],
  library = userId,
) {
  for (let i = 0; i < 1000; i++) {
    const result = await t.mutation(internal.tags.migrateVocabulary, {
      userId: library,
    });
    if (result.done) return;
  }
  throw new Error("Fixture migration did not finish");
}

const legacy = (rows: Doc<"tags">[]) =>
  rows
    .filter((row) => row.status === "active")
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, 150)
    .map(({ name, key, aliases }) => ({ name, key, aliases }));

describe("bounded private tag metadata", () => {
  it("keeps the exact legacy top150 across Unicode/collation ties and large vectors; physically reads only bounded metadata", async () => {
    const f = await secondReaderTest(modules);
    const keys = [
      "z",
      "ä",
      "a",
      "A",
      "é",
      "e\u0301",
      "constructor",
      "__proto__",
      "日本語",
      ...Array.from({ length: 512 }, (_, i) => `topic${511 - i}`),
    ];
    await f.t.run(async (ctx) => {
      for (const key of keys) await ctx.db.insert("tags", tag(key, 1));
      await ctx.db.insert("tags", tag("most-used", 99));
      await ctx.db.insert("tags", {
        ...tag("foreign", 999),
        userId: f.readerLibraryId,
      });
      await ctx.db.insert("tags", {
        ...tag("hidden", 999),
        status: "candidate",
      });
    });
    await expect(
      f.t.query(internal.tags.vocabulary, { userId }),
    ).rejects.toThrow("migration required");
    const first = await f.t.mutation(internal.tags.migrateVocabulary, {
      userId,
    });
    expect(first).toEqual({ done: false, migrated: 1 });
    await expect(
      f.t.query(internal.tags.vocabulary, { userId }),
    ).rejects.toThrow("migration required");
    await migrate(f.t);
    const rows = await f.t.run((ctx) =>
      ctx.db
        .query("tags")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", userId).eq("status", "active"),
        )
        .collect(),
    );
    expect(await f.t.query(internal.tags.vocabulary, { userId })).toEqual(
      legacy(rows),
    );
    const physical = await f.t.run(async (ctx) => {
      const metadata = await ctx.db.query("tagVocabulary").collect();
      const payloads = await ctx.db.query("tagVocabularyPayloads").collect();
      const allowed = metadata.map((row) => row._id);
      const allowedPayloads = payloads.map((row) => row._id);
      let nodeReads = 0;
      let payloadReads = 0;
      let bytes = 0;
      const db = new Proxy(ctx.db, {
        get(target, property, receiver) {
          if (property === "get")
            return async (...args: Parameters<typeof ctx.db.get>) => {
              const row = await target.get(...args);
              if (!row) throw new Error("Non-metadata hydration");
              if (allowed.some((id) => id === row._id)) nodeReads++;
              else if (allowedPayloads.some((id) => id === row._id))
                payloadReads++;
              else throw new Error("Non-metadata hydration");
              bytes += new TextEncoder().encode(JSON.stringify(row)).byteLength;
              return row;
            };
          return Reflect.get(target, property, receiver);
        },
      });
      const result = await promptVocabulary({ db }, userId);
      return {
        nodeReads,
        payloadReads,
        bytes,
        count: result.length,
        maxNodeBytes: Math.max(
          ...metadata.map(
            (row) => new TextEncoder().encode(JSON.stringify(row)).byteLength,
          ),
        ),
        maxPayloadBytes: Math.max(
          ...payloads.map(
            (row) => new TextEncoder().encode(JSON.stringify(row)).byteLength,
          ),
        ),
      };
    });
    expect(physical.count).toBe(150);
    expect(physical.nodeReads).toBeLessThanOrEqual(214);
    expect(physical.payloadReads).toBe(150);
    expect(physical.bytes).toBeLessThan(
      214 * (TAG_KEY_BYTES + 1024) +
        150 * (TAG_METADATA_BYTES + TAG_KEY_BYTES + 1024),
    );
    expect(physical.maxNodeBytes).toBeLessThan(TAG_KEY_BYTES + 1024);
    expect(physical.maxPayloadBytes).toBeLessThan(
      TAG_METADATA_BYTES + TAG_KEY_BYTES + 1024,
    );
    console.log("B12 physical prompt fixture", JSON.stringify(physical));
  });

  it("maintains AVL ordering/balance after generic replacements, count changes, deletions, ownership transfers and migration retries", async () => {
    const f = await secondReaderTest(modules);
    await migrate(f.t);
    const ids = await f.t.run(async (raw) => {
      const ctx = { ...raw, ...metadataTriggers.wrapDB(raw) };
      const ids = [];
      for (let i = 0; i < 180; i++)
        ids.push(await ctx.db.insert("tags", tag(`tag-${i}`, i % 7)));
      return ids;
    });
    await f.t.run(async (raw) => {
      const { db } = metadataTriggers.wrapDB(raw);
      for (const [i, id] of ids.entries()) {
        if (i % 3 === 0) await db.delete(id);
        else if (i % 5 === 0)
          await db.replace(id, {
            ...tag(`renamed-${i}`, 100 - i),
            userId: i % 10 === 0 ? f.readerLibraryId : userId,
          });
        else
          await db.patch(id, {
            count: 180 - i,
            aliases: ["constructor", "__proto__"],
          });
      }
    });
    await migrate(f.t);
    const rows = await f.t.run((ctx) =>
      ctx.db
        .query("tags")
        .withIndex("by_user_key", (q) => q.eq("userId", userId))
        .collect(),
    );
    expect(await f.t.query(internal.tags.vocabulary, { userId })).toEqual(
      legacy(rows),
    );
    const nodes = await f.t.run((ctx) =>
      ctx.db
        .query("tagVocabulary")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect(),
    );
    const byId = new Map(nodes.map((node) => [node._id, node]));
    for (const node of nodes) {
      const left = node.left ? (byId.get(node.left)?.height ?? 0) : 0;
      const right = node.right ? (byId.get(node.right)?.height ?? 0) : 0;
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
      expect(node.height).toBe(1 + Math.max(left, right));
    }
    expect(new Set(nodes.map((node) => node.tagId)).size).toBe(rows.length);
  });

  it.each([
    0, 50, 51,
  ])("selects %i pending tags before hydration and preserves binary key batch order", async (count) => {
    const f = await secondReaderTest(modules);
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 70; i++)
        await ctx.db.insert("tags", tag(`embedded-${i}`, 0));
      for (let i = count - 1; i >= 0; i--)
        await ctx.db.insert(
          "tags",
          tag(`pending-${String(i).padStart(3, "0")}`, 0, false),
        );
      await ctx.db.insert("tags", {
        ...tag("foreign", 0, false),
        userId: f.readerLibraryId,
      });
    });
    await migrate(f.t);
    const batch = await f.t.query(internal.tags.missingEmbeddings, { userId });
    expect(batch.map((row) => row.text)).toEqual(
      Array.from(
        { length: Math.min(count, 50) },
        (_, i) => `pending-${String(i).padStart(3, "0")}`,
      ),
    );
    await f.t.run(async (ctx) => {
      const db = new Proxy(ctx.db, {
        get(target, property, receiver) {
          if (property === "get")
            return () => {
              throw new Error("Missing batch must not hydrate tags");
            };
          if (property === "query")
            return (...args: Parameters<typeof ctx.db.query>) => {
              if (args[0] === "tags")
                throw new Error(
                  "Missing batch must select metadata before vectors",
                );
              return target.query(...args);
            };
          return Reflect.get(target, property, receiver);
        },
      });
      expect(await missingVocabularyEmbeddings({ db }, userId)).toEqual(batch);
    });
  });

  it("does not lose inserts/renames behind a migration cursor or duplicate retried rows", async () => {
    const f = await secondReaderTest(modules);
    const ids = await f.t.run(async (ctx) => {
      const ids = [];
      for (let i = 0; i < 15; i++)
        ids.push(await ctx.db.insert("tags", tag(`legacy-${i}`)));
      return ids;
    });
    await f.t.mutation(internal.tags.migrateVocabulary, { userId });
    await f.t.run(async (raw) => {
      const { db } = metadataTriggers.wrapDB(raw);
      await db.insert("tags", tag("000-before-cursor", 12));
      await db.patch(ids[14], {
        key: "001-renamed-behind-cursor",
        name: "renamed",
      });
      await db.delete(ids[13]);
    });
    await migrate(f.t);
    await migrate(f.t);
    const canonical = await f.t.run((ctx) => ctx.db.query("tags").collect());
    expect(await f.t.query(internal.tags.vocabulary, { userId })).toEqual(
      legacy(canonical),
    );
    const projected = await f.t.run((ctx) =>
      ctx.db.query("tagVocabulary").collect(),
    );
    expect(projected).toHaveLength(canonical.length);
    expect(new Set(projected.map((row) => row.tagId)).size).toBe(
      canonical.length,
    );
  });

  it("rejects stale/foreign/deleted embedding publication, keeps disabled libraries, and fences purge/late writes", async () => {
    const f = await secondReaderTest(modules);
    await migrate(f.t, f.readerLibraryId);
    const ids = await f.t.run(async (raw) => {
      const { db } = metadataTriggers.wrapDB(raw);
      return [
        await db.insert("tags", {
          ...tag("one", 0, false),
          userId: f.readerLibraryId,
        }),
        await db.insert("tags", {
          ...tag("two", 0, false),
          userId: f.readerLibraryId,
        }),
        await db.insert("tags", tag("foreign", 0, false)),
      ];
    });
    await f.t.run(async (raw) => {
      const { db } = metadataTriggers.wrapDB(raw);
      await db.patch(ids[0], { description: "changed" });
      await db.delete(ids[1]);
      const reader = await db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.readerLibraryId))
        .unique();
      if (!reader) throw new Error("Missing fixture reader");
      await db.patch(reader._id, { status: "disabled" });
    });
    expect(
      await f.t.query(internal.tags.vocabulary, { userId: f.readerLibraryId }),
    ).toHaveLength(1);
    await f.t.mutation(internal.tags.setEmbeddings, {
      userId: f.readerLibraryId,
      items: ids.map((id, i) => ({
        id,
        text: ["one", "two", "foreign"][i],
        embedding: [1, 0],
      })),
    });
    expect(
      (await f.t.run((ctx) => ctx.db.get(ids[0])))?.embedding,
    ).toBeUndefined();
    expect(
      (await f.t.run((ctx) => ctx.db.get(ids[2])))?.embedding,
    ).toBeUndefined();
    await f.t.run(async (raw) => {
      const reader = await raw.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.readerLibraryId))
        .unique();
      if (!reader) throw new Error("Missing fixture reader");
      await raw.db.patch(reader._id, { deletingAt: 1 });
      await purgeTagVocabulary(raw, f.readerLibraryId);
      const { db } = metadataTriggers.wrapDB(raw);
      await db.patch(ids[0], { name: "late" });
      expect(await migrateTagVocabulary(raw, f.readerLibraryId)).toEqual({
        done: true,
        migrated: 0,
      });
      await purgeTagVocabulary(raw, f.readerLibraryId);
    });
    expect(
      await f.t.query(internal.tags.vocabulary, { userId: f.readerLibraryId }),
    ).toEqual([]);
    expect(
      await f.t.run((ctx) =>
        ctx.db
          .query("tagVocabulary")
          .withIndex("by_userId", (q) => q.eq("userId", f.readerLibraryId))
          .collect(),
      ),
    ).toEqual([]);
  });

  it("uses UTF8 budgets without truncating long Unicode identities; overflow is explicit and repairable without touching vectors", async () => {
    const f = await secondReaderTest(modules);
    await migrate(f.t);
    const id = await f.t.run((raw) =>
      metadataTriggers.wrapDB(raw).db.insert("tags", tag("界".repeat(1400))),
    );
    const original = await f.t.run((ctx) => ctx.db.get(id));
    if (!original) throw new Error("Missing tag");
    expect(tagProjection(original)).toMatchObject({
      overflow: true,
      key: "",
      name: "",
    });
    expect(original.key.length).toBe(1400);
    expect(
      tagProjection({
        ...original,
        key: `${"界".repeat(1365)}a`,
        name: "short",
        aliases: [],
      }).overflow,
    ).toBe(false);
    expect(
      tagProjection({
        ...original,
        key: `${"界".repeat(1365)}ab`,
        name: "short",
        aliases: [],
      }).overflow,
    ).toBe(true);
    expect(
      tagProjection({
        ...original,
        key: "short",
        name: "short",
        aliases: ["a".repeat(16_384)],
      }).overflow,
    ).toBe(true);
    await expect(
      f.t.query(internal.tags.vocabulary, { userId }),
    ).rejects.toThrow("byte budget");
    await f.t.run((raw) =>
      metadataTriggers.wrapDB(raw).db.patch(id, {
        key: "界".repeat(1000),
        name: "界".repeat(1000),
        aliases: [],
      }),
    );
    expect((await f.t.query(internal.tags.vocabulary, { userId }))[0].key).toBe(
      "界".repeat(1000),
    );
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.embedding).toEqual(
      original.embedding,
    );
  });
});
