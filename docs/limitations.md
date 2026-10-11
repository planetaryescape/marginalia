# Known limitations

These remain after the polish pass. They are not reasons to replace settled UI decisions or silently migrate the user's data.

## Resolve before a confidential or multi-user release

- **Unauthenticated shared data:** `default_user` is not a security boundary. Public backend functions expose the shared library and mutation surface.
- **Unbounded AI spend:** public AI endpoints have request validation and a model allowlist but no per-user quota/rate limit.
- **Shared dev/live backend:** the existing production web app uses a Convex development deployment also used locally. Separate it with an explicit backup/migration plan.
- **External providers:** articles, selections, stored context and indexed notes may be sent to OpenRouter/model providers. Readwise receives linked reading/highlight changes. Consent/retention policy has not been formalized.

See [operations](operations.md#access-control) before deploying sensitive content. None of these is fixed by hiding the frontend URL.

## Reliability and scale

- Notes have in-memory retry and a best-effort tab-close warning, not an offline outbox or durable local draft backup. Navigation away from the reader can still lose unsaved text.
- PWA installation adds a standalone launcher and an offline fallback, not downloaded articles, offline writes or background sync. Physical phone installation, native text selection and resume/keyboard behaviour still need device checks; see [the phone guide](mobile-and-pwa.md).
- Some collections are bounded recent views; analytics also retain legacy scans/joins. There is no full pagination/large-library performance contract yet.
- Reader sync imports unread text queues and limits the first import to 100 recently updated items; it is not a complete mirror of Reader.
- Publisher extraction, speech voices and AI provider availability vary. A saved URL does not guarantee successful article extraction.
- Vault indexing excludes some paths and files over 100KB, may omit small multi-section content and does not split huge single paragraphs. Empty notes do not clear a prior nonempty index. Hashes track file content, so chunker/model changes require an explicit reindex strategy.
- The vault removal list is derived from eligible local files, not a separate explicit deletion manifest. Always dry-run, especially when switching paths or scanner rules.

Verify changes with [development](development.md#make-a-safe-change); do not use personal content as a disposable fixture.

## Tooling and verification

- The checkout currently has no Git remote. Clone/PR verification and CI setup are not complete.
- React Doctor reports legacy patterns elsewhere in the reader, plus non-blocking warnings in changed files. The pass removes reported changed-file errors and adds regression coverage rather than rewriting every hook; see [verification](verification.md).
- Next/Turbopack may emit parser warnings for valid `::highlight(...)` CSS. Keep browser verification of saved marks; do not replace the selectors with invalid pseudo-classes to silence a warning.
- There is no browser end-to-end suite in CI. Component/static markup tests and pure/mutation tests do not prove focus/layout across every device.
- No repository license has been selected.

Use [the decisions record](decisions.md#decisions-still-needed) to turn these into deliberate follow-up work.
