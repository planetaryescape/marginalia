# Exact active alias assignment: B12 bounded slice

## Outcome and identity

- Base and merge base: `f2be6d6483e932c1977def36ad65ae9c0fd4edf7`.
- Reused worktree: `/Users/bhekanik/code/planetaryescape/.worktrees/marginalia-perf-reader`; branch `perf/exact-alias-tag-reads`. It was clean at the base before edits.
- Exact tested source tree, including the temporary main-owned overlay and excluding this evidence directory: `f7150c109948e5c4cfd8de8130130e06425a5d6c`.
- The final commit/tree identifiers are returned in the worker report. One cumulative implementation commit; no old WIP used.
- **Not deployed; orchestrator owned.** No live/private/provider/Readwise calls, migrations, codegen upload, push, merge, new dependencies, worktrees, servers, keys, or cache target.

This completes the useful all-active exact name/alias slice for at most three proposals, subject to explicit projection/readiness limits. It does **not** complete original B12's candidate/semantic workload. Those paths and lists over three retain the unchanged complete matcher. `tags.assign` itself was not edited: article/publication guards still precede unlink, lookup, counts and writes.

## Main-owned integration packet (required before dependent checks)

`main-overlay.patch` contains only temporary edits to `schema.ts`, `lib/metadataTriggers.ts`, and `account.ts`. They were installed for all reported checks, then removed from the worktree; they are not source changes in the owned implementation commit. It is a zero-context patch (`git apply --unidiff-zero`, or reconcile manually). Apply/reconcile this packet before typechecking the dependent helper:

1. Register `...tagAliasTables` from `lib/tagAliasSchema.ts` in the schema. Tables: `tagAliases`, `tagAliasSources`, `tagAliasState`.
2. Register `syncTagAliases({ ...ctx, db: ctx.innerDb }, change.oldDoc, change.newDoc)` on generic `tags` writes alongside existing vocabulary maintenance. Insert/patch/replace/delete, ownership changes, rename and merge must all retain this atomic wrapper. No tag writer bypass is authorized.
3. In the existing account metadata slot, immediately after vocabulary cleanup and before fingerprints, call `purgeTagAliases`, returning its nonzero result. No new array slot, pagination, or numeric-position change. Keep M02's separate edge-before-vault reconciliation independent.
4. Main exposes two **internal** mutation wrappers in its chosen existing migration module (for example `tags.ts`), with `{ userId: v.string() }` args: one calls `migrateTagAliases(ctx, args.userId)`, the other `verifyAndActivateTagAliases(ctx, args.userId)`. Helpers are implemented and directly tested; wrappers are not in the temporary patch.
5. Main performs real generated API/codegen work before its dependent build/release. No generated files were edited by this worker. Local checks used the existing schema-derived `DataModel` declarations, with the temporary schema installed.

### Additive rollout / readiness

Deploy schema, all generic writer hooks, cleanup and gated reader **first**. Existing vocabulary readiness does not authorize this new alias index. New alias state is always initially unready, including for apparently new/empty libraries; there is no guessed baseline.

Explicitly call `migrateTagAliases` for each retained library until `done`. It reads one canonical row per call (`maximumRowsRead: 1`, `maximumBytesRead: 1,000,000`), maintains an internal cursor, is idempotent after completion, and leaves `ready: false`. Hooks cover canonical mutations before/behind that cursor. Canonical names, colours, vectors and source timestamps are not rewritten.

Then call `verifyAndActivateTagAliases` separately for each retained library. In one snapshot it uses the already-authoritative, ready/non-overflow vector-free vocabulary payloads, restores canonical key/source-creation/ID order, computes the unchanged Map winners and checks alias/direct indexed winners (including source identity) before writing alias readiness. Record successful equality/readiness results for **both actual retained libraries** before claiming optimized live reads. The worker did not access or certify either live library.

Activation limits: one payload pagination, at most 1024 rows, 9,000,000 payload bytes; at most 1024 eligible winner keys and a precomputed 4,000,000-byte winner-row envelope. Overflow, an incomplete page, excess keys or excess cumulative envelope returns false before winner fanout. It does not truncate or claim absence. The 540-tag large-payload fixture passes the actual production helper (8,659,833 bytes).

Do not reset ready projections, destructively rebuild caches, or force `ready` when a gate refuses. Larger/unrepresentable cases remain on legacy reads. Migration and activation must not be combined with another pagination in the same function.

## Invariants / limits

- Last canonical direct duplicate wins globally, even when that winner is a candidate; otherwise first canonical-order exact stored alias wins. No popularity, proposal order, metadata creation time or second alias normalization.
- All proposal winners/statuses are proved using bounded metadata **before any canonical/vector get**. Unknown, candidate, unready, overflow and unsupported proposals return legacy fallback without partial hydration. After hydration, inconsistent owner/status/key/source/actual stored alias throws instead of paying a late whole scan.
- The chosen canonical subset is deduplicated and restored to Convex key/source-creation/ID order when aliases are involved; overlapping aliases therefore retain the original matcher's winner.
- Alias projection: at most 64 distinct eligible aliases per tag, at most 16,384 total eligible UTF-8 alias bytes, 4096 bytes per eligible key/alias/owner. Exceeding those limits marks explicit per-library overflow; no truncated identity. Direct-name behavior remains independently available where its existing vocabulary contract permits it.
- Raw stored aliases longer than 4096 bytes cannot equal an eligible normalized query key of at most 4096 bytes under the matcher's exact equality. Only those provably unequal aliases are omitted. ASCII and multibyte overlong cases are tested.
- No large alias body is added to AVL structure nodes. Count/status/vector-only canonical changes perform no alias projection reads/writes. Ownership/key/alias changes replace at most 64 narrow alias rows atomically. Overflow counts are per-library exceptional metadata, not per-assignment/global counters.
- Purge removes at most 32 alias rows or 32 compact source rows per call, then state; no pagination or retained-library purge. Disabled libraries retain metadata; absent/deleting libraries never gain projections, including after partial cleanup and late writes.

## Observed physical evidence

`exact-alias-release-metrics.jsonl` contains raw transaction metrics with generic writers, current publication guards and AVL amplification installed. Every physical tag still has the original 1536-number embedding and 15.5KB raw alias; the alias variant **adds** three short aliases rather than shrinking the payload.

| Actual assignment phase | Bytes read |
| --- | ---: |
| Existing direct assignment | 411,383 |
| Existing direct unlink/relink | 823,429 |
| Exact alias assignment, native 1,000,000-byte cap | 412,150 |
| Exact alias unlink/relink, same cap | 824,292 |
| Full legacy MAX3/four-proposal fallback | 16,675,391 (unchanged; cap 16,777,216) |
| Alias + unsupported final proposal, no speculative vectors | 16,570,231 |
| Production alias activation, 540-tag fixture | 8,659,833 |

The native-1MB assignment fixture separately validates all 540 canonical-to-alias projections in bounded setup transactions and installs fixture readiness after equality (no concurrent fixture writers). A second native-default-limit fixture runs the **production** same-snapshot activation helper over the same full corpus before assignment. Do not confuse the fixture's cap-specific setup with permission to bypass production activation.

## Checks and inline reviews

Raw terminal logs named below are archived unchanged as `.log.gz` files (read with `gzip -dc`); this preserves original ANSI output and whitespace without adding terminal-format whitespace to text diffs. Metrics remain plain JSONL.

- Backend, four workers: **133 files / 1520 tests passed**, 23.84s (`exact-alias-release-backend.log`). Includes existing tag prompt/missing/AVL/source-creation, assignment, writer and guard tests.
- Additional workspace run: backend rerun passed, web **134 files / 1131 tests passed**, 9.16s; vault **5 files / 32 tests passed** from existing shared Turbo cache. Total task duration 33.33s. Cache provenance is visible in `exact-alias-release-other-tests.log`; it is not a fresh vault execution claim.
- Root typecheck: 3 tasks passed, 14.496s; vault cached. Root lint: exit 0, 701 files, 184ms, one unchanged `summary-panel.tsx` dependency warning. Separate root production build: exit 0, 9.349s, example public Convex URLs only; existing CSS parser/Browserslist warnings retained.
- Targeted physical/quality evaluation: `exact-alias-eval-v2.log`; below five minutes. All builds stayed below three minutes.
- Inline TypeScript review: schema-derived `Doc`/`Id`/contexts; no assertions, `any`, compiler relaxation or widened boundary contract. Existing `compareValues` replaces a draft custom comparator.
- Inline simplifier: reused Convex ordering and existing metadata retention/readiness; deduplicated canonical hydration; kept the existing assignment seam and matcher unchanged. No new framework or unrelated writer refactor.
- Inline test-quality review: forced actual legacy assignment via vocabulary readiness in the same transaction, comparing outputs/full canonical rows/counts/aliases/promotion/link order; independent native byte caps; collision/proposal order/MAX3/prototype/non-BMP/raw aliases/candidate-nearest/semantic fallback/rename-merge-transfer/disabled-deleting/stale-publication/concurrent counts covered. Projection-structure and get-trap tests intentionally constrain the physical-read contract; they are not implementation-independent product tests.
- Anti-slop: one retained test-only `Reflect.get` finding in the read-trapping database Proxy, matching the existing `tagAssignment.test.ts` pattern and preserving arbitrary property/symbol forwarding without casts. Production changes have no reported findings. Three generic `shape` naming findings were fixed. This is a reported mechanical convention conflict, not a clean anti-slop exit claim.
- `git diff --check` passed. No second opinions, reviewers, subagents, review CLI or model changes.

## Corrections / residual risks

- An early test assumed `directalias` would normalize unchanged; legacy singularization removes its final `s`. Corrected the fixture to `directlabel`, and separately retained raw stored-alias mismatch tests. No normalization behavior changed.
- An early readiness design considered scanning canonical vectors; replaced it with the existing authoritative vector-free payload projection and explicit cumulative proof bounds. It now passes the unshrunk 540-tag corpus. Activation still deliberately refuses larger proof envelopes.
- Source tree alone depends on the main-owned schema/hook/account patch. The clean owned commit is a handoff unit, **not** a standalone deployable checkout until that packet and main's wrappers/codegen are integrated.
- No live latency, p95, live migration, retained-private-library equality, frontend release, or full-B12 completion claim. Remaining semantic/candidate costs and the legacy fallback's roughly 101KB headroom remain explicit.
- Existing install/lockfile and worktree were retained. No background process or new external resource remains owned by this worker. Build outputs/shared Turbo cache are ordinary ignored artifacts.
