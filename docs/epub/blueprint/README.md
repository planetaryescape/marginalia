# Marginalia EPUB books: feature blueprint

> EPUBs become books in Marginalia's existing reader, with their structure and images kept, and a Mac companion CLI brings in DRM-free books from Apple Books together with their highlights and notes.

Planned on 2026-11-04 in one session with Guide, originally contributing from the `guidefari/marginalia` fork and now reviewing through writable upstream branches (D-EPUB-021). BK owns the repository and approves production deploys; the current scoped merge permission is D-EPUB-025. The request was to bring in "support for importing and reading epub books, first thing we want to support is importing from icloud or apple books, almost a lift and shift of what ../epub does", talking through the UX first. `../epub` is Leaf, Guide's separate single-user EPUB reader (foliate-js, Cloudflare D1/R2, Python scripts that read Apple Books' databases). The code was read at origin/main `ca37968`. This blueprint is for a coding agent that never saw the session, so it carries the reasoning as well as the result.

## Reading order

| # | Document | What it covers |
|---|---|---|
| 01 | [Plan](01-plan.md) | Five phases: parser, in-app import, layout fidelity, annotation API and placement, Apple Books CLI; schema changes and risks |
| 02 | [Decisions](02-decisions.md) | Every decision with its attribution and the options rejected |
| 03 | [Open questions](03-open-questions.md) | What to verify in code before building, and what to ask |
| 04 | [Delivery](04-delivery.md) | Native upstream stack #101, incremental reviews and verification history |
| K | [Kickoff](KICKOFF.md) | The prompt for the first build session |

Related: the design blueprint ([../../design/blueprint/README.md](../../design/blueprint/README.md)), whose concept and design gate this feature works inside; `apps/web/DESIGN.md` for shipped patterns; and Leaf's `README.md`, `PROVENANCE.md` and `scripts/import-annotations.py` in the sibling `../epub` checkout, which hold the Apple Books knowledge being ported.

## Summary

- **Shape:** EPUB is a second format in the PDF book pipeline (`documentImports`, `bookUnits`, `books`, `ImportSlot`), not a second reader (D-EPUB-001, D-EPUB-002).
- **Fidelity:** keep structure, images and meaningful CSS; leave fonts and colours to the reader's themes (D-EPUB-003, D-EPUB-004).
- **Apple Books:** a local, read-only CLI in `packages/apple-books`, like `packages/vault-indexer`, calling new token endpoints (D-EPUB-006).
- **Highlights are first-class:** CFIs resolve to unit and paragraph, are checked against the quote, and fall back to unplaced rather than a wrong mark (D-EPUB-008, D-EPUB-009).
- **Merge:** one-way and idempotent; Marginalia edits win and deletions stick (D-EPUB-010).
- **Order:** parser, in-app import, layout, annotation API, CLI (D-EPUB-012), shipped as stacked pull requests (D-EPUB-013).

## Build status

Parser PR #98 includes this blueprint and the pure parser, stacked on upstream auth PR #100 (D-EPUB-015, D-EPUB-016, D-EPUB-021). There is no separate docs PR. Guide approved Apple purple to `cobalt` (D-EPUB-017), but `cobalt` is valid only for underlines; purple highlights still need a compatible mapping decision (D-EPUB-023). Footnote PR scope remains open.

`feat/epub-import-backend` implements the approved schema, format selection, book publication and image ownership/cleanup (D-EPUB-018). `feat/epub-desk-import` adds the PDF/EPUB picker, drop target and format-aware progress, failures and ready display. With Guide's approval, the backend is deployed only to isolated development deployment `diligent-owl-394`; [Delivery](04-delivery.md) records those completed updates. Native production scheduling/storage races and successful signed-in EPUB import/reading are not established by local tests. The local web server at `https://marginalia.localhost` connects to that configured backend; this is the web origin, not the backend address. Production is unchanged. Layout work, token endpoints and the Apple Books CLI remain outstanding. The newly approved optional `bookPartCards.format` field is local schema/code work only, not a deployed update (D-EPUB-026).

Feature reviews now use verified native upstream [stack #101](https://github.com/planetaryescape/marginalia/stack/101): auth #100 → parser #98 → backend #99 → cleanup #102 → desk #103, followed by the current fixes. D-EPUB-021 supersedes the temporary fork arrangement. Auth #100 originally matched replaced #95; historical discussion and pending review findings remain source-linked. Guide authorized scoped fixes/restacks and merging this stack once bots are satisfied, without waiting for every PR CI run (D-EPUB-025); that permission is not a completed merge or thread-resolution claim.

The diagnostic follow-up (D-EPUB-020) splits oversized lists at item boundaries without raising limits, retains specific refusal details and verified title/author, and previews metadata before upload. Guide separately approved the isolated development update after full validation; production remains outside that approval. Current verification/deployment evidence is recorded in [Delivery](04-delivery.md).

## Rules for coding agents

1. **Behaviour stays.** Existing PDFs, articles, highlights and notes must behave exactly as before. A widened shared component (the PDF picker, `ImportSlot`, `documentImports`) keeps its PDF tests passing unchanged.
2. **Schema is additive and approved.** Optional fields, widened unions and new tables only. Show Guide each change before writing it and never deploy a backend change yourself: BK approves backend deploys per `docs/operations.md`, with Guide's approval recorded per named target. The isolated development approval above is not production permission.
3. **Work inside the design concept.** Read `docs/design/blueprint/02-design-concept.md` and `apps/web/DESIGN.md`. Reuse `ImportSlot`, `InlineError`, `SavedMark` and the settings controls; check new screens in all six themes at desktop and phone widths.
4. **Keep personal content out.** The repo is public. No real books, Apple Books databases, highlights, notes or screenshots of a library in commits or PR bodies. Fixtures are built in tests.
5. **Read Apple Books read-only.** Never open its databases for writing and never write back to Books.
6. **Update the decision log.** Change a decision only by adding a new entry to [02](02-decisions.md) that replaces it.
7. **House rules.** Bun only. Normally run `bun run check` before every commit. During the overloaded-host exception approved in D-EPUB-022, publish only with explicit validation status, use isolated CI plus the quiet-window watcher, and hold the approved dev update until full validation succeeds. Commits use `type(scope): description` with Guide as the only author and no co-author lines. No explanatory comments in code unless something is truly non-obvious.
