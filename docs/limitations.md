# Known limitations

These remain after the polish pass. They are not reasons to replace settled UI decisions or silently migrate the user's data.

## Resolve before a confidential or multi-user release

- **Credential verification pending:** owner-only authentication is deployed, anonymous access is denied, and the owner confirmed library access and passkey enrollment. Passkey sign-in after sign-out, authenticator enrollment, token refresh and phone/PWA sign-in still need testing. Follow the [account verification steps](operations.md#roll-out-owner-authentication).
- **AI quotas:** authentication blocks anonymous requests, but there is no owner spending quota. Authorized reading, re-annotation, sync and companion requests can still incur provider spend. Saving a key also starts a paced [catch-up](operations.md#catching-up-after-a-key-is-saved) of work skipped without one, which spends on that reader's key.
- **Older skipped articles:** articles skipped for lack of a key before skip reasons were recorded aren't caught up automatically; use **Re-annotate** on each.
- **Shared dev/live backend:** the existing production web app uses a Convex development deployment also used locally. Separate it with an explicit backup/migration plan.
- **External providers:** articles, selections, stored context and indexed notes may be sent to OpenRouter/model providers. Readwise receives linked reading/highlight changes. Consent/retention policy has not been formalized.

See [operations](operations.md#access-control) before deploying sensitive content. None of these is fixed by hiding the frontend URL.

## Reliability and scale

- Notes have in-memory retry and a best-effort tab-close warning, not an offline outbox or durable local draft backup. Navigation away from the reader can still lose unsaved text.
- PWA installation adds a standalone launcher and an offline fallback, not downloaded articles, offline writes or background sync. Physical phone installation, native text selection and resume/keyboard behaviour still need device checks; see [the phone guide](mobile-and-pwa.md).
- iPhone touch feedback uses a deployed best-effort Safari native-switch fallback, not a general vibration API. It still needs a physical-phone check; simulated switch toggles cannot prove the device produced a tap.
- Some collections are bounded recent views. Reading reports cap each input dataset at 5,001 rows and explicitly label partial totals, with the 25 most recent articles shown. There is no full pagination/large-library performance contract yet.
- Reader sync checks all pages of Inbox, Later and Shortlist with leased/resumable pacing. Archive, Feed, unsupported formats, missing text and oversized documents remain excluded; it is not a complete mirror of Reader.
- Active reading estimates do not measure comprehension. Historical unrecorded time cannot be reconstructed. Checkpoint retries retain at most 64 visit/day snapshots in local storage; cleared, unavailable or full storage can lose unsent activity. Notes do not use that outbox.
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
