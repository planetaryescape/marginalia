# 04: Delivery

Review identity clarification: upstream auth [#100](https://github.com/planetaryescape/marginalia/pull/100) replaced historical [#95](https://github.com/planetaryescape/marginalia/pull/95) at the identical original `bed850d` commit in native [stack #101](https://github.com/planetaryescape/marginalia/stack/101). Original #95 records below retain their historical facts, not current dependency instructions.

Review happens in native upstream [stack #101](https://github.com/planetaryescape/marginalia/stack/101), with incremental diffs and upstream branch heads (D-EPUB-021). This supersedes the temporary fork-review and single-integration-PR arrangement in D-EPUB-019.

## Native upstream review chain

Guide now has upstream admin access. Native stacks require non-fork heads, so the relevant branches were published upstream without changing their commit ancestry:

- Auth [#100](https://github.com/planetaryescape/marginalia/pull/100) targets `main` at the same `bed850d` commit as replaced #95. Guide explicitly approved the replacement required by GitHub's fork-head restriction; its original discussion and evidence stay available.
- Parser [#98](https://github.com/planetaryescape/marginalia/pull/98) targets `fix/local-auth-onboarding`, excluding auth from its diff.
- Backend [#99](https://github.com/planetaryescape/marginalia/pull/99) targets `feat/epub-parser`.
- Cleanup [#102](https://github.com/planetaryescape/marginalia/pull/102) targets `feat/epub-import-backend`; desk [#103](https://github.com/planetaryescape/marginalia/pull/103) targets `fix/green-checks`.
- Register and extend the native stack with explicit upstream selection, for example `GH_REPO=planetaryescape/marginalia gh stack link --remote origin 101 <new-PR-URL>`.
- Later branches continue from the reviewed tip. Test-fixture throughput, list splitting, backend diagnostics and metadata-first UI remain separate atomic slices.
- Replaced fork #1/#2/#4/#5 and upstream #95/#96/#97 retain their history. Pending parser/backend findings are source-linked on #98/#99; replacing a review never resolves its findings.
- Native registration alone does not authorize merging or deployment. Preserve pending review findings. If a parent merges, explicitly restack descendants rather than replaying parent commits or force-pushing implicitly; any rewrite needs its own scoped approval.

The earlier upstream attempt lacked admin access, usable upstream parent branches and non-fork PR heads. The successful #101 registration was verified through the upstream stacks API, not inferred from branch links or the old fork stack.

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

The original proposal started the first EPUB branch from `fix/local-auth-onboarding` (#95) at `bed850d`, as Guide chose in D-EPUB-016. There is no separate blueprint PR (D-EPUB-015). D-EPUB-021 records the later replacement with upstream #100 and native stack #101. The backend and annotation slices carry schema changes requiring approval before implementation; BK approves backend deploys, with Guide's approval recorded per named target. Neither stack registration nor local schema approval authorizes a deployment or migration.

Guide approved local backend import implementation in D-EPUB-018. `feat/epub-import-backend` builds on parser #98, replacing #96 and fork #1. This does not authorize deployments, migrations or the later annotation schema. Native upstream review replaces the obsolete cumulative integration-PR proposal.

## Each PR

- Runs `bun run check` and `bun run build`, recording the local commit or CI checkout ref and any pre-existing failures. PR CI checks merge refs; its associated head SHA is not itself checkout proof. The parser baseline failures below remain historical evidence, not an accepted current waiver; later check cleanup is recorded in [follow-up #102](https://github.com/planetaryescape/marginalia/pull/102).
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

## Timeout follow-up boundary

The historical reduced-worker passing runs above are not the final timeout resolution. Fixture/projection improvements belong to this slice; bounded alias validation and the quadratic context matcher fix are recorded in [later #108 follow-up evidence](https://github.com/planetaryescape/marginalia/pull/108). No deadlines, row counts, payloads or budget assertions were waived. Do not infer a pass for a later restacked head from an earlier run.

## Diagnostic and metadata follow-up, 2026-11-04

- A different private EPUB failed after upload because a 14,208-word ordered list exceeded the 4,000-word indivisible-block ceiling. Its archive was only 679,619 bytes. The new parser splits lists at item boundaries, preserves numbering/anchors/source offsets and keeps oversized individual items refused. Read-only local parsing now produces 81 units within the original word/byte ceilings, with exact source ranges. The previously tested book still produces 45 units with exact ranges. Both originals are unchanged; neither was re-uploaded for this work.
- Expected refusals now carry stage/code, observed value/limit and optional spine/block indexes. The import mutation retains the diagnostic and emits one safe structured refusal/failure event with the existing import ID as reference; successful publication emits an aggregate completion event. Unexpected exceptions retain a finite class and current stage, never arbitrary error text. Generated fixtures cover ownership, expiry/deletion fencing and diagnostic privacy. Native delivery of the new log records remains unverified until a separately approved development deployment.
- The browser reads bounded ZIP metadata only for a title/author preview; the server independently verifies and retains metadata even if later parsing fails. Chromium extracted the private book's metadata locally and passed XML declaration/BOM variants. Happy DOM's single-quoted declaration limitation is not treated as product behavior or an accepted failing baseline. No private metadata or browser harness is committed.
- Review slices remain incremental: desk picker/drop, list splitting, backend diagnostics, metadata-first UI. No new schema deployment, production update or merge is authorized by the local implementation approval.

## Fixture throughput, isolated validation and upstream stack, 2026-11-04

- Reporting boundary/Linger fixtures now seed the same canonical records with production projections rather than repeating emulator trigger lookups. All 4,097 boundary rows and activation/deletion assertions remain. Tagging retains all 540 full source payloads; separate tests cover production vocabulary/alias migration, vector migration and paged proof, while assignment stress uses valid projected state. No test deadlines, payload sizes or budget assertions changed.
- The old schema also reproduced the timeouts. Host load reached 83; subsequent measurements ranged from sub-second reporting proofs to 10–23 seconds under contention. Guide requested a quiet-window watcher and isolated CI rather than pausing other work (D-EPUB-022). The watcher successfully ran the ordinary check and build during a quiet window, but rejected its final source capture because documentation changed during verification. Subsequent pre-commit checks passed against the stable working tree: 2,262 backend, 1,781 web, 32 indexer and 28 script tests. Existing non-blocking warnings remain; no failed baseline is waived.
- Native upstream stack #101 now contains auth #100, parser #98, backend #99, cleanup #102 and desk #103, followed by the fixture/CI and EPUB follow-ups. Source review history and the 16 carried-forward suggestions remain linked; none was marked resolved by the move. Auth #95 was explicitly replaced at the identical commit because GitHub forbids fork-headed PRs in native stacks.
- GitHub Actions checks actual PR heads with pinned Node/Bun/actions, frozen installation, the ordinary check and build, placeholder public Convex URLs and no deployment secrets. Guide approved the isolated `diligent-owl-394` update after full validation and commits, with the private retry left to Guide. No merge or production update is authorized.
