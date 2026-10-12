# Multi-user plan

Marginalia currently serves one owner. This plan opens it to a small set of approved readers who bring their own AI credentials. Each phase is deployable on its own and keeps the owner's library working.

## Decisions

- **Access:** a waitlist. People request access; the owner approves them, which issues a one-time invite. Public signup stays closed.
- **AI credentials:** each reader adds an OpenRouter, OpenAI or Anthropic key. Available models follow the keys they provided. Marginalia never falls back to the owner's keys for another reader.
- **Search and related notes:** these need embeddings, which only OpenAI and OpenRouter keys provide here. Without one of those keys, search explains what to add; reading, notes and highlights still work.
- **Sign in with ChatGPT:** built as an optional provider that stays off. OpenAI currently offers ChatGPT plan usage to open-source and locally hosted apps; a hosted app like this one must apply through OpenAI's [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/) first. See [OpenAI's overview](https://developers.openai.com/siwc/token-sharing-open-source).

## Phase 1: separate libraries

Every table already carries a `userId`, but every function writes and reads the shared `default_user` value. This phase derives the reader from the signed-in session instead.

- Resolve the signed-in reader's library ID on the server, never from a request argument. The owner keeps the existing `default_user` library ID, so no personal rows are rewritten.
- Check ownership on every lookup by document ID (articles, notes, highlights, threads, sessions, summaries) and on every list.
- Scope feeds, Readwise state, queue counters, reports and vault chunks per reader. Duplicate URLs are deduplicated within a library, not across readers.
- Add cross-reader tests: a second reader cannot read, list, change or search the first reader's content.

The owner remains the only account at the end of this phase, so behavior is unchanged.

## Phase 2: reader-supplied keys

- Store credentials encrypted with a server-held key (AES-GCM). Keys are write-only from the browser: shown as provider and last four characters, replaceable and removable.
- Validate a key when it is saved by listing that provider's models.
- Build each reader's model list from their providers. Settings let them choose models for annotations, quick answers and deep answers from that list.
- Route every AI feature (summaries, companion, Ask, search, annotations) through the reader's own provider. Use `openai/text-embedding-3-small` through OpenAI or OpenRouter, so existing 1536-dimension vectors stay compatible.
- Move the owner from deployment environment keys to their own saved key, then remove the shared fallback.

## Phase 3: waitlist and background work

- Request-access form, owner review page, approval that issues a time-limited invite, and account setup with passkeys and password fallback.
- Run feed polling, Readwise sync and annotation per reader, using that reader's own credentials and Readwise token, with per-reader limits.
- Per-reader account deletion that removes their library and credentials.

## Phase 4: ChatGPT plan provider (off by default)

- Implement OAuth with PKCE and the Responses API adapter: streaming only, `store: false`, no output-token cap, history sent each time.
- Keep it behind a flag until OpenAI approves this hosted app.

## Rollout safeguards

Back up the shared backend, including auth records, before each phase. Verify that anonymous requests and other readers are denied before inviting anyone.
