import { chunkNote } from "./chunker";
import type { EmbeddingResult } from "./embedder";
import { HttpError } from "./network";
import type { VaultNote } from "./reader";
import type { ChunkUpload } from "./uploader";

interface SyncOptions {
  dryRun?: boolean;
  signal?: AbortSignal;
  embed(texts: string[]): Promise<EmbeddingResult[]>;
  replace(filePath: string, chunks: ChunkUpload[]): Promise<void>;
  remove(filePath: string): Promise<void>;
  log?(message: string): void;
  /** Deterministic retained-group evidence, not a heap-size approximation. */
  retainedGroups?(count: number): void;
}

export interface SyncResult {
  updated: number;
  unchanged: number;
  failed: number;
  removed: number;
}

export async function syncVault(
  notes: AsyncIterable<VaultNote>,
  remoteHashes: Record<string, string>,
  options: SyncOptions,
): Promise<SyncResult> {
  const localFiles = new Set<string>();
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let removed = 0;
  for await (const note of notes) {
    options.signal?.throwIfAborted();
    localFiles.add(note.filePath);
    if (
      Object.hasOwn(remoteHashes, note.filePath) &&
      remoteHashes[note.filePath] === note.hash
    ) {
      unchanged++;
      continue;
    }
    if (options.dryRun) {
      options.log?.(`Would update: ${note.filePath}`);
      updated++;
      continue;
    }
    options.retainedGroups?.(1);
    try {
      const chunks = chunkNote(note.fileName, note.content);
      if (chunks.length === 0 || chunks.length > 128)
        throw new Error("File has no indexable content or exceeds 128 chunks");
      const embeddings = await options.embed(
        chunks.map((chunk) => chunk.content),
      );
      const byIndex = new Map(
        embeddings.map((result) => [result.index, result.embedding]),
      );
      if (byIndex.size !== chunks.length || embeddings.length !== chunks.length)
        throw new Error("Incomplete file embeddings");
      const payload = chunks.map((chunk): ChunkUpload => {
        const embedding = byIndex.get(chunk.chunkIndex);
        if (
          !embedding ||
          embedding.length !== 1536 ||
          embedding.some((n) => !Number.isFinite(n))
        )
          throw new Error("Invalid file embedding");
        return {
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          userId: "default_user",
          filePath: note.filePath,
          fileName: note.fileName,
          tags: note.tags.length ? note.tags : undefined,
          embedding,
          fileHash: note.hash,
          indexedAt: Date.now(),
        };
      });
      options.signal?.throwIfAborted();
      await options.replace(note.filePath, payload);
      updated++;
    } catch (error) {
      options.signal?.throwIfAborted();
      if (
        error instanceof HttpError &&
        (error.status === 401 || error.status === 403)
      )
        throw error;
      failed++;
      options.log?.(
        `Keeping previous index for ${note.filePath}: ${error instanceof Error ? error.message : "file failed"}`,
      );
    } finally {
      options.retainedGroups?.(0);
    }
  }
  // Only a fully successful scanner traversal authorizes removals. Parse/read
  // failures throw out of the iterator, retaining all remote removal state.
  for (const filePath of Object.keys(remoteHashes)) {
    options.signal?.throwIfAborted();
    if (localFiles.has(filePath)) continue;
    if (options.dryRun)
      options.log?.(`Would delete indexed chunks: ${filePath}`);
    else await options.remove(filePath);
    removed++;
  }
  return { updated, unchanged, failed, removed };
}
