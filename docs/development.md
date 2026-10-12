# Development and integration setup

Get the app running with [the README](../README.md#run-locally) first. Use your own Convex deployment: the existing reader's deployment contains personal content.

## Configuration reference

| Variable | Set where | Required for |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | `apps/web/.env.local`; Vercel web environment | Live queries and mutations; the `.convex.cloud` URL |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Same web environment | HTTP AI routes; `.convex.site`, derived from the cloud URL if omitted |
| `CONVEX_DEPLOYMENT` | `packages/backend/.env.local`, created by Convex CLI | Selecting the CLI's development deployment |
| `OPENROUTER_API_KEY` | Convex deployment environment; also local indexer environment if used | AI generation and embeddings |
| `READWISE_TOKEN` | Convex deployment environment only | Optional Readwise Reader integration |
| `VAULT_INDEXER_API_KEY` | Convex deployment and local indexer environment, matching values | Authenticated vault index uploads and hash reads |
| `CONVEX_SITE_URL` | Local indexer environment | Vault HTTP endpoints, not the `.convex.cloud` URL |
| `VAULT_PATH` | Local indexer environment, or `--vault` argument | Vault directory to index |

Only deployment URLs belong in public web variables. Never prefix provider keys with `NEXT_PUBLIC_`, put secrets in docs, or commit a populated environment file. Use your password manager to inject secrets, or an ignored local env file.

## Enable AI

Run from the backend package so the CLI selects the correct project:

```bash
cd packages/backend
bunx convex env set OPENROUTER_API_KEY
```

The CLI prompts for the value. The key is stored on the selected Convex deployment, not in the web bundle. Set a spending limit in OpenRouter. Model IDs and fallback order are in `convex/lib/openrouter.ts`; availability should be smoke-tested before changing the allowlist.

Verify by adding one article in your own deployment, waiting for extraction and opening its annotations. Ask Explain for one passage, then use Home search. Without a key, imports can store article content but AI generation/retrieval may fail; this is not a fully offline app.

## Enable Readwise Reader

Obtain a token from [Readwise's access-token page](https://readwise.io/access_token), then run:

```bash
cd packages/backend
bunx convex env set READWISE_TOKEN
```

In **Sources**, the Reader card should show it is connected. Use **Sync now** to start or resume the pull. The full Inbox (`new`), Later and Shortlist is imported in pages of five documents, with a minute between pages and paced annotation jobs. There is no total import cap. Older installations also get this full backfill, even if the earlier 100-item sync recorded a watermark. After backfill, each completed sync overlaps its incremental watermark by two minutes. Archive, Feed, PDFs, EPUBs, tweets and videos remain excluded; missing text and oversized documents are skipped. The card shows checked/imported/skipped counts and pending annotations. A large library takes time and incurs model costs as eligible new articles are embedded and annotated. Automatic sync starts or resumes every 15 minutes; successful pages continue without the browser staying open.

This integration is **not read-only**: reading actions can move a linked document between Reader locations, and highlights are pushed to Reader. Inspect `actions/readwiseSync.ts` before testing against a personal account. Use [operations](operations.md#readwise-sync) to verify a change without deleting real data.

## Optional vault index

Index only a vault you intend to send to external embedding providers and make available to this deployment. The CLI reads Markdown and writes remote index records; it never edits local notes. Preview before making changes:

```bash
cp .env.example .env.local
# Fill the local file with indexer configuration, or inject values with your password manager.
bun --env-file=.env.local run --cwd packages/vault-indexer index --vault /absolute/path/to/vault --dry-run
```

Expected: lists of files that would be updated or removed from the remote index, ending with **no remote data changed**. Dry run needs the site URL and matching vault key, but not the provider key. Read the list before proceeding:

```bash
bun --env-file=.env.local run --cwd packages/vault-indexer index --vault /absolute/path/to/vault
```

Unchanged files are skipped by hash. A changed file replaces its remote chunks only after all its embeddings succeed, in one Convex transaction. Partial embedding/upload failures leave its previous index and exit non-zero for retry. Files missing from the eligible local note list have their remote chunks deleted, so pointing at the wrong vault can remove the prior index. One deployment currently represents one vault.

The scanner skips `.obsidian`, `.git`, `.smart-env`, `.smart-connections`, `Extras`, `node_modules` and Markdown files over 100KB. A read/frontmatter error aborts the scan before remote changes, rather than mistaking that file for a deletion. The chunker may skip small sections in multi-section notes and does not split a single oversized paragraph. Replacement accepts at most 128 chunks per file and requires 1536-dimensional vectors. Empty notes have no chunks and do not replace an old nonempty index. See [limitations](limitations.md) before treating the index as a complete copy of a vault.

## Commands

Run at the repository root:

| Command | Result |
| --- | --- |
| `bun run dev` | Runs both web and Convex watchers through Turbo |
| `bun run lint` | Biome formatting, imports and lint checks |
| `bun run lint:fix` | Applies safe lint and formatting fixes; inspect the diff |
| `bun run typecheck` | All workspace TypeScript, including generated Next routes |
| `bun run test` | Web tests, backend pure/mutation tests and indexer tests |
| `bun run check` | Lint → typecheck → tests |
| `bun run build` | Production Next.js build |

Use `bun run --cwd apps/web dev --port 3100` if port 3000 is occupied. Next generates route types before typecheck so moved route groups do not leave stale references. Turbo build cache includes public Convex URLs and env files; changing deployments must not reuse a bundle with the previous URL.

Backend mutation tests use `convex-test` and the edge runtime. Its version is currently pinned to a release compatible with the installed Convex SDK; update the pair together rather than ignoring peer dependency errors. Tests do not require a deployed backend or real credentials.

## Make a safe change

1. Inspect the existing implementation and [recorded decisions](decisions.md).
2. Add regression coverage for changed behaviour, using fixtures rather than live records.
3. Run `bun run check` and `bun run build`.
4. Exercise the affected UI with keyboard, desktop/mobile widths and an empty/error state.
5. Review the diff, including generated bindings and env examples. Follow [deployment](operations.md#deploy) only after checks pass.

Do not run `convex dev` against the existing personal deployment merely to generate bindings: it uploads backend changes. There is no configured Git remote in the current checkout; cloning and PR workflows need one to be chosen first.
