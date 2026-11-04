# 04: Delivery

Review identity clarification: upstream auth [#100](https://github.com/planetaryescape/marginalia/pull/100) replaced historical [#95](https://github.com/planetaryescape/marginalia/pull/95) at the identical original `bed850d` commit in native [stack #101](https://github.com/planetaryescape/marginalia/stack/101). Original #95 records below retain their historical facts, not current dependency instructions.

The work ships as a stack of small pull requests from `guidefari/marginalia` to `planetaryescape/marginalia`, each one reviewable and deployable on its own.

## Why every PR targets `main`

Guide has read access to the upstream repository, so branches live on the fork. A pull request from a fork can only target a branch in the upstream repository, never another fork branch. A conventional stack (PR 2's base set to PR 1's branch) is therefore impossible. Instead:

- Each branch is cut from the previous branch in the stack.
- Each PR targets upstream `main`, so until its parent merges it shows the parent's commits too.
- Each PR body starts with `Stacked on #<parent>. Review only the commits after <parent's last commit>.` and lists the whole stack.
- Upstream squash-merges (`… (#94)`), so after a parent merges, rebase the child onto `main` and drop the parent's original commits:

```bash
git fetch origin
git rebase --onto origin/main <parent-branch> <child-branch>
git push --force-with-lease fork <child-branch>
```

`<parent-branch>` is the local branch name of the merged parent, which still marks where the child's own commits begin. Then remove the "Stacked on" line from the child's body.

## The stack

| # | Branch | Contents | Schema |
|---|---|---|---|
| Parent | `fix/local-auth-onboarding` | Auth and local setup, upstream PR #95 | none |
| 1 | `feat/epub-parser` | This blueprint and Phase 1: `lib/epub/` parser, unit splitting, fixtures, `fflate` and `@xmldom/xmldom` | none |
| 2 | `feat/epub-import-backend` | Phase 2 backend: `importEpub` action, images to storage, purge paths | `documentImports.format`, new failures, `bookUnits.sourceSpans`, `bookImages` |
| 3 | `feat/epub-import-desk` | Phase 2 UI: picker and drop accept EPUBs and folders, format-aware copy, Ready card | none |
| 4 | `feat/epub-layout` | Phase 3: `bk-*` classes, verse, covers, footnotes (or footnotes split out, Q3) | none |
| 5 | `feat/epub-annotations` | Phase 4: CFI expansion and placement, book endpoints, merge and tombstones | `highlights.source`, `externalAnnotationId`, `unplaced`, tombstone table |
| 6 | `feat/apple-books-cli` | Phase 5: `packages/apple-books` | none |

The first EPUB branch starts from `fix/local-auth-onboarding` (#95) at `bed850d`, as Guide chose in D-EPUB-016. There is no separate blueprint PR (D-EPUB-015). PRs 2 and 5 carry schema changes and need approval before writing them, and BK's approval before any backend deploy.

## Each PR

- Runs `bun run check` and `bun run build`, recording exact-head results and any pre-existing failures. The parser baseline failures below remain historical evidence, not an accepted current waiver; later check cleanup is recorded in [follow-up #102](https://github.com/planetaryescape/marginalia/pull/102).
- Updates the docs its change affects ([01](01-plan.md#documentation-travels-with-the-code)).
- Describes what was verified in the browser, without personal library content.
- Ends with no co-author or tool attribution lines.

## Parser implementation log, 2026-11-04

- Added the pure parser and generated-fixture tests under `packages/backend/convex/lib/epub/`, with exact-pinned `fflate` 0.8.3 and `@xmldom/xmldom` 0.9.12. No schema, API, UI or registered backend function changed. No backend deployed.
- Tested an owner-provided EPUB privately, read-only and without uploading it. Per-book counts, sizes and metadata are omitted from this public log; fixture metadata is synthetic.
- That check found source-range drift when empty anchor blocks preceded text. A generated regression fixture reproduced the failure before the fix. The subsequent private check confirmed source-range and sanitization invariants and an unchanged source file, without retaining per-book statistics here.
- Full root test execution passed all 2,192 backend tests and all 32 vault-indexer tests. The frontend retained the six previously documented base failures: four missing-session-storage cases and two locale-dependent decimal expectations. The first backend run, concurrent with the build, hit two existing five-second test timeouts; the later root run passed them without code or timeout changes.
- All 22 parser tests pass in both the package's edge-runtime test environment and Node. Typechecking passes across all three packages, and changed TypeScript/package files pass Biome. Fixtures cover EPUB 2/3 navigation, structure, link rewriting, image placeholders, exact source ranges, malformed and protected input, and parser budgets.
- `bun run build` passed with existing CSS pseudo-element and Browserslist warnings. `bun run check` stopped at the same eight unrelated formatting errors documented on the auth PR; unrelated files were not reformatted. Reader/browser verification is not claimed: the parser is not connected to the app yet.
- Delivery remains unmerged. Next is the backend import PR, after the proposed schema diff receives approval. Footnote scope and production size/account-storage allowances remain open.

## Review and stack follow-up, 2026-11-04

- Registered the existing local branches with `gh stack init --base main fix/local-auth-onboarding feat/epub-parser`. `gh stack view` now shows #95 below #96, rooted at `main`. This changes local Git metadata, not commit ancestry.
- `gh stack link 95 96` could not register a native GitHub stack: upstream reports that stacked PRs are disabled, and rejects the fork-only auth branch as #96's base. Native GitHub stack UI remains blocked on upstream configuration and branch permissions; the explicit parent boundary above remains necessary. Do not claim local registration fixes the GitHub UI.
