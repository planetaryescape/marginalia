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
