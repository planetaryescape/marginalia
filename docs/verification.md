# Polish-pass verification

This record covers the October 2026 web/backend polish pass. It separates executed checks from work that still needs a product or deployment decision.

## Reader backfill and contextual Define

- `bun run check` passes: lint, workspace typechecks and 120 tests (46 web, 70 backend, 4 indexer).
- Production Turbopack build passes in an isolated source copy with installed dependencies and public Convex URLs; the original local production build is preserved. Known Custom Highlight CSS/parser and stale Browserslist warnings remain. An initial dependency-symlink attempt failed because Turbopack rejects dependencies outside its root; installing the frozen lockfile in the isolated copy resolved that setup failure.
- Reader fixtures verify 125 imports across pages despite a legacy sync watermark, unsupported/missing-text skips, retained progress on failures, paced/exclusive leases, stale-worker fencing, and watermark advancement only after all locations and highlights. Reader fetches and embedding calls are mocked; scheduled model actions are not executed.
- Queue fixtures verify 250 annotated articles, a finished article older than 510 subsequent interactions, ten bounded suggestions, idempotent initialization, transactional annotation/length/finish changes, preserved content on duplicate URLs, and one annotation job per inserted article.
- Define request/prompt and saved-thread tests cover selected terms, sentence context, uncertain etymology, fitting substitutes, persistence and follow-ups. No live model-answer quality claim is made.
- Browser checks against the isolated production frontend verify Define click and `d` send the selected word, its paragraph index and 51 article paragraphs; requests are stubbed to fail before provider calls or saved-thread writes. Desktop and 390px phone screenshots show the new action in the existing toolbar. At 320×568, all passage controls remain within the viewport with 44px heights and no horizontal page overflow. Native phone selection remains untested.
- React Doctor on changed frontend files reports no diagnostics (74/100). The Impeccable detector flags only existing Home side accents, retained to preserve the incumbent design. The first headless browser session did not advance animation frames; a headed session restored paragraph tagging and screenshots.
- Pre-deployment checks used fixtures and blocked companion requests, without real note/rating/thread writes or paid model calls.

### Deployment verification

- After approval, exported the live backend with file storage to `marginalia-before-reader-backfill.zip` in the session's temporary directory. Implementation commit: `445a5b0`.
- Deployed Convex `stoic-hare-718` before Vercel Production. Deployment `https://marginalia-gan9v8hcs-planetaryescape.vercel.app` is Ready and serves `https://reader.bhekani.com`.
- Ran `readingQueue:initialize` and `readwise:syncNow`. Home shows whole-library totals (108 waiting at inspection); Sources reports active Inbox backfill, progressing from 5 to 10 documents checked with no sync error. Those first items were already imported; this verifies continuation, not completion of the full backfill. Embedding/annotation costs are now enabled.
- Live browser checks verify Home, Sources progress and the article's Define toolbar. Define sends `mode: "define"`, the selected term, paragraph index and 45 article paragraphs. The companion request was intercepted and rejected before reaching a provider or creating a saved thread; live answer quality remains unverified. No uncaught browser errors were reported, and the inspected reader has no horizontal overflow at 390×844.
- The deployed manifest responds with HTTP 200. Rebuilt the local production frontend against the matching backend, restarted it at `http://localhost:3107` and verified HTTP 200. Both builds retain the previously recorded warnings.
- Physical-phone installation, native selection, keyboard, speech and background/resume checks remain outstanding. No Git remote is configured, so commits have not been pushed.

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
