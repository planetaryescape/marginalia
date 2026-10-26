# Verify Scripture margin notes and reading-source choices

Open an existing licensed Bible reading after reloading the reader. Its saved WEB notes should attach to the displayed verses without another annotation request. On the desk, open **Look in**: the Radix menu offers **Articles only**, **Articles + Bible** and **Bible only**, with the current choice checked. Use arrows and Enter to choose, or Escape to close and return focus.

## Why existing notes disappeared

A read-only inspection found three persisted, correctly anchored notes for an existing Psalms 23 reading, with no dismissal state hiding them. The current NIV API response uses empty numeric verse markers (`span.yv-v[v]`) followed by verse text across several blocks. The old mapper looked only for `data-usfm` wrappers, so it produced zero display anchors and dropped all three notes.

The regression uses synthetic wording in the provider's actual structural shape and renders through the installed reader component. A separate structural-only probe used the current provider response and saved source: the baseline mapped 0/3 notes; the correction mapped 3/3 with matching displayed-text offsets. Licensed wording and the app credential stayed in process memory, outside prompts, committed fixtures and logs. This is adapter/mapping evidence, not signed-in visual proof.

Re-annotating did not address that failure: a later read-only inspection showed the reader's explicit request completed and published two new notes, while the unchanged display mapper could still hide them. Reload the corrected frontend before deciding that generation produced nothing.

## Request the new Scripture lens deliberately

Use **More actions → Re-annotate with latest vault** for a selected passage. Scripture now has its own system and user instructions: attend to genre, separate observation from interpretation/application, and offer only supported consequential findings. There is no objection share or minimum note count. No scholarly corpus, manuscript apparatus or original-word alignment was added; the prompt must not invent those authorities.

The ordinary article prompt and global annotation version are unchanged. A Bible-only semantic prompt revision lets an explicit refresh notice the new instructions without a library-wide backfill. Existing duplicate-request, ownership, opt-out, lease and publication checks remain in force. Failed replacement retains previous output; personal writing and answered reflections remain protected.

## Check the source menu

The scope picker uses the app's existing Radix radio-menu primitives and theme tokens, not a native select or a new UI package. It is non-modal. Pending saves cannot dispatch a second request, failed saves leave the old value visible with local Retry, and keyboard focus is preserved even when a save is slow.

The actual-component fixture uses compiled production CSS and a local mock mutation, without app authentication or live library access. Desktop and 390px mobile checks cover menu choices, keyboard selection, focus return and failed-save Retry; automated WCAG A/AA scans report zero violations in all six themes. This does not establish signed-in preference persistence, which still needs the consuming-client smoke.

## Verification and release boundary

Coordinator checks on the integrated runtime candidate passed 1,773 backend tests, 1,220 web tests, workspace typecheck and the production build. The first concurrent web run hit two existing huge-context tests' five-second deadlines and then cascading fixture failures; the full rerun passed with the established release timeout of 30 seconds. No test was skipped. Changed React files score 100/100 in React Doctor.

The root lint gate also exposed formatting/import-order errors in three existing startup files. Their correction is mechanical; no startup behavior changed. Final lint/build checks and deployment identity are recorded at release closeout rather than assumed here.

The intended target remains **https://reader.bhekani.com**, backed by **`dev:stoic-hare-718`**. A pre-update export including file storage and auth components was downloaded and ZIP-validated at snapshot timestamp `1793051691860585544`. Keep the previous frontend and compatible backend source for rollback; do not restore personal data merely to revert code. No schema migration, bulk regeneration or source-account change is part of this release.

**Open:** the reported inability to drag-select words in Dia has not been diagnosed or fixed by this mapping change. Native inspection reached the authenticated reader in the accessibility tree, but screenshot capture returned blank frames and did not establish a reliable selection repro. See [the selection investigation](../issues/bible-reader-text-selection.md). Signed-in end-to-end reader/finish verification and a real-model quality comparison remain unverified; passing fixtures is not a substitute.
