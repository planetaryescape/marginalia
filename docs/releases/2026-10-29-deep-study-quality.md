# Deep study retains passage detail and follow-up evidence

Released 2026-10-29 to https://reader.bhekani.com through [PR #81](https://github.com/planetaryescape/marginalia/pull/81). Backend `stoic-hare-718` and Vercel production deployment `dpl_CKLTAKHC65y9HrKHYyyNbrx9KEAM` were deployed from merged main `cec94f5c4f117ee7f5b12ef081cedb8a0d8938e5` (tree `b5d4021a63c698898140c55b18f4a114ef4556fa`). The GitHub PR diff was applied to its base in a temporary index; its tree matches both the shipping candidate and merged commit.

New studies require a connected account of the passage’s argument, consequential distinctions and bounded application. Source selection retains broad context and specific detail, with commentary preserved when only one source slot remains. Follow-ups can retrieve up to two missing WEB references in one expansion round and keep immutable citations that resolve after reopening. Existing studies remain readable; start a new study to use the revised policy. No saved study is regenerated automatically.

## The live owner-contract smoke passed on Gemini

The authenticated Convex public contracts were exercised through the deployment CLI using the owner’s existing live session. No session was created or revoked, no model setting changed and no provider key exported. This verifies backend contracts; it is not a browser click-through.

- A new public WEB Colossians 2 source was created for this smoke. The 2:20–23 study completed on `openrouter:google/gemini-3.8-flash` in one generation attempt, with teaching present and no omitted findings. Its context covered the complete chapter and included zero private reader notes.
- A follow-up retrieved Galatians 5:13–16 and Psalm 13:1. Both sources were persisted and resolved through the evidence query; Psalm 13:1 retained three text lines. Fresh requests preserved the published run and the same supplement metadata.
- The complete contract smoke took 53.325 seconds including CLI calls and readback. This is not a per-model latency or billing measurement.
- The canonical homepage, Deep study help and manifest returned HTTP 200. `/api/auth/get-session` returned null for an anonymous request. The new supplement query denied an anonymous request with the sign-in error.
- The Vercel runtime error/fatal log query returned no groups for this deployment since promotion at 17:35:12 UTC, checked at 17:46:57 UTC. Deployment metadata identifies the merged source SHA and the canonical alias points at this deployment.

[Deployment and smoke evidence](../deep-study-evidence/release-2026-10-29.json) records the exact identifiers and policy revisions. [Open the Colossians 2 source](https://reader.bhekani.com/read/jd7363wg9cg2tc9gybfyvd67ss8h65t3); its completed 2:20–23 study is in Saved deep studies.

## Browser interaction and comparative quality remain unverified

Computer Use was unavailable. Approval to use agent-browser is pending, so no browser tool was substituted. The live site was opened in Dia. Selecting text, clicking citations, reloading the UI and stop/refresh interactions remain unchecked on the deployed frontend; focused DOM/lifecycle tests passed before release.

The live provider accepted the revised request schemas and produced a study and follow-up using the owner’s saved key. The separate operator-run baseline comparison remains unrun because its general 1Password credential returned HTTP 401. One successful live example does not establish a comparative quality gain or settle disputed interpretation.

## Rollback preserves completed evidence

The prior frontend is `dpl_AyB3AmsDnhK5bFfLBagPqT2B6Eeq`. The owner-only ZIP-validated snapshot `marginalia-before-deep-study-20261029T172535Z.zip` contains file storage, owner access and Better Auth component data; it is stored outside the repository.

A frontend rollback can promote the previous deployment. Prefer a backend forward fix and retain the new optional follow-up fields: completed rows now contain supplements, so deploying an old schema unchanged can fail validation. Do not restore the whole database merely to remove this release’s test study or discard subsequent reader work.

There are no repository GitHub Actions or release-please configuration files. Local verification and independent review are recorded in [the implementation handover](../deep-study-evidence/verification.md); the PR’s external CodeRabbit check was cancelled on merge, and Cubic was neutral. No CI pass is inferred from those results.
