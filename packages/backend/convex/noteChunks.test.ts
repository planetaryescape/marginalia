/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { ownerTest } from "../test/owner";
import { internal } from "./_generated/api";
import { hashesResponse } from "./vaultFiles";

const modules = import.meta.glob("./**/*.ts");
const chunk = (fileHash: string, chunkIndex = 0) => ({
  userId: "default_user",
  filePath: "Note.md",
  fileName: "Note",
  chunkIndex,
  content: "A note",
  embedding: Array.from({ length: 1536 }, () => 0.1),
  fileHash,
  indexedAt: 1,
});

describe("atomic vault replacement", () => {
  it("replaces only the requested file and ignores a client-supplied user identity", async () => {
    const t = await ownerTest(modules);
    await t.mutation(internal.noteChunks.insertBatch, {
      userId: "default_user",
      chunks: [chunk("old"), { ...chunk("other"), filePath: "Other.md" }],
    });
    await t.mutation(internal.noteChunks.replaceFile, {
      userId: "default_user",
      filePath: "Note.md",
      chunks: [{ ...chunk("new"), userId: "someone_else" }, chunk("new", 1)],
    });
    const notes = await t.query(internal.noteChunks.listByFile, {
      userId: "default_user",
      filePath: "Note.md",
    });
    expect(
      notes.map((note) => [note.fileHash, note.chunkIndex, note.userId]),
    ).toEqual([
      ["new", 0, "default_user"],
      ["new", 1, "default_user"],
    ]);
    expect(
      await t.action(async (ctx) =>
        (
          await hashesResponse(
            ctx,
            new Request("https://fixture.invalid/api/vault/hashes"),
            "default_user",
          )
        ).json(),
      ),
    ).toEqual({
      "Note.md": "new",
      "Other.md": "other",
    });
  });
  it.each([
    { chunks: [] },
    { chunks: [chunk("new", 1)] },
    { chunks: [{ ...chunk("new"), filePath: "Wrong.md" }] },
    { chunks: [chunk("new"), chunk("different", 1)] },
    { chunks: [{ ...chunk("new"), embedding: [1] }] },
  ])("preserves existing chunks when the replacement is incomplete", async ({
    chunks,
  }) => {
    const t = await ownerTest(modules);
    await t.mutation(internal.noteChunks.insertBatch, {
      userId: "default_user",
      chunks: [chunk("old")],
    });
    await expect(
      t.mutation(internal.noteChunks.replaceFile, {
        userId: "default_user",
        filePath: "Note.md",
        chunks,
      }),
    ).rejects.toThrow();
    const notes = await t.query(internal.noteChunks.listByFile, {
      userId: "default_user",
      filePath: "Note.md",
    });
    expect(notes).toHaveLength(1);
    expect(notes[0].fileHash).toBe("old");
    expect(
      (await t.run((ctx) => ctx.db.query("vaultFiles").unique()))?.fileHash,
    ).toBe("old");
  });
  it("updates manifests with replace/delete/legacy append and isolates users", async () => {
    const t = await ownerTest(modules);
    await t.mutation(internal.noteChunks.replaceFile, {
      userId: "default_user",
      filePath: "Note.md",
      chunks: [chunk("first")],
    });
    await t.mutation(internal.noteChunks.insertBatch, {
      userId: "reader2",
      chunks: [chunk("private")],
    });
    const manifests = await t.run((ctx) =>
      ctx.db.query("vaultFiles").collect(),
    );
    expect(manifests.map((row) => [row.userId, row.fileHash])).toEqual([
      ["default_user", "first"],
      ["reader2", "private"],
    ]);
    await t.mutation(internal.noteChunks.deleteByFile, {
      userId: "default_user",
      filePath: "Note.md",
    });
    expect(
      (await t.run((ctx) => ctx.db.query("vaultFiles").collect())).map(
        (row) => row.fileHash,
      ),
    ).toEqual([null, "private"]);
    expect(
      (
        await t.query(internal.vaultFiles.page, {
          userId: "default_user",
          cursor: null,
        })
      ).files,
    ).toEqual([]);
  });
  it("preserves an oversized legacy file instead of partially replacing/deleting it", async () => {
    const t = await ownerTest(modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 129; i++)
        await ctx.db.insert("noteChunks", chunk("old", i));
      await ctx.db.insert("vaultFiles", {
        userId: "default_user",
        filePath: "Note.md",
        fileHash: "old",
      });
    });
    await expect(
      t.mutation(internal.noteChunks.replaceFile, {
        userId: "default_user",
        filePath: "Note.md",
        chunks: [chunk("new")],
      }),
    ).rejects.toThrow("budget");
    await expect(
      t.mutation(internal.noteChunks.deleteByFile, {
        userId: "default_user",
        filePath: "Note.md",
      }),
    ).rejects.toThrow("budget");
    expect(
      await t.query(internal.noteChunks.listByFile, {
        userId: "default_user",
        filePath: "Note.md",
      }),
    ).toHaveLength(129);
    expect(
      (await t.run((ctx) => ctx.db.query("vaultFiles").unique()))?.fileHash,
    ).toBe("old");
  });
});
