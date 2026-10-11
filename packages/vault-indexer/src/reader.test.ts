import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readVault } from "./reader";

const fixtures: string[] = [];
afterEach(async () => {
  for (const path of fixtures.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function vault() {
  const path = await mkdtemp(join(tmpdir(), "marginalia-vault-test-"));
  fixtures.push(path);
  return path;
}

describe("vault scanner", () => {
  it("reads relative paths and frontmatter without indexing excluded directories", async () => {
    const path = await vault();
    await mkdir(join(path, "Folder"));
    await mkdir(join(path, ".obsidian"));
    await writeFile(
      join(path, "Folder", "Note.md"),
      "---\ntags: [reading]\n---\nA thought.",
    );
    await writeFile(join(path, ".obsidian", "Hidden.md"), "Hidden");
    const notes = await readVault(path);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      filePath: "Folder/Note.md",
      fileName: "Note",
      tags: ["reading"],
      content: "A thought.",
    });
    const hash = notes[0].hash;
    await writeFile(
      join(path, "Folder", "Note.md"),
      "---\ntags: [changed]\n---\nA thought.",
    );
    expect((await readVault(path))[0].hash).not.toBe(hash);
  });
  it("fails a partial scan instead of allowing unreadable notes to become remote deletions", async () => {
    const path = await vault();
    await writeFile(
      join(path, "Broken.md"),
      "---\ntags: [unterminated\n---\nStill a note.",
    );
    await expect(readVault(path)).rejects.toThrow(
      "no remote reconciliation is safe",
    );
  });
});
