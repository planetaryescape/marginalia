/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { hashesResponse, purgeMetadata } from "./vaultFiles";

const modules = import.meta.glob("./**/*.ts");
const chunk = (filePath: string, fileHash = "old") => ({
  userId: "fixture",
  filePath,
  fileName: "Fixture",
  fileHash,
  chunkIndex: 0,
  content: "Fixture body",
  embedding: Array(1536).fill(0.1),
  indexedAt: 1,
});

describe("vault metadata migration and compatibility", () => {
  it("never advertises an empty complete manifest before legacy files are migrated", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    await t.run(async (ctx) => {
      await ctx.db.insert("noteChunks", chunk("A.md"));
      await ctx.db.insert("noteChunks", chunk("B.md"));
    });
    const first = await t.query(internal.vaultFiles.page, {
      userId: "fixture",
      cursor: null,
    });
    expect(first.files).toEqual([{ filePath: "A.md", fileHash: "old" }]);
    expect(first.cursor).not.toBeNull();
    expect(
      await t.mutation(internal.vaultFiles.backfill, { userId: "fixture" }),
    ).toEqual({ complete: false, afterPath: "A.md" });
    // Interrupted migration is resumable, not mistaken for completion.
    expect(
      (
        await t.query(internal.vaultFiles.page, {
          userId: "fixture",
          cursor: first.cursor,
        })
      ).files,
    ).toEqual([{ filePath: "B.md", fileHash: "old" }]);
    expect(
      (await t.mutation(internal.vaultFiles.backfill, { userId: "fixture" }))
        .afterPath,
    ).toBe("B.md");
    expect(
      (await t.mutation(internal.vaultFiles.backfill, { userId: "fixture" }))
        .complete,
    ).toBe(true);
    expect(
      (
        await t.query(internal.vaultFiles.page, {
          userId: "fixture",
          cursor: null,
        })
      ).files,
    ).toEqual([
      { filePath: "A.md", fileHash: "old" },
      { filePath: "B.md", fileHash: "old" },
    ]);
    expect(
      (
        await t.query(internal.vaultFiles.page, {
          userId: "fixture",
          cursor: null,
        })
      ).cursor,
    ).toBeNull();
  });
  it("replacement and deletion on either side of a backfill checkpoint cannot resurrect stale hashes", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    await t.run(async (ctx) => {
      for (const path of ["A.md", "B.md", "C.md"])
        await ctx.db.insert("noteChunks", chunk(path));
    });
    await t.mutation(internal.vaultFiles.backfill, { userId: "fixture" });
    await t.mutation(internal.noteChunks.replaceFile, {
      userId: "fixture",
      filePath: "A.md",
      chunks: [chunk("A.md", "replaced")],
    });
    await t.mutation(internal.noteChunks.deleteByFile, {
      userId: "fixture",
      filePath: "B.md",
    });
    await t.mutation(internal.noteChunks.replaceFile, {
      userId: "fixture",
      filePath: "C.md",
      chunks: [chunk("C.md", "new")],
    });
    await t.mutation(internal.vaultFiles.backfill, { userId: "fixture" });
    await t.mutation(internal.noteChunks.deleteByFile, {
      userId: "fixture",
      filePath: "C.md",
    });
    await t.mutation(internal.vaultFiles.backfill, { userId: "fixture" });
    await t.mutation(internal.vaultFiles.backfill, { userId: "fixture" });
    expect(
      (
        await t.query(internal.vaultFiles.page, {
          userId: "fixture",
          cursor: null,
        })
      ).files,
    ).toEqual([{ filePath: "A.md", fileHash: "replaced" }]);
    // New paths behind the migration cursor still receive metadata atomically.
    await t.mutation(internal.noteChunks.insertBatch, {
      userId: "fixture",
      chunks: [chunk("0.md", "append")],
    });
    expect(
      (
        await t.query(internal.vaultFiles.page, {
          userId: "fixture",
          cursor: null,
        })
      ).files,
    ).toEqual([
      { filePath: "0.md", fileHash: "append" },
      { filePath: "A.md", fileHash: "replaced" },
    ]);
  });
  it("serializes overlapping whole-file writes and keeps one matching manifest", async () => {
    const t = convexTest({ schema, modules });
    await Promise.all(
      ["one", "two"].map((hash) =>
        t.mutation(internal.noteChunks.replaceFile, {
          userId: "fixture",
          filePath: "A.md",
          chunks: [chunk("A.md", hash)],
        }),
      ),
    );
    const rows = await t.query(internal.noteChunks.listByFile, {
      userId: "fixture",
      filePath: "A.md",
    });
    const manifests = await t.run((ctx) =>
      ctx.db.query("vaultFiles").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(manifests).toHaveLength(1);
    expect(manifests[0].fileHash).toBe(rows[0].fileHash);
  });
  it("keeps metadata consistent when backfill overlaps replacement and deletion", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    await t.run(async (ctx) => {
      await ctx.db.insert("noteChunks", chunk("A.md"));
      await ctx.db.insert("noteChunks", chunk("B.md"));
    });
    await Promise.all([
      t.mutation(internal.vaultFiles.backfill, { userId: "fixture" }),
      t.mutation(internal.noteChunks.replaceFile, {
        userId: "fixture",
        filePath: "A.md",
        chunks: [chunk("A.md", "new")],
      }),
      t.mutation(internal.noteChunks.deleteByFile, {
        userId: "fixture",
        filePath: "B.md",
      }),
    ]);
    for (let i = 0; i < 3; i++)
      await t.mutation(internal.vaultFiles.backfill, { userId: "fixture" });
    expect(
      (
        await t.query(internal.vaultFiles.page, {
          userId: "fixture",
          cursor: null,
        })
      ).files,
    ).toEqual([{ filePath: "A.md", fileHash: "new" }]);
    expect(
      await t.query(internal.noteChunks.listByFile, {
        userId: "fixture",
        filePath: "B.md",
      }),
    ).toEqual([]);
  });
  it("serves old map and new paginated contracts through separate bounded transactions", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { bytesRead: 500_000 },
    });
    for (let i = 0; i < 12; i++)
      await t.run((ctx) =>
        ctx.db.insert("noteChunks", {
          ...chunk(`${i}.md`),
          content: "x".repeat(200_000),
        }),
      );
    // This is deliberately larger than one transaction: projections after a
    // collect would fail. Both fallback pages and backfill stay below budget.
    await expect(
      t.query(async (ctx) =>
        (await ctx.db.query("noteChunks").collect()).map((row) => row.fileHash),
      ),
    ).rejects.toThrow();
    const legacy = await t.action(async (ctx) =>
      (
        await hashesResponse(
          ctx,
          new Request("https://fixture.invalid/api/vault/hashes"),
          "fixture",
        )
      ).json(),
    );
    expect(Object.keys(legacy)).toHaveLength(12);
    for (let i = 0; i < 13; i++)
      await t.mutation(internal.vaultFiles.backfill, { userId: "fixture" });
    const response = await t.action(async (ctx) =>
      (
        await hashesResponse(
          ctx,
          new Request("https://fixture.invalid/api/vault/hashes?protocol=2"),
          "fixture",
        )
      ).json(),
    );
    expect(response.version).toBe(2);
    expect(response.cursor).toBeNull();
    expect(response.hashes).toEqual(legacy);
    expect(
      await t.query(internal.noteChunks.allFilePaths, { userId: "fixture" }),
    ).toEqual(legacy);
  });
  it("uses the old last-append hash during backfill and includes removal state", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("noteChunks", chunk("A.md", "first"));
      await ctx.db.insert("noteChunks", {
        ...chunk("A.md", "last"),
        chunkIndex: 1,
      });
    });
    await t.mutation(internal.vaultFiles.backfill, { userId: "fixture" });
    await t.mutation(internal.vaultFiles.backfill, { userId: "fixture" });
    expect(
      await t.query(internal.noteChunks.allFilePaths, { userId: "fixture" }),
    ).toEqual({ "A.md": "last" });
    await t.mutation(internal.noteChunks.deleteByFile, {
      userId: "fixture",
      filePath: "A.md",
    });
    expect(
      await t.query(internal.noteChunks.allFilePaths, { userId: "fixture" }),
    ).toEqual({});
  });
  it("paginates manifests including tombstones without losing active paths", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    await t.run(async (ctx) => {
      await ctx.db.insert("vaultManifestBackfills", {
        userId: "fixture",
        complete: true,
      });
      for (let i = 0; i < 205; i++)
        await ctx.db.insert("vaultFiles", {
          userId: "fixture",
          filePath: `${String(i).padStart(3, "0")}.md`,
          fileHash: i % 2 ? "hash" : null,
        });
    });
    const hashes = await t.action(async (ctx) =>
      (
        await hashesResponse(
          ctx,
          new Request("https://fixture.invalid/api/vault/hashes"),
          "fixture",
        )
      ).json(),
    );
    expect(Object.keys(hashes)).toHaveLength(102);
    expect(hashes["001.md"]).toBe("hash");
    expect(hashes["203.md"]).toBe("hash");
    expect(hashes["204.md"]).toBeUndefined();
    await expect(
      t.query(internal.noteChunks.allFilePaths, { userId: "fixture" }),
    ).rejects.toThrow("paginated");
  });
  it("provides bounded per-reader metadata cleanup for account-purge integration", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("vaultManifestBackfills", {
        userId: "fixture",
        complete: true,
      });
      await ctx.db.insert("vaultFiles", {
        userId: "other",
        filePath: "private.md",
        fileHash: "private",
      });
      for (let i = 0; i < 65; i++)
        await ctx.db.insert("vaultFiles", {
          userId: "fixture",
          filePath: `${i}.md`,
          fileHash: "hash",
        });
    });
    const sizes: number[] = [];
    for (let i = 0; i < 4; i++)
      sizes.push(await t.mutation((ctx) => purgeMetadata(ctx, "fixture")));
    expect(sizes).toEqual([64, 1, 1, 0]);
    expect(
      (await t.run((ctx) => ctx.db.query("vaultFiles").collect())).map(
        (row) => row.userId,
      ),
    ).toEqual(["other"]);
  });
  it("preserves multilingual/reserved/prototype-looking paths across Convex and old/new HTTP contracts", async () => {
    const t = convexTest({ schema, modules });
    const paths = [
      "笔记/世界.md",
      "$reserved.md",
      "__proto__",
      "constructor",
      "A".repeat(1100),
    ];
    await t.run(async (ctx) => {
      for (const path of paths) await ctx.db.insert("noteChunks", chunk(path));
    });
    const read = (suffix: string) =>
      t.action(async (ctx) =>
        (
          await hashesResponse(
            ctx,
            new Request(`https://fixture.invalid/api/vault/hashes${suffix}`),
            "fixture",
          )
        ).text(),
      );
    const old = JSON.parse(await read(""));
    expect(Object.keys(old).sort()).toEqual(paths.sort());
    for (let i = 0; i <= paths.length; i++)
      await t.mutation(internal.vaultFiles.backfill, { userId: "fixture" });
    const next = JSON.parse(await read("?protocol=2"));
    expect(next.hashes).toEqual(old);
    expect(next.cursor).toBeNull();
  });
  it("rejects a forged manifest cursor before completion rather than returning an empty complete index", async () => {
    const t = convexTest({ schema, modules });
    await t.run((ctx) => ctx.db.insert("noteChunks", chunk("A.md")));
    await expect(
      t.query(internal.vaultFiles.page, {
        userId: "fixture",
        cursor: JSON.stringify({ source: "manifest", afterPath: "" }),
      }),
    ).rejects.toThrow("not complete");
  });
});
