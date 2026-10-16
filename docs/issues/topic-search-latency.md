# Topic search first card is about 1 s, just over the target

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
