# Deep study is live; comparative quality remains unmeasured

Released through [PR #81](https://github.com/planetaryescape/marginalia/pull/81) from merged source `cec94f5c4f117ee7f5b12ef081cedb8a0d8938e5`. The backend and canonical Vercel frontend are live. A signed-in backend-contract smoke completed a Colossians 2 study and follow-up on the owner’s configured Gemini 3.8 Flash model, persisted two supplemental passages including multiline Psalm text, and resolved them on fresh requests. See [the release record](../releases/2026-10-29-deep-study-quality.md) and [exact evidence](release-2026-10-29.json). Browser click-through and a blinded quality comparison remain unverified.

The pre-release observations below are retained with their original SHAs. Statements that the change was not merged or deployed, or that no live generation had completed, are superseded by the release above. The operator’s rejected general credential and the app’s successful saved key are separate credentials.

## Pre-release implementation evidence

The implementation is committed on local branch `fix/deep-study-quality`. Runtime candidate `7a6d93cac4bfcbc60c08421379743a59a6da919e`, tree `485ba6c2a50fb2abdb9eb06f1bdf646f063991ef`, is based on `origin/main` at `e70e7b07ef1a9c65a37414d59976046e0e98243a`, fetched at 13:43 UTC on 2026-10-29. No push, merge or deployment has occurred. All required local implementation checks are complete; the live quality comparison and authenticated flow remain unverified.

Initial studies now select commentary across the passage’s argument and preserve specific opening, middle and concluding detail within existing budgets. They retain source provenance and existing single-chapter association limits, and reuse already fetched text for precise same-chapter connections. The generation prompts require the passage’s argument and warrants, consequential distinctions, and bounded application without prescribing a Colossians interpretation.

Follow-ups can retrieve up to two canonical WEB references in one optional expansion round, save immutable supplements and inspect those citations after reopening. They retain ownership, policy, lease, cancellation and refresh checks, including recovery after an unsuccessful refresh. Multiline verse text is preserved and validated by ordered verse IDs. Old study rows remain readable.

The [evaluation guide](../../scripts/deep-study/README.md) documents nine public snapshots and explicitly capped paired generation through the production repair helper. It holds evidence fixed to isolate prompt changes. Structural citation validation and reasoning quality are separate; rejected model output is recorded separately from transport failures.

## A clean rebase preserves the task patch

Main advanced with listening and feed-count work during verification. The implementation rebased cleanly onto `e70e7b0`. The [rebase proof](rebase-proof.json) records identical stable task patch IDs before and after. All task paths are byte-identical except `schema.ts`, where upstream feed fields coexist with the same additive follow-up fields. `archive/deep-study-quality-pre-rebase-20261029` retains the historical checked commits. Final integration checks passed at `9b73b31`: 161 backend study tests, 20 web study tests, 6 evaluator safety tests, all three workspace typechecks, strict evaluator TypeScript and the production Next build. [Exact results and environment](final-base-checks.json). The build emits 15 Turbopack warnings about existing `::highlight` CSS selectors; this task does not change that stylesheet. The [independent review](independent-review-6.json) found no blockers on `9b73b31`. The parent applied two small triaged corrections afterward and recorded their complete delta and verification in [review triage](review-triage.md); the verifier did not review that later delta. The final 161 study tests, six evaluator tests and backend typecheck passed on `7a6d93c` ([record](post-review-checks.json)). Web code is unchanged by this delta, so the prior 20 DOM tests, workspace typechecks and production build remain applicable.

## Earlier checks establish operation, with the limits below

| Check | Revision | Observed result |
| --- | --- | --- |
| Source selection and study lifecycle | `7a8e4c0` | 46 tests passed in 10.97 s; [summary](source-lifecycle-tests.txt). |
| Follow-up suite before review corrections | `15ba1a6`; matching follow-up code at `7a8e4c0` | Successful exit in 17.138 s; exact count unavailable after stdout cleanup; [record](follow-up-tests.json). |
| Broad backend suite, serialized with 30 s defaults | `7a8e4c0` | 2,027 passed; one dictionary test hit its explicit 30 s timeout; [output](backend-1046.txt). |
| Matched narrow dictionary controls | Base `dbb89cf` and candidate `7a8e4c0` | Both 12/12 passed, in 40.71 s and 33.47 s respectively. |
| Baseline feed-cleanup control | Base `dbb89cf` | 9/10 passed; the 4,000-row case hit its existing 5 s timeout at 5.318 s. Candidate broad run passed with a 30 s default; that does not prove a default-timeout pass. |
| Broad web suite, serialized with 30 s defaults | `7a8e4c0`; web files unchanged in corrected candidate | 1,484/1,484 passed; [output](web-1062.txt). |
| Production Next build | `7a8e4c0`; web files unchanged in corrected candidate | Passed compilation, TypeScript and page generation with five workers; [output](build-1063.txt). |
| React Doctor on changed lines | `7a8e4c0`; web files unchanged in corrected candidate | Zero errors/warnings; [report](react-doctor.json). |
| Corrected follow-up suite and backend TypeScript | `44cdcb7`; identical follow-up files at `d269ddc` | 53/53 tests passed across five files and typecheck passed; [record](corrected-checks.json). |
| Corrected evaluator safety tests | Working tree committed as `44cdcb7`; evaluator files unchanged at `d269ddc` | 6/6 passed; no provider generation. |
| Strict evaluator TypeScript | `d269ddc` | Passed with backend-compatible ESNext target, ES2024/DOM libraries and installed Node type root. |
| Scoped Biome and diff checks | Working tree committed as `44cdcb7` | All 33 changed TS/TSX files passed; diff has no whitespace errors. |
| Real help route | Built from `7a8e4c0` | HTTP 200 with expected content, opened in Dia; [scope](help-route-smoke.json). This is not an authenticated study-flow check. |

The first broad test run overlapped edits and found 25 timeout failures plus two study regressions; the study regressions were corrected before the above checks. The first parallel web run failed in two companion test files; the serialized full rerun passed. The remaining broad backend timeout is visible rather than silently declared green.

The initial independent review reached its turn limit without a report; [attempt metadata](independent-review-attempt-1.json) records that failure. The [completed Claude Sonnet 5.5 review](independent-review-2.json) found a multiline-publication blocker and three related correctness items. The blocker was reproduced: retrieval and both model calls completed, then publication failed. Commits `06e931b` and `44cdcb7` correct multiline validation, the coverage prompt and evaluation failure labels. The suggestion about straddling commentary was rejected after checking `validPassageAssociation` and `referenceOverlaps`: both already restrict associations to a single chapter. The speculative selector change and failing adapter test were reverted in `d269ddc`; [failed experiment](reverted-source-experiment.txt). This was not a new regression. The corrected follow-up suite passed 53 tests across five files and backend TypeScript passed at `44cdcb7`; those files are identical in `d269ddc`. Independent review completed with no blockers on the rebased candidate; post-review trivial changes are recorded separately. The fourth attempt failed without a report: all capped output went to thinking and the CLI retried four times; [failure metadata](independent-review-attempt-4.json). It is not a green review. A fifth attempt restored a 128,000-token output allowance and removed duplicated unchanged context while retaining the entire diff. It was stopped without a report when the remote base advanced; [attempt metadata](independent-review-attempt-5.json). The sixth attempt targets the rebased `9b73b31` with that corrected configuration. Two standalone script typecheck invocations used the wrong root type lookup/library flags; neither failure was a product diagnostic. The corrected command passed using the backend’s ESNext target, ES2024/DOM libraries and installed Node type root. No review was treated as evidence of better answers.

## Shared queue waits were separate from execution

| Check | Queue wait | Execution |
| --- | --- | --- |
| Broad backend | 468.660 s | 763.392 s |
| Broad web | 292.627 s | 238.637 s |
| Production web build | 291.322 s | 68.754 s |
| Corrected follow-up suite | 141.236 s | 16.592 s |
| Corrected backend typecheck | 147.097 s | 49.783 s |

These are retained agent-work wall times, including command startup, from [job records](verification-jobs.json). Independent checks used the shared queue; none bypassed it. The complete first review took 800.403 s and reported 112,677 thinking tokens. The 32,000-token cap failed because thinking consumed it before a report; the final retry retains max effort and restores 128,000 tokens. That failed attempt took 904.828 s and reported 127,998 thinking tokens across retries. The successful final review took 698.281 s and reported 100,132 thinking tokens. Its configured allowance left room for the report. This session has no complete original implementation-start timestamp in this evidence set, so no total engineering-effort estimate is inferred.

## The paired pilot produced no answers

Both arms of the first Colossians 2 pilot failed dispatch. Read-only checks of the general saved OpenRouter item returned HTTP 401. [Run records](pilot-1/run-2026-10-29T12-31-47.534Z.jsonl) and [credential-check metadata](pilot-1/credential-check.json) contain no key. No quality, latency or billed-cost improvement is established.

The pilot used an operator-selected supported catalog model, not BK’s queried Deep setting. Both arms received identical frozen evidence, so even a successful pair cannot establish whether allocation improved answers. The private ChatGPT conversation was not copied into fixtures or sent to a provider.

## Continue from the exact branch and evidence

All local implementation checks are complete. The final independent report is retained here and found no blockers on `9b73b31`; the recorded post-review delta is covered by the 161-test study rerun, six safety tests and backend typecheck at `7a6d93c`. The 20 web study DOM tests, all workspace typechecks and production build passed on the rebased base before that delta; web code is unchanged afterward. The earlier broad backend run is not a fully passing global test run. The next action requires the pending credential reply below.

BK has a pending question asking for the name of an active OpenRouter 1Password item. After that reply, validate the item through the normal provider key-check endpoint. Identify BK’s actual Deep selection through the authenticated application path and record it before comparing on that model; the operator-selected pilot is not a substitute. Then run the capped pilot command in the evaluation guide on the recorded supported route. Never print or write the key, silently borrow another project’s credential, or treat elapsed time as a reply. Review the resulting blinded answers with reasoning and support scored separately. Then exercise the authenticated passage → study → follow-up → source → reload → stop/refresh flow against a matching backend before release. The existing 45-second follow-up lease remains unchanged; live latency for its optional two-call path is unmeasured.

Computer Use browser tools are unavailable in this session; no fallback browser CLI was authorized. No deployment or authenticated end-to-end proof has occurred. A later authorized release must make the new backend `scriptureStudyFollowUps.sources` query available before serving the updated web client that calls it; verify the actual deployment target rather than assuming that a bare deployment command selects the existing reader backend.

## Resources and handover

The canonical implementation worktree is `/Users/bhekanik/code/planetaryescape/.worktrees/marginalia-pool-1`. The owned preview server has been stopped. Once checks and documentation finish, release the pool with `agent-worktree release`; the branch survives. It may later be reused, so durable references should name the branch and commit rather than assume the pool directory keeps this checkout.

The baseline pool was released after controls finished. Four earlier task-owned temporary implementation/evidence/follow-up/evaluation worktrees were removed after checking no consumers remained and preserving all commits and the pilot output. Their branches remain. The detached review checkout can now be removed after preserving its report and provenance. No other worktrees or jobs were removed.

The dirty main checkout is preserved. Its [canonical plan](/Users/bhekanik/code/planetaryescape/marginalia/plans/deep-study-quality.md) retains the research and acceptance criteria. A copy of this task’s evidence is retained there at handover so it survives pool reuse. Do not switch, reset or clean the main checkout.

## Unresolved questions

- Which active OpenRouter 1Password item should the live comparison use?
- Who will provide the independent passage reading alongside BK for disputed scorecard judgments?
