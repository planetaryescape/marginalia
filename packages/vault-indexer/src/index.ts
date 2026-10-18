#!/usr/bin/env bun
import { embedChunks } from "./embedder";
import { iterateVault } from "./reader";
import { syncVault } from "./sync";
import { deleteFile, getRemoteHashes, replaceFile } from "./uploader";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: bun run index --vault /path/to/vault [--dry-run]");
    console.log(
      "Requires CONVEX_SITE_URL and VAULT_INDEXER_API_KEY; indexing also needs OPENROUTER_API_KEY. Completed files checkpoint immediately.",
    );
    return;
  }
  const dryRun = args.includes("--dry-run");
  const vaultIdx = args.indexOf("--vault");
  const vaultPath = vaultIdx >= 0 ? args[vaultIdx + 1] : process.env.VAULT_PATH;
  if (!vaultPath || vaultPath.startsWith("--"))
    throw new Error("Pass --vault /path/to/vault or set VAULT_PATH");
  const convexUrl = process.env.CONVEX_SITE_URL;
  const vaultApiKey = process.env.VAULT_INDEXER_API_KEY;
  const embeddingKey = process.env.OPENROUTER_API_KEY;
  if (!convexUrl || !vaultApiKey || (!dryRun && !embeddingKey))
    throw new Error("Missing required vault environment variables");
  const controller = new AbortController();
  const abort = () =>
    controller.abort(
      new Error("Vault sync interrupted; completed files are checkpointed"),
    );
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  const options = { signal: controller.signal };
  try {
    const hashes = await getRemoteHashes(convexUrl, vaultApiKey, options);
    const result = await syncVault(iterateVault(vaultPath), hashes, {
      ...options,
      dryRun,
      log: console.log,
      embed: (texts) => embedChunks(texts, embeddingKey ?? "", options),
      replace: (path, chunks) =>
        replaceFile(convexUrl, vaultApiKey, path, chunks, options),
      remove: (path) => deleteFile(convexUrl, vaultApiKey, path, options),
    });
    console.log(
      `${dryRun ? "Dry run (no embeddings or writes)" : "Finished"}: ${JSON.stringify(result)}`,
    );
    if (result.failed) process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Vault sync failed");
  process.exitCode = 1;
});
