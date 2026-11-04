# 04: Delivery

Review identity clarification: upstream auth [#100](https://github.com/planetaryescape/marginalia/pull/100) replaced historical [#95](https://github.com/planetaryescape/marginalia/pull/95) at the identical original `bed850d` commit in native [stack #101](https://github.com/planetaryescape/marginalia/stack/101). Original #95 records below retain their historical facts, not current dependency instructions.

At this slice, feature review moved to `guidefari/marginalia` with incremental parent-branch diffs and a proposed later upstream integration PR (D-EPUB-019). This historical arrangement was superseded by native upstream [stack #101](https://github.com/planetaryescape/marginalia/stack/101), recorded in [later follow-up #106](https://github.com/planetaryescape/marginalia/pull/106); do not use the integration proposal as current instructions.

## Historical fork review chain

At this slice Guide had read access upstream and owned the fork. The original upstream #96/#97 targeted `main`, exposing cumulative diffs. D-EPUB-019 introduced the fork chain below; later upstream admin access and native registration superseded it.

- Upstream auth [#95](https://github.com/planetaryescape/marginalia/pull/95) remains unchanged.
- Fork parser [#1](https://github.com/guidefari/marginalia/pull/1) targets `fix/local-auth-onboarding`, excluding auth from its diff.
- Fork backend [#2](https://github.com/guidefari/marginalia/pull/2) targets `feat/epub-parser`, excluding parser/auth from its diff.
- `fix/green-checks` targets `feat/epub-import-backend`; later feature branches continue from the reviewed tip.
- Native fork stack #3 was created with `gh stack link --remote fork --base fix/local-auth-onboarding` using the fork PR URLs. Keep that explicit repository/remote selection when managing fork reviews.
- Cross-link replacements before closing upstream #96/#97. Preserve their historical comments and carry pending suggestions into the owning fork review; closing a duplicate does not resolve its findings.
- Under this historical fork integration proposal, auth #95 must merge and every descendant must be explicitly rebased before opening an upstream integration PR, so inherited auth commits are not replayed. #95 has since been replaced by #100 and the proposal superseded by native upstream [stack #101](https://github.com/planetaryescape/marginalia/stack/101), recorded in [later follow-up #106](https://github.com/planetaryescape/marginalia/pull/106). Current work follows that native parent-branch chain, not a cumulative integration PR. Neither review registration nor this historical plan authorizes merging or deployment.

The earlier upstream attempt failed because stacks were disabled and parent branches existed only in the fork. Later upstream registration is evidenced by [#106](https://github.com/planetaryescape/marginalia/pull/106) and the native stacks API, not inferred from fork registration.

## Historical stack proposal

This table records the original #95-based proposal, not the current review chain. Follow upstream auth #100 and native stack #101 in [later follow-up #106](https://github.com/planetaryescape/marginalia/pull/106).

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

Guide approved the backend import additions for local implementation in D-EPUB-018. `feat/epub-import-backend` starts from parser PR #96 at `4d3d0f9`. That approval does not authorize deploying the backend, running migrations, or implementing the later annotation schema.

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

## Backend import implementation log, 2026-11-04

- Implemented the schema approved in D-EPUB-018, optional upload/start format selection, and `actions/importEpub.ts`. Omitted format stays on the PDF path. Upload admission and start independently apply the existing 32 MiB parser ZIP ceiling to EPUBs, preserving the 60 MiB PDF ceiling. EPUBs publish as books with normalized source spans and no fabricated page count. The original upload is removed after publication.
- Added guarded image ownership, post-replacement content/argument byte checks, and one-unit write batches. The sweeper preserves registered image storage even after the import row is dismissed. Failure, expiry, article deletion and account deletion drain image records and blobs in bounded batches; account purge step numbers are unchanged.
- Raster checks reject unsupported, signature-only and clearly truncated resources. Generated valid PNG, JPEG, GIF and WebP fixtures cover the supported paths, including animated WebP. These are structural checks, not a full decoder or a compressed-data/dimension security guarantee. Missing images, unsupported formats and images whose bytes fail raster validation become escaped alt text. A `bookImages.register` refusal instead fails and discards the import.
- Review correction: the reviewed #99 head `f001359` discarded the book on registration refusal but left the import row `reading`. The current head fails the import as `unreadable` before discarding the book (`actions/importEpub.ts`); the earlier verification did not cover that path. The added action/mutation regression verifies both the terminal failure and owned-resource cleanup.
- The PDF-only desk now excludes EPUB imports from its status and auto-open logic and handles the widened failure union without a narrowing assertion. This is compatibility work, not the EPUB picker/drop UI. Its component tests use real providers and in-memory Convex fixtures, with an exact-pinned test dependency.
- Terra audited cleanup/test seams; Sol implemented the lifecycle and separately reviewed ownership and cleanup. The review found truncated raster acceptance and a deletion-fence test that started too late. Both were corrected; the follow-up review found no concrete regression. Each late publication write is now tested independently after deletion begins during a pending import.
- Privately exercised an owned book through upload grants, the import action and publication in in-memory Convex test/storage only. Registered images survived dismissal and a later sweep; source-range and storage-budget invariants held and the original was unchanged. Per-book statistics are omitted. No book bytes, metadata or annotations were uploaded to a cloud service or added to fixtures; the ephemeral smoke harness stays outside the repository.
- The package test run with `--maxWorkers=3` passed all 2,232 backend tests and 32 vault-indexer tests. The final backend-only run after adding admission-limit coverage passed all 2,238 tests. The frontend passed 1,685 tests and retained its six known base failures: four missing-session-storage cases and two locale-dependent decimal assertions. The first default-worker run hit five timeouts in existing reporting/tag-budget tests; limiting worker concurrency passed them without changing code or timeouts. All 28 Deep Study script tests passed separately.
- Typechecking passed across all three packages; changed-file Biome checks passed. The build passed with the existing 15 CSS parser warnings and Browserslist warning. `bun run check` still stops at the same eight unrelated formatting errors. No unrelated files were reformatted.
- At this slice the backend work was local and undeployed; it is not deployed to production. The separately approved isolated development update is recorded in [later follow-up #103](https://github.com/planetaryescape/marginalia/pull/103). Native production scheduling/storage races and successful signed-in EPUB reading are not established by these tests. Token endpoints, Apple Books placement/CLI, layout and production allowances remain later work.

## Check cleanup and fork review migration, 2026-11-04

- Guide approved fixing baseline checks and six frontend failures in a separate slice above backend import. Historical JSON evidence stays byte-for-byte unchanged and is excluded from formatting to keep unrelated artifacts out of the review diff. The settings formatting preserves emitted TypeScript behavior. Companion session tests now select a real browser test environment; number-format tests use an explicit worker locale. Production locale behavior is unchanged.
- The root test command now runs package suites one at a time, with at most three workers per web/backend suite. Running those suites together still caused existing resource-heavy fixtures to exceed their unchanged five-second deadlines. No assertions were weakened, tests skipped or timeouts increased.
- The ordinary `bun run check` passed: lint had no errors, all workspace typechecks passed, and all 2,238 backend, 1,691 web, 32 indexer and 28 script tests passed. Five non-blocking lint warnings and one informational lint finding remain; the build also passed with its existing CSS/Browserslist warnings.
- Fork parser #1 and backend #2 now have parent-branch bases and native GitHub stack #3. Ten untriaged parser suggestions and six backend suggestions from upstream #97 were copied into source-linked comments on their owning fork PRs. This migration does not claim to have fixed or resolved those suggestions. The old kickoff baseline-check suggestion is superseded by this green check run; the requirement to run the full check remains.

## Desk import and local testing, 2026-11-04

- Added PDF/EPUB selection and mixed-file drop handling, with 60 MiB PDF and 32 MiB EPUB limits. Admission, storage content types and import start use the selected format. Upload grants bind the user, creation time, SHA-256 and size, with usage state; they do not persist format. EPUB progress describes chapters, ready cards show parts rather than pages, and failures use EPUB-specific copy. Automatic opening targets the returned import ID, not an unrelated background import.
- `bun run check` passed with 2,238 backend, 1,718 frontend, 32 indexer and 28 script tests; `bun run build` passed with existing warnings. Generated fixtures and real component/provider seams cover selection, admission, upload failures, visible states and import-ID targeting. Independent source review found no additional code defects within those seams, not a complete signed-in import proof. A subsequent signed-in import exposed a long-list/parser refusal, owned by follow-up [#105](https://github.com/planetaryescape/marginalia/pull/105) and recorded below. Full Desk/hook coordination and overlapping selections remain unverified. No private EPUB was uploaded by the automated checks.
- Guide explicitly approved updating isolated development deployment `diligent-owl-394`. `convex dev --once` succeeded there, including the approved image indexes. The existing local web server serves `https://marginalia.localhost`; browser loading and its configured auth origin were verified. A successful signed-in browser import, chapter navigation and fragment restoration still need verification after the long-list fix. Production was not targeted.
