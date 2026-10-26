# Polish-pass verification

This record covers the October 2026 web/backend polish pass. It separates executed checks from work that still needs a product or deployment decision. Entries use the names of their day: the desk was then called Home, and Up next sat on it.

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
- Physical-phone installation, native selection, keyboard, speech and background/resume checks remain outstanding. No Git remote was configured then, so commits had not been pushed.

## Reading statistics, mobile actions and owner authentication

This follow-up is deployed. The checks below describe pre-rollout verification; the [rollout record](#owner-authentication-rollout) records live checks and remaining credential setup.

- `bun run check` passes with **148 tests**: 57 web, 87 backend and 4 indexer. A production build passes with the configured public Convex URLs. Next.js was updated from 16.2.2 to 16.3.8 after the dependency audit flagged security advisories; broader editor/tooling advisories remain outside this change. Known Custom Highlight CSS parser and local workspace-root warnings remain.
- Auth fixtures register the local Better Auth component. They verify one-time owner claiming, closed public signup, password sign-in/sign-out, revoked/expired-session denial, issuer/subject rejection, protected personal writes and paid endpoints, the password-attempt budget, and production/localhost passkey option isolation. TOTP fixtures verify enrollment, no JWT before the second factor, and single-use recovery codes. Real WebAuthn enrollment and user recovery remain unverified.
- Statistics fixtures cover unique annotation opens, more than 200 notes, cumulative legacy-session deduplication, missing historical time, note creation dates and reflection response dates. Checkpoint fixtures cover unfinished time, out-of-order retries, idempotent finishing, session/article validation and Home resume history. Clock/outbox tests cover idle/hidden/suspended time, visible listening, local midnight, timezone/DST report boundaries, late acknowledgements and stale retries.
- Isolated browser fixtures use the actual stats/account components and compiled CSS, with fake Convex data and no personal writes or provider requests. Stats screenshots at 390×844 and 1440×900 and an account screenshot at 390×844 show the new layouts. The mobile stats WCAG A/AA audit reports no violations and one Install control ARIA item needing manual review.
- A 320×568 passage fixture exposes all eight labelled actions without horizontal page overflow. Placement tests cover selections near screen edges and the visible keyboard viewport. Animation-frame/screenshot timeouts prevented a reliable full reader-sheet and Ask-focus check; those paths, native phone selection, safe areas, transitions and real PWA enrollment still need device QA. No live-answer quality or hardware-haptics claim is made.
- Before rollout, a read-only call confirmed `home:overview` was publicly callable and `auth:currentOwner` was absent. Earlier `convex codegen` uploads had not activated the new auth backend. The rollout below replaced that public backend.
- React Doctor reports 45/100 in its changed-file scope: a Better Auth package supply-chain-score flag plus component size/complexity, Intl rendering, effect-fetch and sequential-await warnings. The supply-chain score is not a verified vulnerability; it remains recorded rather than suppressed. Checkpoint sends intentionally run in order, and lifecycle delivery requires an effect. This change does not claim a clean whole-app audit.
- Verification builds changed assets beneath the previously running local server. The last committed release (`c9bab51`) was rebuilt in an isolated temporary source copy and restarted at `http://localhost:3107`; HTTP and sampled static asset checks return 200. Current source changes remain intact and uncommitted.

### Owner authentication rollout

- Deployed after the owner's "deploy everything" approval on October 12. `bun run check` passed with 148 tests; the Vercel production build passed. Changes remained uncommitted; no Git remote was configured then.
- Exported the live backend with file storage before deployment to `marginalia-before-auth.zip`. Provisioned `BETTER_AUTH_SECRET` from a verified 1Password Private item named `Marginalia backend authentication`; set `SITE_URL=https://reader.bhekani.com`. Corrected a trailing newline in Vercel's cloud URL and added its matching site URL.
- Built Vercel Production without switching the reader domain, deployed Convex `stoic-hare-718` with the local Better Auth component, then promoted `https://marginalia-3tfjjl82z-planetaryescape.vercel.app` and explicitly assigned `reader.bhekani.com`. Vercel lists it as Ready / Production. Convex's strict deployment typecheck option stopped because the CLI expects `convex/tsconfig.json`; the project's successful typecheck uses `packages/backend/tsconfig.json`. The normal `--typecheck try` deployment succeeded.
- Live anonymous `home:overview` is denied; `auth:currentOwner` returns null. Engagement, companion, Library and Library-search HTTP endpoints return 401 before payload/provider work. Uninvited signup returns 403. Session lookup returns 200 / null, anonymous JWT issuance returns 401, and passkey options require device verification with `rpId: reader.bhekani.com`.
- Chromium on the reader domain shows passkey and password sign-in. The auth proxy session request and sampled application assets return 200; no uncaught browser errors were reported. A favicon request returns 404; manifest and the 192px install icon return 200.
- Issued a ten-minute setup token through the internal admin mutation. Its private link was saved outside the repository with owner-only permissions and opened in the owner's default browser. No plaintext token or login credentials were printed to chat or command output.
- A second export, `marginalia-after-auth-rollout.zip`, includes 18 Better Auth component files. Both ZIPs pass integrity checks. All original IDs remain present for 359 articles, 5 user notes, 23 highlights, 12 companion threads and 8 sessions.
- The owner confirmed claiming the reader, seeing the existing library and enrolling a passkey. The final export, `marginalia-after-owner-enrollment.zip`, verifies one owner binding, user, account, session and passkey; the setup token is consumed. ZIP integrity and preservation of all original personal-content IDs pass. Auth-rollout backups and the pulled web environment file have owner-only filesystem permissions.
- JWT refresh, session replay after real sign-out, passkey sign-in after sign-out, authenticator enrollment and phone/PWA sign-in remain unverified. No real note/thread write or paid companion call was made for these checks. The old local frontend on port 3107 is not compatible with the newly protected backend; this rollout changes production, not that baseline server.

## Search rejections and iPhone feedback

Both fixes are deployed after approval to https://reader.bhekani.com.

- Reproduced the exact search reason `Not a match for life directly; omitted.` in a failing parser regression: the rejected ID was returned alongside a genuine match. Search now requires an explicit boolean relevance decision, omits false decisions, and vetoes explicit exclusion explanations even when a model incorrectly marks them relevant. The prompt forbids rejected candidates and padding. The public response shape is unchanged; reload an existing tab to clear its five-minute search cache after deployment.
- Parser tests cover the reported wording, exclusion variants, preservation of positive reasons that mention omitted subject matter, missing/malformed relevance decisions and deduplication after rejecting a saved copy. An authenticated HTTP fixture searches `life` through real retrieval and parsing, with embedding/chat provider responses mocked; only the genuine result reaches the response. No live search/model-spend test was performed.
- The prior feedback implementation called only `navigator.vibrate`; iPhone browsers do not expose that API. The user approved a native-switch fallback. WebKit documents switches in Safari 17.4, and its `HTMLInputElement` interface exposes a feature-detectable `switch` property. The fallback performs one synchronous native label activation during a touch gesture; it is hidden from focus/accessibility and removed on cleanup. No haptic library is shipped; Happy DOM is a test-only dependency.
- Feedback tests cover switch activation/reuse/cleanup, standard vibration, disabled haptics, reduced motion, fine pointers, unsupported switches and denied vibration. A rendered React test verifies **Test feedback** fires once despite both pointerup and click, and explains device limitations without claiming a successful physical tap.
- `bun run check` passes with **164 tests**: 66 web, 94 backend and 4 indexer. The production build and `git diff --check` pass. React Doctor retains the previous 45/100 diagnostics and reports no additional feedback-component issue; the Impeccable detector reports none for the changed component.
- An isolated account fixture using current components/CSS was inspected in Chromium at 390×844 and 1440×900. The 44px test button, status copy and focus remain usable, with no observed mobile overflow or uncaught browser errors. Simulated switch/coarse-pointer capabilities verify the hidden switch toggles without taking focus; they do not establish iOS hardware haptics. Actual Safari/PWA feedback remains a user-device test.
- The fixture's WCAG A/AA audit reports zero violations and no incomplete checks. Took `marginalia-before-search-haptics.zip` including storage and auth-component records; ZIP integrity passes and permissions are owner-only. Deployed Convex `stoic-hare-718`; anonymous Home remains denied and anonymous Library search returns 401 before provider work. Promoted Vercel deployment `https://marginalia-h91mf3qea-planetaryescape.vercel.app` and explicitly assigned `reader.bhekani.com`; Vercel lists it as Ready / Production. The task's fixture server and browser were closed. Changes remain uncommitted.

## Summary credit reservation and mobile collisions

These fixes are deployed after approval to https://reader.bhekani.com. Successful live summary generation and native iPhone selection behavior still need the owner's retry.

- The owner's summary retry produced a live `AI_APICallError`: the request reserved up to 65,536 output tokens, exceeding the available credit reservation. The summary action now requests at most 4,096 output tokens. No billing change, credit purchase or extra live model call was made by the agent.
- A failing authenticated Convex regression ran the real summary action, AI SDK and provider request serialization against a mocked credit-reservation error. With the cap, the provider fixture accepts the request, the real parser validates it, and the summary is saved and retrieved. The shared fallback helper forwards the optional cap through its existing retry chain; annotations retain their existing behavior.
- A browser assertion reproduced Ask at y=780–824 overlapping the mobile reading controls at y=787–844. Ask now sits above a shared bottom-clearance value, accounts for keyboard/safe-area space, and hides while notes, annotations, companion panels, listening or sync errors are active. Additional article-bottom padding keeps the footer's Done button accessible.
- Layout checks on the real reader page with fake Convex data pass at 320×568, 390×844, 640×480 and 1440×900. Phone widths have a 16px gap above reading controls, with no horizontal overflow; the footer Done button is uncovered. Expanded Ask retains input focus and stays above a simulated 310px keyboard. These are not physical Safari keyboard/safe-area checks.
- A failing rendered-toolbar test showed touch context-menu events were not prevented. The toolbar now prevents duplicate touch context menus only for selected article-body text, leaving editors, desktop menus, unselected targets and outside content alone. Article-body CSS disables WebKit touch callouts without disabling text selection. Browser checks retain the selected range and show all eight passage actions; a scoped WCAG A/AA toolbar audit reports zero violations or incomplete checks. Safari's native selection menu behavior remains a physical-phone check, not a verified guarantee from Chromium.
- `bun run check` passes with 168 tests (69 web, 95 backend, 4 indexer); the production build and `git diff --check` pass. React Doctor retains its recorded 45/100 diagnostics; the Impeccable detector reports no findings in ArticleAsk or SelectionToolbar. No personal notes, highlights or threads were changed by fixture checks.
- Exported `marginalia-before-reader-repair.zip` with auth records and storage; integrity passes and permissions are owner-only. Deployed Convex `stoic-hare-718`, promoted `https://marginalia-3uh5ck9zx-planetaryescape.vercel.app`, and explicitly assigned `reader.bhekani.com`. Vercel lists it as Ready / Production. Live anonymous Home and summary-action probes remain denied before provider work. The isolated fixture server/browser are closed; changes remain uncommitted.

## Docked mobile Ask correction

The earlier offset fix cleared the reading bar but did not prevent the floating trigger from covering in-page buttons during scrolling. This corrective frontend release is deployed to https://reader.bhekani.com.

- Reproduced the remaining defect by scrolling the footer Done button into the floating Ask trigger's position; browser hit-testing reported that Ask intercepted its center. The prior end-of-page check did not cover this scroll position.
- On phones, Ask now belongs to the four-button reading bar alongside Notes, Listen and Finish. The closed floating trigger is hidden; only the explicitly opened question editor floats above the bar/keyboard. Desktop keeps its existing pill. Earlier whole-article questions remain available from the editor's history button.
- Added controlled-editor tests for docked opening, closing without sending, slash opening and Escape dismissal. Animation is isolated in DOM tests and checked in the browser fixture.
- Real-reader fixtures at 320×568 and 390×844 verify all four controls have at least 44px touch targets, no closed overlay exists, and Done is clickable at the old overlay position while scrolling. Opening, focus, history, closing and simulated keyboard clearance pass without horizontal overflow; the desktop trigger remains visible at 1440×900. No real questions, notes or marks were written.
- `bun run check` passes with 170 tests (71 web, 95 backend, 4 indexer), and the production build passes. This is a frontend-only correction; no Convex rollout, billing change or data migration is required. Physical-phone keyboard behavior remains unverified.
- Promoted `https://marginalia-m5qhcwvpt-planetaryescape.vercel.app` and explicitly assigned `reader.bhekani.com`; Vercel lists it as Ready / Production. Reload an existing reader tab to get the docked trigger. The task's browser and fixture server are closed. Changes remain uncommitted.

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
- A clean source snapshot was checked, not a remote clone: this checkout had no Git remote then.
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
