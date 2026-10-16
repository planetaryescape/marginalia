# Operations

This app has a Vercel frontend and a separate Convex backend. Deploying one does not deploy the other. Read the access warning before exposing a new installation.

## Access control

Personal Convex queries, mutations, actions and companion/Library/checkpoint HTTP endpoints require a live reader session, and each reader reaches only their own library. Better Auth stores credentials in a local Convex component. The owner's library keeps its `default_user` IDs; `readerAccess` binds access to the owner and deployment issuer, and other readers join through owner-approved invites. Other apps use personal API tokens, which reach only their reader's [API endpoints](api.md). Signing out revokes session access, including through an otherwise unexpired JWT. Vault endpoints still use the separate `VAULT_INDEXER_API_KEY`.

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

Include owner/auth component records in backups. Rolling back only the frontend does not remove backend auth; reverting to the previous public backend reopens personal content. Do not clear auth tables or detach the owner as a rollback shortcut.

## Current deployment

The established reader is **https://reader.bhekani.com**, hosted in Vercel's `planetaryescape` scope. At the time of this documentation pass, its frontend points at the Convex **development** deployment `stoic-hare-718` in `eu-west-1`. Local development has used that same backend.

Treat it as live: `convex dev --once` uploads changes to the real reader's backend, and local mutations affect real notes. Moving to a separate production deployment requires a planned data migration, backup and coordinated web URL change; it is not accomplished by blindly running `convex deploy`.

Verify the actual web environment and Convex dashboard before deploying. This record describes the observed setup, not a guarantee it remains unchanged.

The current release is deployed at `https://marginalia-pbe8ane10-planetaryescape.vercel.app` (2026-10-16, commit `fae6801`, backend and frontend, after a snapshot export: removing a feed asks whether to keep its articles, remove the unopened ones or remove all, deleting removed articles from Readwise Reader too; an earlier 2026-10-16 backend update from `bb7790c` stops broken emoji from stalling imports. Before that, 2026-10-15, commit `d95edca`, backend and frontend; Vercel functions now run in `dub1` beside Convex; backend updated 2026-10-16 from `fbd775e` so a newly added feed imports at most its three newest posts from the last month; the owner's 19 Readwise Reader RSS subscriptions were added directly, importing only posts published after 2026-10-16 01:03), aliased to the reader domain, with the backend on `stoic-hare-718` after a snapshot export taken just before. It stops suggesting read articles: reading to the end auto-finishes, Up next rows can be archived, finished articles can be marked unread, and Reader archives carry over. Earlier releases included personal API tokens and the [API for other apps](api.md), the statistics/mobile/auth release, the [search rejection and iPhone feedback fixes](verification.md#search-rejections-and-iphone-feedback), the [summary and mobile collision fixes](verification.md#summary-credit-reservation-and-mobile-collisions), and the [docked mobile Ask correction](verification.md#docked-mobile-ask-correction). The shared backend has the matching owner authentication component and retains paced Reader backfill. See [auth rollout verification](verification.md#owner-authentication-rollout). Backfill runs without keeping a browser or local frontend open.

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
2. Open Home search with `/`; arrow navigation, Enter and Escape work.
3. Read an existing article; annotations, settings and source links appear.
4. Check Notes and saved activity without changing real content. Test writes only in isolated fixtures or a separate deployment.
5. Check browser errors, overflow at mobile width and selected light/dark themes.
6. Check `/manifest.webmanifest`, `/sw.js` and install icons; launch from a phone's home screen and confirm the worker's offline fallback. Follow [the PWA verification steps](mobile-and-pwa.md#verify-a-deployed-pwa).

To roll back the frontend, promote the previously verified Vercel deployment using its dashboard. That does **not** roll back Convex code or data. Use a compatible backend version and explicit restore plan; never clear tables as a shortcut.

## Readwise sync

Sources shows connection, progress and last completed sync. The 15-minute cron starts or resumes a single leased job; successful pages schedule their successor after one minute. It checks every page of Inbox, Later and Shortlist, then highlights, then Archive for documents updated since the last sync (skipped on a first import). A failure retains the cursor and bounded current-page checkpoints; **Sync now** retries after the pacing delay. The watermark advances only after all phases finish. Finishing a linked article archives it in Reader; creating/removing linked highlights changes Reader records.

Deploy the backend before the frontend: the new `define` mode requires matching schema and mutation validators. **Backend deployment automatically enables a full backfill on the next Reader cron, including on previously connected accounts, and can incur embedding/annotation costs.** Obtain approval before updating the shared live backend. Removing `READWISE_TOKEN` pauses further sync steps without deleting imports or checkpoints; already scheduled annotation jobs can still run.

Home totals are maintained transactionally in `readingQueueStats`, independent of the ten-item Up next list. Existing article counts and historical finishes are initialized in bounded, resumable pages by `readingQueue:initialize`; the 15-minute initialization cron runs even without Reader. To initialize immediately after an approved deployment, run `bunx convex run readingQueue:initialize '{}'` from `packages/backend`. This writes derived counts and finish markers, not notes or article bodies. Home displays “Counting your library…” until initialization completes. Do not manually delete counters or edit queue-affecting article fields in the dashboard; use the article/session mutations so counts stay consistent.

Per-feed outcome counts (`feedStats`: offered, opened, finished, skipped) are maintained in the same transaction as each `articleInteractions` insert. A reader's first counted interaction records a cutoff in `feedStatsBackfill`; history created before it is counted in resumable pages of eight by `feedStats:backfill`, and later interactions are counted live, so nothing is counted twice. After the backend deploy, start the backfill for every active reader with `bunx convex run background:fanOut '{"job":"feedStats"}'` from `packages/backend`. It is safe to run again. Interactions on articles that have since been deleted have no feed and are not counted. Paragraph dwell lands in `paragraphDwell`, one row per reading visit and day, keyed by the displayed paragraph number.

Before testing, choose a disposable article in a separate Reader account if possible. Do not delete real Reader documents to verify cleanup. Inspect Convex logs and `readwiseSyncState` after a failure; provider rate limits use bounded retries. Removing the token stops new integration calls but does not delete imported content.

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
| Reader card disconnected | Connect a Readwise token from the Sources page; it's stored encrypted per reader |
| Vault request returns 401 | The local and deployment vault keys must match |
| Vault run exits non-zero | Old file index is preserved for failed replacements; resolve the error and rerun the same vault |
| Route typecheck refers to an old path | `bun run typecheck` regenerates Next route types before checking |
| `::highlight` build warnings | Known Turbopack CSS parser warning for valid Custom Highlight API selectors; verify the actual marks in the browser |

Logs may contain article titles, URLs and provider error bodies. Do not paste credentials or private passages into public issue reports.
