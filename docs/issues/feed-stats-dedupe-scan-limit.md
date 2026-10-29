# Feed counts can over-count an article opened more than about 100 times

Status: open, not near the limit. On 2026-10-29 the live library had 286 interactions; the most `opened` rows for one article was 50, all without a session, against the 200-row window.

## Why a different window doesn't fix it (2026-10-29)

Two attempts failed independent review. Reading the newest 200 rows instead of the oldest double-counts old pairs in the backfill. Reading only the interaction's own session, newest 200, still stops counting after about 100 pairs in one session, and every open without a session shares one bucket, so that is the same limit. Any truncated window computes ranks from a suffix that may start between a desk row and its visit.

## The fix when it's needed

Per article and session, the opens counted always equal the larger of the desk opens and the reader-page visits, whatever order the rows arrive in. Store those two numbers in a small table keyed by user, article and session. Count a new open when it raises the larger of the two, and update the row in the same transaction. Fill the table from history with a resumable backfill before the live path relies on it. A repeated finish needs the same treatment keyed by visit.

`isNewOutcome` in `packages/backend/convex/feedStats.ts` pairs a desk open with the reader page's checkpoint open, and drops a repeated finish for one visit, by reading the article's same-action interactions with `take(200)`. The index returns the oldest first, so once an article has more than 200 `opened` rows (about 100 opens, because each open is usually a desk row plus a visit row) a newer interaction is not in the window. The function then counts it unpaired, so the desk and visit rows of every open past that point each add to `opened`. The same cut-off applies to `finished`, though 200 finishes of one article is far less likely.

Likely cause for fixing it: scan newest first, or look up the partner row directly (same session, opposite kind, nearest in time) instead of ranking within a window. A per-session marker on the desk row would also remove the scan. Not fixed because no reader is near the limit; found in the second review of rung 2g.
