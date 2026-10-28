# Topic search first card is about 1 s, just over the target

Status: mostly fixed. A repeated query takes about 106–148 ms live over the direct path (`1e481d1`). A query never seen before still pays for its embedding, 0.8–1.4 s, and the title-first card that should cover it hasn't been measured live.

Measured live 2026-10-16 after rung 3c (`9a90018`): `POST /api/reader/library/find` takes about 1.05 s end to end warm. `Server-Timing` shows about 550 ms on the server, of which embedding the query is about 500 ms (search 4 ms, load 44 ms). The rest (about 500 ms) is the hop from the browser through the Vercel proxy to Convex. Before 3c the first result took 6.7–8.8 s.

To reach the under-1 s target: cache query embeddings for repeated and prefix-similar queries, and call the Convex site endpoint directly from the picker instead of through the proxy (check CORS and auth for that path first).

## Query embedding cache (fix/search-cache)

The find route now reuses a query's embedding when the same reader searched it in the last 30 days with the same embedding model. Queries are compared after lower-casing and collapsing whitespace, so "Rust  Async" and "rust async" share an entry. Each reader keeps at most 500 entries, and the oldest go first. Account deletion removes them.

On a hit the Server-Timing stage is `embed-cached` instead of `embed`, and no embedding request is made. This removes the roughly 500 ms embedding stage for repeated queries. Queries the reader hasn't searched before still pay it, so the first search for a new topic stays near 1 s. Not yet measured live; the figure above is from rung 3c.

What remains is the proxy hop, about 500 ms per search from the browser through the Vercel proxy to Convex. The fix is still to call the Convex site endpoint directly from the picker, after checking CORS and auth on that path.

## Measured after the cache, 2026-10-16 (`1a8c940`)

Three calls to `POST /api/reader/library/find` from a signed-in browser, one after another:

| Query | End to end | Server-Timing |
|---|---|---|
| "remote work and focus" (miss) | 1,574 ms | `embed;dur=797`, `total;dur=866` |
| "Remote work  and focus" (normalised hit) | 501 ms | `embed-cached;dur=14`, `total;dur=21` |
| same as the first (hit) | 508 ms | `embed-cached;dur=14`, `total;dur=20` |

A repeated or re-spaced query is now under the 1 s target. What remains is about 480 ms of hop from the browser through the Vercel proxy to Convex, and the embedding cost of a query never seen before.

## Direct browser calls to Convex (fix/search-direct)

The picker now posts `library/find` and `library/search` straight to `${NEXT_PUBLIC_CONVEX_SITE_URL}/api/library/<path>` with `Authorization: Bearer <Convex JWT>`, skipping the proxy's server-side `getToken()` round trip and the extra hop. Not yet measured live; the target is the roughly 21 ms Convex cost plus one network round trip on a cache hit.

- Token: `apps/web/src/lib/convex-token.ts` keeps the last good JWT with its `exp`. `fetchAccessToken` in `convex.tsx` feeds it, and it refreshes through `authClient.convex.token()` when missing or within 60 s of expiry. Concurrent callers share one refresh.
- Fallback: `topic-search-request.ts` uses the proxy route (`/api/reader/library/<path>`) on a network or CORS failure, a missing token or a 401. After a network or CORS failure it skips the direct path for 5 minutes, so a misconfigured origin costs one failed preflight, not one per search. Other statuses (404 for a backend without `find`, 409, 429) pass through unchanged.
- Convex CORS: both routes answer `OPTIONS` and add `Access-Control-Allow-Origin` only when the request `Origin` is in `READER_ORIGINS` (comma-separated, default `https://reader.bhekani.com`, `*` ignored). Allowed headers are `authorization, content-type`, methods `POST, OPTIONS`, `Server-Timing` is exposed, `Vary: Origin` is always set, and credentials are never allowed. Any other origin gets no `Access-Control-*` headers. Implementation: `packages/backend/convex/lib/cors.ts`, applied to the two routes' responses in `http.ts` (including 401, 409, 429 and 502).
- Auth is unchanged: `signedInReader` resolves `ctx.auth` from the Bearer JWT.
- The proxy still serves companion, engagement and every other path, and remains the fallback for these two.
- Local development (`localhost`) is not in the default origins, so it falls back to the proxy. Add the origin to `READER_ORIGINS` on a dev deployment to test the direct path.

## Measured after the direct call, 2026-10-16 (`221f633`)

The topic picker now calls `stoic-hare-718.eu-west-1.convex.site/api/library/find` directly (Resource Timing shows that host). Typing queries in the live desk, a run of `find` calls measured 1,421, 510, 798, 265, 137, 148, 142, 106 and 997 ms, read from Resource Timing. The cached calls took about 106 to 148 ms, against about 505 ms through the proxy. A query never seen before still pays for its embedding, about 0.8 to 1.4 s. Server-Timing isn't visible cross-origin without `Timing-Allow-Origin`, so these are browser-side durations only.

What remains is the embedding call for a new query. Closing it needs a faster embedding provider or prediction, not transport. Titles are now predicted (next section).

## Title match as the first card (wave4/search)

Asked for by the owner on 2026-10-17 (D-DES-069). Typing words that match an article's title shows that article as the first card without waiting for the embedding.

- Index: `articles.search_title`, full text on `title`, filtered by `userId` and `extractionStatus`. Adding an index is backwards compatible, and Convex backfills it on deploy.
- Query: `titleSearch.matchTitles` (`packages/backend/convex/titleSearch.ts`) runs for `ctx.readerId` only, over the reader's extracted articles. It takes the top 5 index hits (they are whole documents, up to about 900 KB each, so the count stays far below the 16 MiB read limit), drops a second copy of the same URL, orders unread before started before read as `find` does, and returns only `find`'s card fields.
- Client: `use-topic-search.ts` starts the title query with `find` for the same debounced text. `strongTitleMatch` (`topic-card.ts`) accepts a hit when every typed word of three or more letters starts a word in its title, ignoring case; the unfinished last word therefore counts. With no such word, or no hit, nothing changes from before.
- No swap: when `find` lands, `titleFirst` puts the title article first and removes it from `find`'s list. If the title result arrives after `find`, it is dropped, because a card is already on screen. Both are decided synchronously in one place (`land`), so they can't interleave.
- If `find` fails after the title card showed, the picker shows its usual error with Retry.
- Not yet measured live: the expected cost is one Convex query round trip (about the 106–148 ms of a cached `find`, without the embedding).

