# Remove the superseded time-window action

Status: done 2026-10-17.

`d95edca` (2026-10-15) moved time-window picks to the `suggestions.forWindow` query. The old `select` action in `actions/selectArticle.ts` stayed for one release so pages cached by the PWA kept working. Several releases have shipped since, so it is removed.

- Deleted `packages/backend/convex/actions/selectArticle.ts`, and its two entries in `packages/backend/convex/_generated/api.d.ts`.
- Corrected the comment above `sessions.listRecentInteractions`, which named the deleted action.
- Kept `sessions.listRecentInteractions`. No product code calls it; `isolation.test.ts` reads it to check that a reader sees none of another account's interactions, so removing it would drop that check.
- Nothing in `apps/web` referenced the action.
