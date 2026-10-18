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

## Backend-first rollout (integration owner)

Do not deploy this candidate without the HTTP integration below. No live deployment or migration was run while implementing it.

1. Keep the existing API-key check in `convex/http.ts`. Add `import { hashesResponse } from "./vaultFiles";`. In **only** the `/api/vault/hashes` handler, replace its final `runQuery(internal.noteChunks.allFilePaths, ...)` and JSON-response block with:

   ```ts
   return hashesResponse(ctx, request, DEFAULT_USER_ID);
   ```

2. Account cleanup must include the two additive metadata tables. In `convex/account.ts`, import `purgeMetadata` from `./vaultFiles` and append `(ctx, { userId }) => purgeMetadata(ctx, userId)` to the library purge steps **before reader/auth deletion**. The helper removes one bounded batch per invocation and returns zero when finished. The current public vault endpoint remains owner-only; this also covers future per-reader indexing.

3. Deploy the additive schema, metadata-aware chunk writers, new module, generated module declaration, and handler changes together. `vaultFiles` holds per-user/file hashes plus deletion tombstones; `vaultManifestBackfills` holds the per-user cursor/completion marker. There are no vector/content rewrites in the metadata backfill.

4. Invoke `internal.vaultFiles.backfill` with `{ userId: "default_user" }` repeatedly through the authorized deployment tooling until it returns `complete: true`. Each invocation advances one indexed file using at most two chunk-document seeks, then saves its cursor atomically. Stop/restart freely. Replacement/deletion and old append uploads update manifests in the same transaction, so a resumed/racing backfill cannot overwrite them. Leave tombstones intact.

5. Verify fixture old/new clients, then the deployment's manifest completion marker. Only after completion does a no-change run read exclusively the lightweight manifest. Before completion, bounded legacy pages read representative chunk documents; they never report a partial manifest as a complete empty index or discard removal paths.

6. Roll out the CLI. Old clients still receive the original hash map and use the same upload actions. New clients request `/api/vault/hashes?protocol=2`, receive `{ version: 2, hashes, cursor }`, and continue until `cursor: null`. Old servers ignore the query parameter and return the original map, which the new client accepts. A malformed/mixed/repeating paginated response aborts reconciliation.

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
