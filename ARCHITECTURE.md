# Architecture

Follow a reading action through the web client, Convex data and external services. The system has three workspace packages:

| Package | Owns | Entry points |
| --- | --- | --- |
| `apps/web` | Next.js App Router UI, reading interactions, browser preferences | `src/app`, `src/components`, `src/lib` |
| `packages/backend` | Convex schema, queries/mutations/actions, AI, ingestion and sync | `convex/schema.ts`, `convex/http.ts`, `convex/crons.ts` |
| `packages/vault-indexer` | Optional local Markdown chunking, embedding and index upload | `src/index.ts` |

Inspect these entry points rather than treating generated Convex bindings as handwritten application code.

## Reading and ingestion

```text
RSS polling / pasted URL / Readwise document
  → article extraction or supplied HTML
  → article storage + optional embedding
  → scheduled annotations
  → live Convex query → article reader
```

RSS polls every 30 minutes; Reader sync runs every 15 minutes when configured. Pasted URLs and Reader HTML share `convex/lib/ingest.ts`; RSS extraction has its own scheduled path. Content storage is constrained by Convex's document limit. Failed embeddings do not prevent an article from being stored.

The reader sanitizes imported HTML before rendering it. Saved highlights and companion passages are re-anchored against article text; paragraph navigation uses the rendered article body. Check `article-renderer.tsx`, `paragraphs.ts` and `text-range.ts` before changing article markup.

## Data and background work

Articles, annotations, sessions, interactions, notes, highlights, impressions, companion threads, summaries and saved/loved relationships live in Convex. Mutations are transactions; actions own extraction and external API calls. Background jobs are scheduled through internal functions.

Notes store rich-text HTML plus plain text. Plain text drives retrieval; HTML must be sanitized at render time. Editing a note clears its previous vector, schedules a fresh embedding and prevents stale jobs from committing against newer text. Deleting a note makes delayed embedding work a no-op.

Use `Doc`/`Id` from generated bindings and function argument validators at these boundaries. Run:

```bash
bun run typecheck
bun run test
```

## Contextual AI

Structured annotation/summary generation uses the AI SDK and Zod schemas. Passage and Library answers stream plain text through Convex HTTP actions. Model choices are validated against `convex/lib/openrouter.ts`; chosen models have fallbacks. Embeddings use `openai/text-embedding-3-small`, with 1536 dimensions across the vector indexes.

Library context combines article material and the reader's stored activity. Search validates ranked results against the retrieved articles; a model cannot invent an arbitrary result ID. Context assembly lives in `lib/library.ts` and `lib/marginaliaContext.ts`.

Provider failure is part of the contract: malformed embeddings fail validation, interrupted streams report an error, and user input remains available for retry. Test the behaviour through the actual UI as well as the pure request/prompt tests.

## UI ownership

The `(desk)` route group owns navigation and reader colour tokens. The full article route owns reading settings and tools. Root providers supply Convex, light/dark mode, notifications and the shortcut sheet. Reader appearance is persisted in browser storage; model settings and content live in Convex.

`shortcuts.ts` provides one dispatcher so navigation sequences win over single-key reading actions. `use-modal-dialog.ts` centralizes modal focus. `note-autosave.ts` buffers and serializes saves without clearing unacknowledged text.

To verify a change here, navigate between desk routes and then open an article. The URL paths do not include `(desk)`.

## Vault indexing

The CLI reads Markdown, strips frontmatter for chunk content, hashes the complete source file and uploads embeddings. A dry run compares local files with remote hashes without embedding or mutating the index. Whole-file replacement commits atomically in Convex; incomplete embeddings leave the previous file's index intact.

The vault HTTP endpoints require a bearer key. They are separate from the currently unauthenticated app API. Preview an index run using [the development guide](docs/development.md#optional-vault-index).

## Access boundary

`DEFAULT_USER_ID` is one shared identity. A Vercel domain is not authentication for Convex's public queries, mutations, actions or AI HTTP endpoints. The app does not currently enforce per-user ownership or model-call rate limits. Do not describe this architecture as secure multi-tenancy; use the [operations warnings](docs/operations.md#access-control) before deploying personal data.
