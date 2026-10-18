import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import matter from "gray-matter";

// Directories to skip
const SKIP_DIRS = new Set([
  ".obsidian",
  ".git",
  ".smart-env",
  ".smart-connections",
  "Extras",
  "node_modules",
]);

// Max file size: 100KB
const MAX_FILE_SIZE = 100 * 1024;

export interface VaultNote {
  filePath: string; // Relative to vault root
  fileName: string; // Without extension
  content: string; // Markdown content without frontmatter
  tags: string[];
  hash: string; // SHA-256 of file content
}

export async function readVault(vaultPath: string): Promise<VaultNote[]> {
  const notes: VaultNote[] = [];
  for await (const note of iterateVault(vaultPath)) notes.push(note);
  return notes;
}

export async function* iterateVault(
  vaultPath: string,
): AsyncGenerator<VaultNote> {
  yield* walkDir(vaultPath, vaultPath);
}

async function* walkDir(
  dir: string,
  vaultRoot: string,
): AsyncGenerator<VaultNote> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walkDir(fullPath, vaultRoot);
      continue;
    }

    if (!entry.isFile() || extname(entry.name) !== ".md") continue;

    // Check file size
    const fileStat = await stat(fullPath);
    if (fileStat.size > MAX_FILE_SIZE) continue;

    try {
      // The file may grow after stat; never allocate an unbounded read buffer.
      const handle = await open(fullPath, "r");
      let raw: string;
      try {
        const buffer = Buffer.alloc(MAX_FILE_SIZE + 1);
        let bytesRead = 0;
        while (bytesRead < buffer.length) {
          const part = await handle.read(
            buffer,
            bytesRead,
            buffer.length - bytesRead,
            bytesRead,
          );
          if (part.bytesRead === 0) break;
          bytesRead += part.bytesRead;
        }
        if (bytesRead > MAX_FILE_SIZE) continue;
        raw = buffer.subarray(0, bytesRead).toString("utf8");
      } finally {
        await handle.close();
      }
      const relPath = relative(vaultRoot, fullPath);

      // Parse frontmatter
      const { data, content } = matter(raw);
      const tags: string[] = [];
      if (Array.isArray(data.tags)) {
        tags.push(...data.tags.map(String));
      }

      // Compute hash
      const hash = createHash("sha256").update(raw).digest("hex");

      yield {
        filePath: relPath,
        fileName: basename(entry.name, ".md"),
        content: content.trim(),
        tags,
        hash,
      };
    } catch (error) {
      // A skipped read would look like a deleted file during remote reconciliation.
      throw new Error(
        `Couldn't read ${fullPath}; no remote reconciliation is safe`,
        { cause: error },
      );
    }
  }
}
