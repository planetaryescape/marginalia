# Keep and lookup repeat checks only look at the first 200 rows

Found by an independent review of `f1819ef` on 2026-10-16. Both idempotency checks read a bounded set of candidates, so beyond 200 a repeat could insert a duplicate instead of updating the existing row.

- **Keep:** `companionThreads.keep` takes the first 200 threads of the article (`packages/backend/convex/companionThreads.ts`, the `by_article` read) and looks for the same mode, passage, question and paragraph among them.
- **Lookups:** `lookups.record` takes the first 200 rows for the word (`packages/backend/convex/lookups.ts`, the `by_user_word` read) and looks for the same article, paragraph and sentence.

The live data had 25 threads in total on 2026-10-16, so neither limit can be reached today. If either is, add an index that includes the matching fields and read through it with `.first()`.
