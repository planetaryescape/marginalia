#!/usr/bin/env bun
import { chunkNote } from "./chunker";
import { embedChunks } from "./embedder";
import { readVault } from "./reader";
import { deleteFile, getRemoteHashes, replaceFile } from "./uploader";

const DEFAULT_USER_ID = "default_user";

async function main() {
  // Parse args
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: bun run index --vault /path/to/vault [--dry-run]");
    console.log(
      "Preview changes with --dry-run before indexing. Requires CONVEX_SITE_URL and VAULT_INDEXER_API_KEY; indexing also needs OPENROUTER_API_KEY.",
    );
    return;
  }
  const dryRun = args.includes("--dry-run");
  const vaultIdx = args.indexOf("--vault");
  const vaultPath = vaultIdx >= 0 ? args[vaultIdx + 1] : process.env.VAULT_PATH;

  if (!vaultPath || vaultPath.startsWith("--")) {
    console.error("Usage: bun run index --vault /path/to/vault");
    console.error("  Or set VAULT_PATH environment variable");
    process.exit(1);
  }

  const convexUrl = process.env.CONVEX_SITE_URL;
  const vaultApiKey = process.env.VAULT_INDEXER_API_KEY;
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;

  if (!convexUrl || !vaultApiKey || (!dryRun && !openrouterApiKey)) {
    console.error(
      "Missing env vars: CONVEX_SITE_URL, VAULT_INDEXER_API_KEY, OPENROUTER_API_KEY",
    );
    process.exit(1);
  }

  console.log(`Reading vault: ${vaultPath}`);
  const notes = await readVault(vaultPath);
  console.log(`Found ${notes.length} notes`);

  // Get remote hashes for incremental sync
  console.log("Checking remote state...");
  const remoteHashes = await getRemoteHashes(convexUrl, vaultApiKey);
  const remoteFiles = new Set(Object.keys(remoteHashes));

  // Determine what needs updating
  const toUpdate = notes.filter((n) => remoteHashes[n.filePath] !== n.hash);
  const localFiles = new Set(notes.map((n) => n.filePath));
  const toDelete = [...remoteFiles].filter((f) => !localFiles.has(f));

  console.log(
    `Changes: ${toUpdate.length} to update, ${toDelete.length} to delete, ${notes.length - toUpdate.length} unchanged`,
  );
  if (dryRun) {
    for (const note of toUpdate)
      console.log(`  Would update: ${note.filePath}`);
    for (const filePath of toDelete)
      console.log(`  Would delete indexed chunks: ${filePath}`);
    console.log("Dry run: no embeddings generated or remote data changed.");
    return;
  }

  // Delete removed files
  for (const filePath of toDelete) {
    console.log(`  Deleting: ${filePath}`);
    await deleteFile(convexUrl, vaultApiKey, filePath);
  }

  if (toUpdate.length === 0) {
    console.log("Nothing to update. Done.");
    return;
  }

  // Chunk all notes that need updating
  console.log("Chunking notes...");
  const allChunks: Array<{
    note: (typeof toUpdate)[0];
    chunks: ReturnType<typeof chunkNote>;
  }> = [];

  for (const note of toUpdate) {
    const chunks = chunkNote(note.fileName, note.content);
    if (chunks.length > 0) {
      allChunks.push({ note, chunks });
    }
  }

  const totalChunks = allChunks.reduce((sum, c) => sum + c.chunks.length, 0);
  console.log(`Created ${totalChunks} chunks from ${allChunks.length} notes`);

  // Embed all chunks
  console.log("Generating embeddings...");
  const allTexts = allChunks.flatMap((c) => c.chunks.map((ch) => ch.content));
  // The earlier configuration check guarantees a key on a non-preview run.
  if (!openrouterApiKey)
    throw new Error("OPENROUTER_API_KEY is required for indexing");
  const embeddingResults = await embedChunks(allTexts, openrouterApiKey);

  // Build a set of successfully embedded indices
  const embeddingMap = new Map<number, number[]>();
  for (const r of embeddingResults) {
    embeddingMap.set(r.index, r.embedding);
  }

  // Build upload payload — only include chunks that got embeddings
  console.log("Uploading to Convex...");
  const now = Date.now();
  let globalIdx = 0;
  let uploaded = 0;
  let skipped = 0;

  for (const { note, chunks } of allChunks) {
    const uploadPayload = [];
    for (const chunk of chunks) {
      const embedding = embeddingMap.get(globalIdx);
      globalIdx++;
      if (!embedding) {
        skipped++;
        continue;
      }
      uploadPayload.push({
        userId: DEFAULT_USER_ID,
        filePath: note.filePath,
        fileName: note.fileName,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        tags: note.tags.length > 0 ? note.tags : undefined,
        embedding,
        fileHash: note.hash,
        indexedAt: now,
      });
    }

    // An incomplete file must not receive its new hash, or the next run would skip it.
    if (uploadPayload.length !== chunks.length) {
      console.warn(
        `  Keeping previous index for ${note.filePath}: incomplete embeddings`,
      );
      process.exitCode = 1;
      continue;
    }

    try {
      await replaceFile(convexUrl, vaultApiKey, note.filePath, uploadPayload);
      uploaded += uploadPayload.length;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`  Failed to upload ${note.filePath}: ${msg}`);
      skipped += uploadPayload.length;
      process.exitCode = 1;
    }
  }

  console.log(`Uploaded ${uploaded} chunks, skipped ${skipped}.`);

  console.log(
    `Finished: ${uploaded} chunks uploaded${process.exitCode ? "; some files need a retry" : ""}.`,
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
