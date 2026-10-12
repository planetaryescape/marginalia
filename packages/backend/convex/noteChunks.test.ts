/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { ownerTest } from "../test/owner";
import { internal } from "./_generated/api";

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
      await t.query(internal.noteChunks.allFilePaths, {
        userId: "default_user",
      }),
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
  });
});
