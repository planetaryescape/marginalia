# Operations

This app has a Vercel frontend and a separate Convex backend. Deploying one does not deploy the other. Read the access warning before exposing a new installation.

## Access control

**There is no login, per-user authorization or model-call rate limit.** Public Convex queries/mutations/actions operate on `default_user`, and the companion/Library HTTP endpoints are public with permissive CORS. Anyone able to call them may access or mutate the shared library or cause provider spend. The vault upload/hash endpoints alone require `VAULT_INDEXER_API_KEY`.

A Vercel-only password, obscure domain or restricted CORS does not protect direct Convex APIs. Before storing sensitive material, enforce identity/ownership on the backend and authenticate the AI endpoints. Until then, remove provider credentials or pause the deployment if access/cost exposure is unacceptable. This polish pass does not claim launch security.

## Current deployment

The established reader is **https://reader.bhekani.com**, hosted in Vercel's `planetaryescape` scope. At the time of this documentation pass, its frontend points at the Convex **development** deployment `stoic-hare-718` in `eu-west-1`. Local development has used that same backend.

Treat it as live: `convex dev --once` uploads changes to the real reader's backend, and local mutations affect real notes. Moving to a separate production deployment requires a planned data migration, backup and coordinated web URL change; it is not accomplished by blindly running `convex deploy`.

Verify the actual web environment and Convex dashboard before deploying. This record describes the observed setup, not a guarantee it remains unchanged.

The Reader backfill/Define release is deployed at `https://marginalia-gan9v8hcs-planetaryescape.vercel.app`, aliased to the reader domain. The shared backend has matching Define validators and active paced backfill; see [deployment verification](verification.md#deployment-verification). Backfill runs without keeping a browser or local frontend open.

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

Sources shows connection, progress and last completed sync. The 15-minute cron starts or resumes a single leased job; successful pages schedule their successor after one minute. It checks every page of Inbox, Later and Shortlist before highlights. A failure retains the cursor and bounded current-page checkpoints; **Sync now** retries after the pacing delay. The watermark advances only after all phases finish. Finishing a linked article archives it in Reader; creating/removing linked highlights changes Reader records.

Deploy the backend before the frontend: the new `define` mode requires matching schema and mutation validators. **Backend deployment automatically enables a full backfill on the next Reader cron, including on previously connected accounts, and can incur embedding/annotation costs.** Obtain approval before updating the shared live backend. Removing `READWISE_TOKEN` pauses further sync steps without deleting imports or checkpoints; already scheduled annotation jobs can still run.

Home totals are maintained transactionally in `readingQueueStats`, independent of the ten-item Up next list. Existing article counts and historical finishes are initialized in bounded, resumable pages by `readingQueue:initialize`; the 15-minute initialization cron runs even without Reader. To initialize immediately after an approved deployment, run `bunx convex run readingQueue:initialize '{}'` from `packages/backend`. This writes derived counts and finish markers, not notes or article bodies. Home displays “Counting your library…” until initialization completes. Do not manually delete counters or edit queue-affecting article fields in the dashboard; use the article/session mutations so counts stay consistent.

Before testing, choose a disposable article in a separate Reader account if possible. Do not delete real Reader documents to verify cleanup. Inspect Convex logs and `readwiseSyncState` after a failure; provider rate limits use bounded retries. Removing the token stops new integration calls but does not delete imported content.

## Troubleshooting

| Symptom | Check / action |
| --- | --- |
| App fails before loading | Confirm the `.convex.cloud` URL in `apps/web/.env.local`; restart Next after changing it |
| Queries work but AI HTTP calls fail | Confirm the `.convex.site` URL and deployment-side provider key; inspect Convex action logs |
| No annotation output | Check extraction and annotation status; inspect model errors/quota before manually retrying one article |
| Answer stops mid-stream | Retry; do not treat the incomplete answer as finished. Check provider/network logs |
| Note says it was not saved | Keep the editor open, restore connectivity and Retry before navigating away |
| Reader card disconnected | Set `READWISE_TOKEN` on the backend, not in web variables |
| Vault request returns 401 | The local and deployment vault keys must match |
| Vault run exits non-zero | Old file index is preserved for failed replacements; resolve the error and rerun the same vault |
| Route typecheck refers to an old path | `bun run typecheck` regenerates Next route types before checking |
| `::highlight` build warnings | Known Turbopack CSS parser warning for valid Custom Highlight API selectors; verify the actual marks in the browser |

Logs may contain article titles, URLs and provider error bodies. Do not paste credentials or private passages into public issue reports.
