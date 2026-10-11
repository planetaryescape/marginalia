# Polish-pass verification

This record covers the October 2026 web/backend polish pass. It separates executed checks from work that still needs a product or deployment decision.

## Executed checks

| Check | Result |
| --- | --- |
| `bun run lint` | Biome formatting, imports and lint pass across the repository |
| `bun run typecheck` | Web, backend and vault-indexer pass; Next route types regenerate first |
| `bun run test` | 93 tests: 33 web, 56 backend, 4 indexer |
| `bun run build` with configured public Convex URLs | Production build passes; known Custom Highlight API, Browserslist and local workspace-root warnings remain |
| Clean source snapshot without local caches/credentials | Frozen-lockfile install, all checks, build with example deployment URLs and indexer `--help` pass |
| Documentation links | All relative file links resolve |
| Desktop and 390×844 mobile navigation | All six desk destinations preserve navigation/theme; no horizontal page overflow |
| Home search | `/` opens the floating combobox; Escape closes it; matching articles remain selectable |
| Article Notes | `n` opens the panel; `+ New` focuses the contenteditable labelled “Your note”; Escape closes an untouched editor |
| Browser errors during the inspected paths | None |
| “This week” accessibility | WCAG A/AA automated audit has no violations in paper, night, sepia and dusk after entrance motion settles |

Regression tests exercise failed/overlapping autosaves, invalid stored preferences, stale/deleted note embedding jobs, atomic vault replacement, malformed embedding responses, partial vault scan failure, pre-token model fallback and interrupted HTTP streaming.

## Findings retained deliberately

- React Doctor's changed-file score improved from **54 to 70**, with its reported errors removed. Remaining warnings concern legacy animation imports, fixed-array keys, localized dates, sequential OPML writes, complexity and a small promise/ref allocation. They are not a claim that the entire reader has been rewritten.
- Anti-slop reports two `unknown` input parameters in schema parsers (`parseReaderSettings`, `parseEmbeddings`). These functions **are the untrusted I/O boundary** and immediately parse with the existing Zod dependency. Narrowing the signatures before parsing would pretend storage/provider data was trusted. No rule was disabled to hide them.
- A clean source snapshot was checked, not a remote clone: this checkout has no Git remote.
- No real paid model call or destructive Reader/vault test was needed. HTTP/mutation regressions use isolated Convex fixtures and fake provider responses; an untouched editor verifies focus without creating a test note.

Automated audits do not prove accessibility on every browser or device. Read [limitations](limitations.md) for access control, offline durability and large-library work still outstanding; consult [operations](operations.md) before deploying.

## Mobile and PWA follow-up

- `bun run check` passes with **104 tests**: 44 web (including 11 PWA tests), 56 backend and 4 indexer. The production build passes with the configured public Convex URLs and the previously recorded build warnings.
- Chromium inspected all desk destinations at 320×568, 390×844, 430×932 and 1440×900. No horizontal page overflow; every mobile navigation destination is visible, with 48px-high targets.
- Reader controls have 44px touch targets on phone widths. Search opens with input focus and opens an existing article. Untouched note editors focus at 16px text on phones and close without creating records. Full-width phone notes and the separate-row question inputs were inspected.
- A simulated 344px VisualViewport height at 390×844 resized the notes panel above the keyboard region. This is not a physical iOS keyboard test.
- The production worker activated and controlled the page. Chrome offered the native Install app action. Stopping the local frontend produced the cached offline page at an article URL; restarting and retrying returned to the live desk. The test did not install onto a real phone.
- React Doctor reports **66/100**, no errors and 20 warnings in the changed-file scope, predominantly existing reader complexity, animation imports and render/date patterns. The scope differs from the earlier polish score and is not an apples-to-apples regression metric.
- The mobile Home WCAG A/AA audit reports one existing contrast violation on the small Worth revisiting label, plus manual-review items for the date separator and the portal trigger's ARIA reference. This follow-up does not claim a clean whole-app accessibility audit.

See [the phone guide](mobile-and-pwa.md) for installation, offline limits and the physical-device smoke test. This follow-up changes only the frontend; no backend deployment, data migration, real note write or paid AI call was performed.
