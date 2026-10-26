# Time-window picks mishandle articles with no reading-time estimate

Found by an independent review of `530da7c` on 2026-10-16. Both cases need an unread, annotated article with no `estimatedReadMinutes`. None exist today: ingest always sets the estimate (`packages/backend/convex/lib/ingest.ts#L92`), and a read-only count of the live `articles` table on 2026-10-16 found 0 of 131 unread annotated articles without one. Fix these if a source ever stores articles without an estimate.

- **Ordering:** `suggestions.moreForWindow` pages by the stored estimate, and Convex sorts a missing value below every number. An unestimated article whose word count makes it an exact fit comes after every estimated article, however short.
- **Shortest:** `suggestions.shortestUnread` reads at most 100 unestimated articles (`UNESTIMATED_SCAN`), so a shorter one past the first 100 is missed.

A fix that covers both is to backfill `estimatedReadMinutes` from `wordCount` for any article missing it, so the index order is the effective order.
