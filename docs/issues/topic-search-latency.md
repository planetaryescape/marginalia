# Topic search first card is about 1 s, just over the target

Measured live 2026-10-16 after rung 3c (`9a90018`): `POST /api/reader/library/find` takes about 1.05 s end to end warm. `Server-Timing` shows about 550 ms on the server, of which embedding the query is about 500 ms (search 4 ms, load 44 ms). The rest (about 500 ms) is the hop from the browser through the Vercel proxy to Convex. Before 3c the first result took 6.7–8.8 s.

To reach the under-1 s target: cache query embeddings for repeated and prefix-similar queries, and call the Convex site endpoint directly from the picker instead of through the proxy (check CORS and auth for that path first).
