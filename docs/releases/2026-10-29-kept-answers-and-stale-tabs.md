# Kept answers reopen on the words that were selected

Released 2026-10-29 to https://reader.bhekani.com. The backend runs `25aba24` on `dev:stoic-hare-718`, deployed at 02:38. The frontend runs Vercel deployment `dpl_DXgKAtAteDA41fukDtukd85fDTRN`, built from `25aba24`. The backend part of #73 went out first, on 2026-10-28 at 23:19 from `2a28cff`; its frontend waited a day, because Vercel refused the deploy at the account's daily limit ("api-deployments-free-per-day").

## What changed for readers

- **The right copy of repeated words (#73).** An answer on a word or phrase that appears more than once in its paragraph highlights the copy that was selected when it's reopened, kept or not, including a selection that runs into the next paragraph. Kept answers store `occurrence` and `paragraphEnd`; answers kept before this reopen as they did.
- **Several answers on one passage (#73).** Each tap on a shared passage opens the next of its answers, and a tap on the last one open closes it.
- **Stale tabs (#74).** A follow-up from a tab that never saw another tab's follow-ups is refused with "This answer changed in another tab. Reload to see it.", instead of erasing them.

## Rollback

- Snapshots before each backend update, with file storage and auth components, owner-only and ZIP-validated: `marginalia-before-kept-anchors.zip` (before #73) and `marginalia-before-release-2026-10-29.zip` (before #74), 46.8 MB each.
- Both changes add only optional fields and a stricter check, so reverting the code needs no data restore.
- The previous frontend is `dpl_4qAfVwN5oH1Yc1GaBBqNr3UA8yTb` (`6462ce4`).

## Live checks

- The domain serves `dpl_DXgKAtAteDA41fukDtukd85fDTRN`, and the reader page's live bundle contains the occurrence lookup and the stale-tab sentence.
- `convex function-spec` on the live deployment shows `companionThreads:keep` taking `occurrence` and `paragraphEnd`.

## Not checked live

Keeping and reopening an answer in the deployed app, because a live Keep writes to the owner's library and the runbook keeps test writes to fixtures. To check: in an article where a word appears twice in one paragraph, select the second copy, choose Define, press Keep, reload, and open the answer; the second copy should be highlighted. On a phone, two answers on one passage should open in turn on each tap.

## Review

Independent cross-model review (gpt-6.1-sol, max effort): four rounds for #73, ending in PASS; two for #74. In #74 the feed-count change failed twice and was taken out. The live library's most-opened article has 50 rows against the 200-row window, so `docs/issues/feed-stats-dedupe-scan-limit.md` stays open with the counter-table design.
