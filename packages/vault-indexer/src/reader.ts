import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, extname, basename } from "node:path";
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
  await walkDir(vaultPath, vaultPath, notes);
  return notes;
}

async function walkDir(
  dir: string,
  vaultRoot: string,
  notes: VaultNote[],
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkDir(fullPath, vaultRoot, notes);
      continue;
    }

    if (!entry.isFile() || extname(entry.name) !== ".md") continue;

    // Check file size
    const fileStat = await stat(fullPath);
    if (fileStat.size > MAX_FILE_SIZE) continue;

    try {
      const raw = await readFile(fullPath, "utf-8");
      const relPath = relative(vaultRoot, fullPath);

      // Parse frontmatter
      const { data, content } = matter(raw);
      const tags: string[] = [];
      if (Array.isArray(data.tags)) {
        tags.push(...data.tags.map(String));
      }

      // Compute hash
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(raw);
      const hash = hasher.digest("hex");

      notes.push({
        filePath: relPath,
        fileName: basename(entry.name, ".md"),
        content: content.trim(),
        tags,
        hash,
      });
    } catch (error) {
      console.warn(`Skipping ${fullPath}: ${error}`);
    }
  }
}
