# Listen speed and Follow, exact feed counts, and safer uploads

Released 2026-10-29 to https://reader.bhekani.com. The backend runs `e70e7b0` on `dev:stoic-hare-718`, deployed at 17:14. The frontend runs Vercel deployment `dpl_AyB3AmsDnhK5bFfLBagPqT2B6Eeq`, built from `e70e7b0`.

## What changed for readers

- **Listen rung 2 (#78).** Speed from 0.8× to 2× (the pill's speed button and a slider in Settings › Listen). Follow: the page follows the voice until you move it, and Follow in the pill brings it back. The lock screen shows the article's image when the page has loaded one. On phones the pill keeps every control in reach. Decision D-TTS-029, for BK to confirm. See [the Listen roadmap](../listen/blueprint/06-roadmap.md).
- **Feed counts (#79).** Opens and finishes per feed are counted exactly, with no 200-row window, and every reader's counts were rebuilt from history.
- **PDF uploads (#77).** An upload grant is bound to the file's SHA-256 and size, so a storage ID alone can't claim someone else's upload. A cancelled upload no longer leaves the import panel stuck.
- **Kept answers and lookups (#76).** "bass," and "bass." in one sentence stay two lookups; old copies of answers with code-like text are recognised again.

## Rollback

- The snapshot before the backend update is `marginalia-before-release-2026-10-29b.zip` (46.9 MB, with file storage and auth components, owner-only, ZIP-validated).
- The schema adds the `feedOpenCounts` table, two `articleInteractions` indexes and optional fields on `feedStatsBackfill` and `uploadGrants`. Reverting the code leaves them unused; no restore is needed unless the counts must go back to the old numbers.
- The previous frontend is `dpl_DXgKAtAteDA41fukDtukd85fDTRN` (`25aba24`).

## Live checks

- Deploy added `articleInteractions.by_user_article_action_visit_counted` and `feedOpenCounts.by_key`.
- `bunx convex run background:fanOut '{"job":"feedStats"}'` ran at 17:15. Both readers' rebuilds reached `ready` at version 2; the owner's finished at 17:16:02. The rebuilt totals equal the snapshot's: 4 feed rows, 21 opened, 3 finished, 1 offered.
- `documentImports:generateUploadUrl` takes the file's hash on the live deployment.
- The reader page's live bundle contains the speed setting and the Listen tab; the desk bundle contains the PDF hashing step.

## Not checked live

- **Rung 2 on a phone (S4):** locked-screen playback across clips in the installed PWA and Safari, lock-screen and AirPods controls, artwork, 1.5× while walking, scrolling away and Follow. BK checks this on his iPhone.
- **A PDF upload end to end** on the live site.
- **Dragging to select words in a Bible reading:** Psalms 23 (NIV) was added to the library on 2026-10-29 for this; Computer Use couldn't see the page to drag.

## Review

Independent cross-model review (gpt-6.1-sol, max effort): rung 2 seven rounds, feed counts four, PDF binding one (PASS), each ending clean. Every finding was fixed with a regression test.
