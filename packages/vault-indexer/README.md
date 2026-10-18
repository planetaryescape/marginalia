# Sync a vault safely

Preview against a synthetic vault before indexing:

```sh
cd packages/vault-indexer
bun run index --vault /path/to/fixture --dry-run
```

Set `CONVEX_SITE_URL` and `VAULT_INDEXER_API_KEY` in your environment. A dry-run reads local files and remote hashes, but does not embed, upload, delete, or backfill. A normal run also requires `OPENROUTER_API_KEY`; omit `--dry-run` only when you intend to update the remote index.

Completed files commit immediately. If a file fails or you interrupt the run, run the same command again: remote hashes skip completed files. An incomplete file keeps its previous chunks and hash. Exit status 1 means the run failed or some files still need retrying. Authentication failures stop the run.

## Bounds and scanner rules

- Retain one complete file's text/chunks/vectors at a time; embedding requests contain at most 10 chunks. Hashes and path sets use memory proportional to file count, not corpus text/vector size.
- Keep the existing 100 KiB file limit, lowercase `.md` eligibility, and exclusions: `.obsidian`, `.git`, `.smart-env`, `.smart-connections`, `Extras`, `node_modules`, and nonregular files. Excluded/ineligible files are absent from reconciliation, as before.
- Read at most 100 KiB plus one sentinel byte from a file, even if it grows after its size check. Scanner errors stop removal reconciliation. Earlier completed file checkpoints remain committed.
- Include heading/file-name context within each 3,200-byte embedding input. Split oversized paragraphs at paragraph/sentence/word boundaries, then Unicode code points if needed. Retain short sections. Context that cannot fit fails the file explicitly rather than truncating it.
- Replace at most 128 chunks and upload at most 8 MB per file. Files beyond these bounds retain their old index. Existing remote files larger than 128 chunks or a 4 MB bounded read page also fail replacement/deletion without partial mutation; they require a separately planned migration, not a destructive retry.
- Apply a 30-second deadline per network attempt, including body consumption, and an 8 MB response limit. Retry network failures, timeouts, HTTP 429, and HTTP 5xx at most three attempts; bound `Retry-After` to 10 seconds. Do not retry permanent HTTP/input/response-shape failures. Stop further embedding batches for a failed file. Responses and credentials are not included in errors.
- The old fixed 300 ms embedding buffer was intentionally removed. Requests remain sequential; provider 429 responses and bounded `Retry-After` now determine additional waiting instead of imposing a pause when the provider has capacity. This can increase request frequency, especially for short files; it is not a fixed-rate limiter.

## Backend-first rollout (integration owner)

HTTP hash handling and account cleanup are integrated in this candidate. No live deployment or migration was run while implementing it.

1. Deploy the additive schema, metadata-aware chunk writers, new module, generated module declaration, HTTP handler, and account purge step together. The HTTP handler retains its API-key check and owner-only library identity. Account cleanup removes both metadata tables before reader/auth deletion. `vaultFiles` holds per-user/file hashes plus deletion tombstones; `vaultManifestBackfills` holds the per-user cursor/completion marker. There are no vector/content rewrites in the metadata backfill.

2. From `packages/backend`, explicitly start the internal migration driver on the verified deployment:

   ```sh
   bunx convex run --deployment stoic-hare-718 --codegen disable vaultFiles:runBackfill '{"userId":"default_user"}'
   ```

   Programmatic references use `internal.vaultFiles.runBackfill`; Convex CLI function names use `vaultFiles:runBackfill`, with no `internal:` prefix. The command does not push/deploy code. Verify the target deployment before running it.

   Each action awaits at most 25 separate single-file mutation transactions and schedules at most one continuation, 100 ms later. A kickoff permits at most 1,000 action runs (25,000 file/checkpoint transactions); rerun the command if that cap is reached before completion. No cron, deploy hook, HTTP request, or dry-run starts this driver. Completed checkpoints survive interruption/failure. Automated work refuses missing, disabled, or deleting non-owner libraries in the same transaction as each checkpoint.

3. Check completion with a lightweight internal query:

   ```sh
   bunx convex run --deployment stoic-hare-718 --codegen disable vaultFiles:backfillStatus '{"userId":"default_user"}'
   ```

   Wait for `complete: true`; `afterPath` is a string or `null`, including an empty vault. For manual single-step recovery, the exact command is:

   ```sh
   bunx convex run --deployment stoic-hare-718 --codegen disable vaultFiles:backfill '{"userId":"default_user"}'
   ```

   Its programmatic reference is `internal.vaultFiles.backfill`. Each invocation advances one indexed file using at most two chunk-document seeks, then saves its cursor atomically. Stop/restart freely. Replacement/deletion and old append uploads update manifests in the same transaction, so a resumed/racing backfill cannot overwrite them. Leave tombstones intact.

4. Verify fixture old/new clients, then the deployment's completion marker. Only after completion does a no-change run read exclusively the lightweight manifest. Before completion, bounded legacy pages read representative chunk documents; they never report a partial manifest as a complete empty index or discard removal paths.

5. Roll out the CLI. Old clients still receive the original hash map and use the same upload actions. New clients request `/api/vault/hashes?protocol=2`, receive `{ version: 2, hashes, cursor }`, and continue until `cursor: null`. Old servers ignore the query parameter and return the original map, which the new client accepts. A malformed/mixed/repeating paginated response aborts reconciliation.

The internal `noteChunks.allFilePaths` query is now bounded and refuses an incomplete page. It is not a replacement for the HTTP action helper on large or unmigrated vaults. The action helper runs each page in a separate transaction; looping queries within one transaction would not bound cumulative read bytes.

Backfill preserves existing last-appended hashes. It does not diagnose or repair partial/duplicate indexes left by historical append clients. The retained legacy append action is still non-atomic across requests; use the current CLI's whole-file replacement for checkpoint guarantees.

## Verify without a personal vault or paid provider

```sh
cd packages/backend
bun run test
bun run typecheck
cd ../vault-indexer
bun run test
bun run typecheck
```

`cli.test.ts` runs the actual dry-run CLI against a temporary synthetic vault and local HTTP fixture with no provider key. Backend tests enforce transaction read budgets; indexer tests count retained file groups, completed checkpoints, request attempts, timeouts, cancellation, and old/new protocol compatibility.
