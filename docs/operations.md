# Operations

This app has a Vercel frontend and a separate Convex backend. Deploying one does not deploy the other. Read the access warning before exposing a new installation.

## Access control

Personal Convex queries, mutations, actions and companion/Library/checkpoint HTTP endpoints require a live reader session, and each reader reaches only their own library. Better Auth stores credentials in a local Convex component. The owner's library keeps its `default_user` IDs; `readerAccess` binds access to the owner and deployment issuer, and other readers join through owner-approved invites. Other apps use personal API tokens, which reach only their reader's [API endpoints](api.md). Signing out revokes session access, including through an otherwise unexpired JWT. Vault endpoints still use the separate `VAULT_INDEXER_API_KEY`.

Better Auth rate-limits every auth route at 100 requests a minute per client, with counts stored in the database; password sign-in allows 8 and sign-up 3 a minute (`convex/auth.ts`). `/get-session` and `/convex/token` are exempt because every page load calls them and they only answer for a valid session cookie. Keep that exemption if you change the limits: on those routes each check costs a database read and write. An hourly cron sweeps stale sign-in budgets.

**Authentication is deployed.** The October 12 rollout denies anonymous `home:overview` queries and returns 401 from personal/AI HTTP endpoints. Public signup returns 403. The owner confirmed access to the existing library and enrolled a passkey; the final backup verifies one owner binding and passkey record with the setup token consumed. Passkey sign-in after sign-out and phone/PWA access still need testing. See [rollout verification](verification.md#owner-authentication-rollout).

## Roll out owner authentication

Schedule a short maintenance window with the owner present. Backend-first deployment denies the old frontend's unauthenticated requests until the matching frontend is promoted and the reader is claimed. Do not add a public bypass to avoid that window.

1. Export the intended deployment, including storage. Retain the verified previous frontend and backend source. Verify the CLI deployment before any mutation: the reader currently uses a shared **dev** backend, not Convex production.
2. Provision a random, password-manager-held `BETTER_AUTH_SECRET` of at least 32 characters on Convex. Set `SITE_URL=https://reader.bhekani.com`. Confirm the web deployment's cloud/site URLs match this backend. Never put secrets in `NEXT_PUBLIC_*` variables.
3. Run checks and build the matching frontend. Deploy the backend only after approval, then promote the frontend promptly. `convex codegen` uploads bundles for analysis and generates bindings; the observed live check confirmed it had not activated these auth functions. `convex dev --once` is a live update, not a verification command.
4. Generate a cryptographically random setup token and its lowercase SHA-256 hex digest on the administrator's computer. Keep the token in a private file or password manager, not terminal output, shell history or chat. Issue the digest with a ten-minute expiry through the deployment-admin CLI:

   ```sh
   cd packages/backend
   # SETUP_HASH is the digest; EXPIRES_AT is the expiry in Unix milliseconds.
   bunx convex run access:prepareSetup "{\"hash\":\"$SETUP_HASH\",\"expiresAt\":$EXPIRES_AT}"
   ```

   This is an internal mutation, not a public signup endpoint. Reissuing a token clears an uncompleted reservation; it refuses once an owner exists. The command contains only a hash, never the plaintext token.
5. Open `https://reader.bhekani.com/#setup=<token>` privately. The UI immediately removes the fragment and sends the token in `x-reader-setup`. `#setup=` and `#invite=` fragments are removed on every load, signed in or not; a signed-in reader who opens an invite link is told to sign out first, and the token is never sent. Choose the owner's email and a password of at least 12 characters. Claiming consumes the token transactionally; signup without it remains closed.
6. In **Your account**, add a passkey. Verify sign-out and passkey sign-in before relying on it. Keep the fallback password in a password manager. Sessions persist for up to 30 days and refresh during use. Password attempts have a shared eight-per-minute budget; passkeys remain available if that budget is flooded.
7. Optionally set up authenticator codes. Save the displayed recovery codes **before** verifying: verification may refresh the session and close the panel. Password sign-in then asks for an authenticator or recovery code; passkeys instead require device verification. There is no email provider, magic-link or email password-reset flow. Losing all credentials requires administrator recovery; automatic owner reassignment is not implemented.
8. Verify anonymous backend queries are denied, anonymous companion requests return 401 without provider activity, the owner sees the existing library, and sign-out denies session replay. Then check phone/PWA sign-in and installation on the reader domain.

Passkeys are origin-bound. Development at `localhost:3107` or `localhost:3108` uses separate **localhost** credentials; production credentials do not work there. Raw LAN HTTP addresses and Vercel preview aliases are not trusted auth origins. Use the HTTPS reader domain for phone access. For another installation, set `SITE_URL` to its canonical HTTPS origin.

Open the reader at `https://reader.bhekani.com` before signing in with a passkey. The established `marginalia-drab.vercel.app` alias redirects page URLs to that canonical host, preserving the path and query. API routes, Next assets, paths ending in a file extension and `/.well-known/` requests stay on their requested host. Browser fragments such as `#invite=<token>` and `#setup=<token>` are not sent in the HTTP request; the redirect does not add them to its `Location`, so the browser keeps the fragment for the canonical page to handle.

Include owner/auth component records in backups. Rolling back only the frontend does not remove backend auth; reverting to the previous public backend reopens personal content. Do not clear auth tables or detach the owner as a rollback shortcut.

## Current deployment

**2026-10-29 Deep study quality:** backend `stoic-hare-718` and frontend `dpl_CKLTAKHC65y9HrKHYyyNbrx9KEAM` run merged source `cec94f5` (#81). The live owner-contract study/follow-up and supplemental-source readback passed on Gemini 3.8 Flash. Browser interaction and a blinded quality comparison remain unverified. See [the release](releases/2026-10-29-deep-study-quality.md).

The established reader is **https://reader.bhekani.com**, hosted in Vercel's `planetaryescape` scope. At the time of this documentation pass, its frontend points at the Convex **development** deployment `stoic-hare-718` in `eu-west-1`. Local development has used that same backend.

Treat it as live: `convex dev --once` uploads changes to the real reader's backend, and local mutations affect real notes. Moving to a separate production deployment requires a planned data migration, backup and coordinated web URL change; it is not accomplished by blindly running `convex deploy`.

Verify the actual web environment and Convex dashboard before deploying. This record describes the observed setup, not a guarantee it remains unchanged.

The deployed baseline before Deep Study is commit `82a4a8d5fdcbb990ff37e77600968be7c25971b3` (tree `c5d87315ca85f4ab12b72ea5b973f5a946e5ac9c`): backend `stoic-hare-718` and Vercel frontend deployment `dpl_7DwA9HyVpZpSTREZoYM1N1f3dgbJ`, aliased to the reader domain on 2026-10-26. See the [Scripture margins release](releases/2026-10-26-scripture-margins.md).

**2026-10-29 Listen rung 2, exact feed counts and upload binding:** the backend and the Vercel frontend `dpl_AyB3AmsDnhK5bFfLBagPqT2B6Eeq` both run `e70e7b0` (#76–#79). The snapshot before that backend update is `marginalia-before-release-2026-10-29b.zip`. See [the release](releases/2026-10-29-listen-rung-2-and-fixes.md).

**Earlier on 2026-10-29, kept answers and stale tabs:** the backend and the Vercel frontend `dpl_DXgKAtAteDA41fukDtukd85fDTRN` both ran `25aba24`, which adds kept answers reopening on the selected words (#73) and refusing a stale tab's follow-up (#74). The snapshot before that backend update is `marginalia-before-release-2026-10-29.zip`. See [the release](releases/2026-10-29-kept-answers-and-stale-tabs.md).

**Earlier, 2026-10-28 Listen keyboard controls and voice choice:** the backend and the Vercel frontend `dpl_4qAfVwN5oH1Yc1GaBBqNr3UA8yTb` both ran `6462ce4`, which adds Listen's keyboard and media-key controls (#70) and choosing a Kokoro voice (#71). The snapshot before that backend update is `marginalia-before-voice-choice.zip`. See [the release](releases/2026-10-28-listen-keys-and-voice-choice.md), including the live check still to run.

**Earlier on 2026-10-28, Listen natural voice and follow-ups:** the backend ran `0816ca1` on `stoic-hare-718`. The Vercel frontend `dpl_BXu56huMSRxk9kbSxTgDGogzoZXD` ran `5a3c2bd`, which adds keyboard passage actions and verse-by-verse j/k (#67) to `0816ca1`. That commit adds the always-visible reader bar (#63), reasoning headroom so Explain isn't cut short (#64) and clip requests that no longer trigger the leave-site prompt (#65). The snapshot before #64 is `marginalia-before-explain-headroom.zip` (timestamp `1793192925705630616`). See the [Listen release](releases/2026-10-28-listen-natural-voice.md) for the snapshots, rollback target and what the live smoke did and didn't verify.

Deploy Deep Study backend-first, then the matching frontend. Verify selection → Deep study → evidence → Keep → reopen → ordinary reading and finish in a signed-in reader session. Use a compatible API deep model; the ChatGPT-plan adapter cannot enforce the study output cap. Do not describe component fixtures or automated checks as proof of this live journey.

If a study fails, inspect Convex logs for `scripture_study_failed` before retrying. The event identifies the run, model and failed phase (`setup`, `retrieval`, `generation` or `publication`), with an allowlisted error type, HTTP status and fixed diagnostic signals and parameter names. Nested provider errors are classified internally; their messages, prompts, evidence text, headers and credentials are not logged. An explicit Retry is a new bounded request and may incur provider cost.

Study validates drafts before publication and feeds fixed, finding-specific errors into a bounded correction attempt. The application owns the combined two-dispatch budget; SDK parse retries are disabled inside each individual Study dispatch. Publication still validates independently. A run with no verifiable findings after correction fails with `findings_not_verified`; verified subsets disclose omissions. New run metadata includes `generation` and `contextSummary`, with model-attempt counts, chapter coverage and saved-note counts. Note prose is sent only as untrusted personal context: it is excluded from logs, shared caches, evidence records and metadata responses. This changes the Study policy version, not existing completed results; replay never starts a replacement run. If Retry reports a changed model policy for an older run, reselect the passage and start a new Study; its old result remains in history.

**2026-10-27 Deep study verification:** backend commit `490ad6b26f47270d273e2db27ab6f300f91f74f6` fixes Google's rejection of nested `maxItems` bounds in the Study response grammar. A production-SDK differential reproduced HTTP 400 with the original grammar and succeeded when only `maxItems` was omitted. The Gemini wire adapter omits those bounds while the SDK, generation helper and publication still enforce the full local schema. Other providers and AI tasks are unchanged.

The signed-in Dia journey completed for Psalms 23:4–6: three findings published, Aquifer and WEB evidence expanded, John 10:11 was kept with provenance, and the result reopened without creating another run. The kept passage opened from Saved as ordinary reading and finished successfully. Desktop split view and a narrow full-screen pane retained 24 px body text. The narrow check used a resized desktop browser, not a physical phone. No original Note draft was reloaded or discarded.

The earlier 2026-10-16 release at commit `fae6801` followed a snapshot export and added feed-removal choices, including deleting removed articles from Readwise Reader; its earlier backend update from `bb7790c` stopped broken emoji from stalling imports. Before that, the 2026-10-15 release at `d95edca` moved Vercel functions to `dub1` beside Convex, and the 2026-10-16 backend update from `fbd775e` limited a new feed to its three newest posts from the prior month. The owner's 19 Readwise Reader RSS subscriptions were added directly, importing only posts published after 2026-10-16 01:03. Those releases stopped suggesting read articles, allowed Up next rows to be archived and finished articles to be marked unread, and carried over Reader archives. Earlier releases added personal API tokens and the [API for other apps](api.md), statistics/mobile/auth, the [search rejection and iPhone feedback fixes](verification.md#search-rejections-and-iphone-feedback), the [summary and mobile collision fixes](verification.md#summary-credit-reservation-and-mobile-collisions), and the [docked mobile Ask correction](verification.md#docked-mobile-ask-correction). The shared backend has the matching owner authentication component and retains paced Reader backfill. See [auth rollout verification](verification.md#owner-authentication-rollout). Backfill runs without keeping a browser or local frontend open.

## Deploy

First, select the intended deployment and take a backup using the Convex dashboard/export tools. Then verify locally:

```bash
bun run check
bun run build
git diff --check
```

For a **new installation** with separate production data, configure its Convex production environment and deploy from the backend package:

```bash
cd packages/backend
bunx convex deploy
```

For the **existing reader**, that command targets a different deployment from the one currently used by the web app. Only after verifying the CLI points at `stoic-hare-718` and acknowledging this is a live backend update, use:

```bash
cd packages/backend
bunx convex dev --once
```

Set `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` in Vercel to the chosen backend URLs. Never include backend provider keys in Vercel public variables. From the repository root:

```bash
vercel deploy --prod --yes
vercel ls --scope planetaryescape
```

These commands upload and change the public app. `vercel.json` installs with Bun, builds `apps/web` and serves `apps/web/.next`. `.vercelignore` keeps local caches, dependencies and populated env files out of uploads; inspect inputs with `vercel deploy --dry --format=json` if an upload is unexpectedly large. Turbo's build outputs exclude the running dev server's `.next/dev` cache.

After deploy, verify the reader domain, not just the generated deployment URL:

1. Navigate through every main destination; header, palette and mobile active-route indicator remain stable.
2. Open the desk's search with `/`; arrow navigation, Enter and Escape work.
3. Read an existing article; annotations, settings and source links appear.
4. Check Notes and saved activity without changing real content. Test writes only in isolated fixtures or a separate deployment.
5. Check browser errors, overflow at mobile width and selected light/dark themes.
6. Check `/manifest.webmanifest`, `/sw.js` and install icons; launch from a phone's home screen and confirm the worker's offline fallback. Follow [the PWA verification steps](mobile-and-pwa.md#verify-a-deployed-pwa).

To roll back the frontend, promote the previously verified Vercel deployment using its dashboard. That does **not** roll back Convex code or data. Use a compatible backend version and explicit restore plan; never clear tables as a shortcut.

## Readwise sync

Sources shows connection, progress and last completed sync. The 15-minute cron starts or resumes a single leased job; successful pages schedule their successor after one minute. It checks every page of Inbox, Later and Shortlist, then highlights, then Archive for documents updated since the last sync (skipped on a first import). A failure retains the cursor and bounded current-page checkpoints; **Sync now** retries after the pacing delay. The watermark advances only after all phases finish. Finishing, auto-finishing or archiving a linked article from Up next archives it in Reader; **Mark unread** or **Undo** moves it to Later, not back to where it was. Creating/removing linked highlights changes Reader records.

Deploy the backend before the frontend: the new `define` mode requires matching schema and mutation validators. **Backend deployment automatically enables a full backfill on the next Reader cron, including on previously connected accounts, and can incur embedding/annotation costs.** Obtain approval before updating the shared live backend. Removing `READWISE_TOKEN` pauses sync only for an owner library with no saved token; readers who connected from Sources disconnect there. Neither deletes imports or checkpoints, and already scheduled annotation jobs can still run.

Extracted articles with saved text remain readable in Library Up next and the desk's time choices when annotations are skipped, including `no_provider` and short articles. Missing/empty extractions, finished sources and book containers are excluded from ordinary candidates. Books keep their separate next-part picks. Reading these skipped articles does not start an annotation retry; saving a provider key still starts the existing catch-up.

The desk's counts use `readableQueueStats`, independent of the paged Up next shelf. The 15-minute queue initialization cron runs even without Reader. For deployment and recovery, follow [the counter rollout](#readable-queue-counters-use-an-independent-baseline). Do not manually delete counters or edit queue-affecting article fields in the dashboard; use the article/session mutations so counts stay consistent.

Per-feed outcome counts (`feedStats`: offered, opened, finished, skipped) are derived data. Once a reader's counts are built, each `articleInteractions` insert increments them in the same transaction and sets `feedCounted: true` on the interaction. The marker means "decided", so each interaction is decided exactly once. A desk open and the reader page's first checkpoint for the same article and session (no session is its own key) count as one `opened`: `feedOpenCounts` keeps a desk and a visit count per reader, article and session, and the feed gains one whenever the larger rises, so the result does not depend on row order or on how many opens an article has. A visit's `finished` retried on another day counts once, found by an indexed lookup for an already-marked finish with the same visit. Interactions on deleted articles, and articles without a feed, are not counted. Nothing is written for a library that is disabled or being deleted. The counts are rebuilt, not patched, when the rules change: `feedStats:backfill` (state in `feedStatsBackfill`, versioned by `REBUILD_VERSION` in `feedStats.ts`) clears the reader's `feedStats`, `feedOpenCounts` and markers, then recounts every interaction in creation order, four rows per step. Until it finishes, live interactions are left unmarked for it to count, and a row that lands behind its cursor makes it pass again. Re-running it, running it twice at once or resuming it adds nothing. After a backend deploy that raises the version (including this one), start it for every active reader with `bunx convex run background:fanOut '{"job":"feedStats"}'` from `packages/backend`; a reader's first interaction also starts it. Counts for a reader are zero or partial until their rebuild finishes. Paragraph dwell lands in `paragraphDwell`, one row per reading visit and day, keyed by the displayed paragraph number.

What a reader tends to read (rung 5c) is learned, suggested and spent on in four small pieces, all per reader and none acting without them. `tasteProfiles` holds one row of affinities (feed, author, active tag; each capped at 40) recomputed daily at 03:00 UTC and, after a finish, five minutes later (one queued at a time). It reads recent interactions, loves and ratings, then their articles eight at a time, so it never reads more than a page of article bodies per transaction. `suggestions:forWindow` and `moreForWindow` add a taste term of at most two points (a minute of fit) to articles that fit, so it never lifts a pick past one three minutes closer. A daily job at 04:00 UTC (`preAnnotate`) starts the marginalia of up to five deferred articles by taste, only for readers with a provider key and a profile, and logs them in `preAnnotations` with a control sample it passed over. Compare their open rates with `bunx convex run preAnnotate:preAnnotationReport '{"userId":"default_user"}'` from `packages/backend`; only choices at least three days old count (`minAgeMs` changes that). Feed suggestions are read live from `feedStats` (offered at least 15, opened under 10%); Keep is a `suggestionKeeps` row that lapses after 90 days. Tag merge suggestions (`tagMergeSuggestions`) are recomputed daily at 03:30 UTC from active tags by normalised name, then embeddings (0.90 strong, 0.80 suggested). Accepting one moves the links 50 at a time and turns the removed tag into an alias; Keep both is remembered for good. After a deploy, run each job once with `bunx convex run background:fanOut '{"job":"taste"}'`, then `'{"job":"tagMerge"}'`, then (once taste has finished) `'{"job":"preAnnotate"}'`.

Before testing, choose a disposable article in a separate Reader account if possible. Do not delete real Reader documents to verify cleanup. Inspect Convex logs and `readwiseSyncState` after a failure; provider rate limits use bounded retries. Removing the token stops new integration calls but does not delete imported content.

## Readable queue counters use an independent baseline

After backing up and approving the intended backend deployment, resume every active library with:

```sh
cd packages/backend
bunx convex run background:fanOut '{"job":"queue"}'
```

For one library, use `bunx convex run readingQueue:initialize '{"userId":"<library-id>"}'`. These are writes; no live command is needed to verify a candidate locally. The initializer first completes any legacy count/finish-history scan, then scans the readable queue in pages of at most four sources with a 1,500,000-byte pagination ceiling plus one-document overshoot. Successor pages schedule themselves. A legacy `ready: true` does not skip the new scan. Counts stay unavailable until the new scan completes; article lists and reading work during the scan. This migration schedules no AI jobs and does not reimport or change annotation statuses.

Keep `readingQueueStats` and `queueCounted` unchanged in meaning. They retain the annotated/deferred baseline for compatibility. The new namespace starts at zero. Each source's compact `readableQueueEntries` receipt stores the contribution actually applied and its generation; a registered article trigger updates the receipt and new totals in the same transaction as the source write. Backfill uses that same receipt, so retries, imports behind a cursor, archive/restore, finishes and annotation transitions cannot count a source twice. Receipts avoid an additional full-body patch on each article. Source writes that cannot affect a contribution do not touch the totals. Account deletion purges both new tables.

Deploy the backend first. Existing frontend field names and return shapes remain valid, old suggestion status cursors are accepted, and legacy/metadata pagination cursors remain pinned to their original storage. Skipped suggestions append a fourth status range; clients must keep paging after empty intermediate pages. Reload open suggestion lists after a backend rollback because the older backend cannot parse a new skipped-status cursor.

Prefer a forward fix that retains the new trigger, receipt schema and generation. Rolling back the frontend leaves counts intact. To reverse backend behavior safely, retain the additive tables and writer trigger while reverting the read policy; do not deploy a pre-receipt writer alongside readable counters. If an older backend or a raw administrative write has already changed/deleted sources without updating receipts, first deploy a recovery build that restores the new schema/writer trigger but keeps `home.counts` and `home.overview` on legacy counters. Then run:

```sh
bunx convex run readingQueue:rebuildReadable '{"userId":"<library-id>"}'
```

This approved recovery mutation clears only the derived readable totals, increments their generation and starts a full bounded scan. Previous-generation receipts contribute zero, including receipts for sources deleted by older code. Live source changes during rebuilding use the new generation. Repeating recovery starts another generation safely, but delays readiness. Keep the compatible schema when rolling back code; do not delete receipts, edit their generations, or subtract a newly computed contribution from the old baseline. Complete this rebuild for every affected library and confirm `readableQueueStats.ready` before publishing the readable-counter queries again; then verify the reader's time choices. Old finish history and legacy totals remain available throughout.

Local synthetic coverage:

```sh
agent-work run -- bun run --cwd packages/backend test convex/noProviderReading.test.ts convex/readableQueueMigration.test.ts convex/readableCandidates.test.ts convex/readableQueueBudget.test.ts --maxWorkers=3
```

The fixtures cover the no-key import-to-reader journey, tenant isolation, more than 1,000 existing counted rows, interrupted scans, contribution changes, rollback generations, and native read/write limits. They use no live library, credential or provider requests.

## Catching up after a key is saved

Without a usable key, marginalia are skipped (`annotationStatus: "skipped"`, `skipReason: "no_provider"`) and articles, notes, highlights, Ask threads and impressions are saved without embeddings. Saving a provider key starts a catch-up for that reader's library only (`convex/catchUp.ts`): first embeddings, when the key can embed (OpenAI or OpenRouter), then marginalia for the articles skipped for lack of a key.

- It queues at most 10 jobs per batch, 3 seconds apart, and waits 45 seconds between batches. Each reader may run at most 30 batches an hour (`catchUp` in `limits.ts`); after that it waits ten minutes and tries again.
- One run per library: saving keys again while it runs doesn't start another. Adding an embedding key to a text-only one restarts the scan so the embeddings are included.
- Each item is tried once per run. It stops when nothing is left, or when the reader is disabled or being deleted. Your account → AI providers shows a status line while it runs.
- Articles skipped before skip reasons were recorded aren't included. Open them and use **Re-annotate**.
- `actions/embedReaderActivity:backfill` takes a `userId` and embeds only that library's highlights and threads, for running by hand.

## ChatGPT plan (off by default)

Readers can answer with their ChatGPT plan through Sign in with ChatGPT, but only after OpenAI approves this hosted app. Until then, leave it off. With any of the values below missing, the reader shows no ChatGPT option, `/api/chatgpt/callback` completes nothing (signed-in readers get a 404) and AI requests behave exactly as before.

OpenAI's open-source `dynamic_agent_client` flow needs a `127.0.0.1` loopback callback, so it can't serve a hosted reader and isn't used here. Apply through OpenAI's [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/) to get a hosted client.

After approval, set these on the Convex deployment (not in Vercel):

| Variable | Value |
| --- | --- |
| `CHATGPT_PLAN_ENABLED` | `true` |
| `CHATGPT_CLIENT_ID` | The client ID OpenAI issues |
| `CHATGPT_REDIRECT_URI` | The exact HTTPS callback registered with OpenAI: `https://reader.bhekani.com/api/chatgpt/callback` |
| `CHATGPT_CLIENT_SECRET` | Optional. Only for a confidential client; it's sent by HTTP Basic auth to the token endpoint, never in a request body |

`PROVIDER_KEYS_ENCRYPTION_KEY` must also be set: ChatGPT tokens are sealed with it, bound to the reader. Rotating it means every reader has to connect ChatGPT again.

What readers get:

- **Continue with ChatGPT** in Your account → AI providers. The callback finishes only for the signed-in reader who started it, within ten minutes.
- If they don't allow plan usage (`chatgpt.tokens.use.direct`), the connection is kept but never used for answers; the page offers to ask again.
- Answers, summaries, marginalia and search ranking can use the plan's models. Embeddings, and so Search and Ask your library, still need an OpenAI or OpenRouter key. Web search isn't offered through the plan.
- When the plan's usage limit is reached, or the account isn't eligible, the reader sees that message with a link to [ChatGPT usage](https://chatgpt.com/settings/usage). The request doesn't silently move to their API keys. Network failures and OpenAI outages before the first word still fall back to their next model.
- **Disconnect** revokes the refresh token with OpenAI and deletes the tokens. If OpenAI doesn't confirm, the tokens are deleted anyway and the reader is told to disconnect in ChatGPT Settings too.
- **Deleting an account** revokes that reader's refresh token too, best effort, before the purge removes the connection. It uses the client ID the token was issued to, so it still runs if ChatGPT has since been turned off. A failed revocation never blocks the deletion; after two minutes the purge removes the tokens regardless.

If Convex logs show `invalid_client`, the client ID or secret is wrong; readers' tokens are kept until it's fixed. To turn the feature off again, unset `CHATGPT_PLAN_ENABLED`; saved connections stay in `chatgptConnections` but are ignored.

## Troubleshooting

| Symptom | Check / action |
| --- | --- |
| App fails before loading | Confirm the `.convex.cloud` URL in `apps/web/.env.local`; restart Next after changing it |
| Queries work but AI HTTP calls fail | Confirm the `.convex.site` URL and deployment-side provider key; inspect Convex action logs |
| No annotation output | Check extraction and annotation status; inspect model errors/quota before manually retrying one article |
| Answer stops mid-stream | Retry; do not treat the incomplete answer as finished. Check provider/network logs |
| Note says it was not saved | Keep the editor open, restore connectivity and Retry before navigating away |
| Readwise sync completed but Up next is empty | Confirm extraction has saved text and the article is unfinished. `skipped/no_provider` is readable; deploy the eligibility repair rather than replacing the token or reimporting. If time counts are unavailable, check the readable queue migration and resume its queue job |
| Reader card disconnected | Connect a Readwise token from the Sources page; it's stored encrypted per reader |
| Vault request returns 401 | The local and deployment vault keys must match |
| Vault run exits non-zero | Old file index is preserved for failed replacements; resolve the error and rerun the same vault |
| Route typecheck refers to an old path | `bun run typecheck` regenerates Next route types before checking |
| Passkey sign-in fails on a Vercel alias | Open `https://reader.bhekani.com` and confirm the browser address changed there before signing in. Passkeys are scoped to the current origin; the established alias redirects page URLs before the app requests a credential. |
| `::highlight` build warnings | Known Turbopack CSS parser warning for valid Custom Highlight API selectors; verify the actual marks in the browser |

Logs may contain article titles, URLs and provider error bodies. Do not paste credentials or private passages into public issue reports.
