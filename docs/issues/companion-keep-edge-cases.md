# Keep and lookup edge cases found in review

## Repeat checks only look at the first 200 rows

Found by an independent review of `f1819ef` on 2026-10-16. Both idempotency checks read a bounded set of candidates, so beyond 200 a repeat could insert a duplicate instead of updating the existing row.

- **Keep:** `companionThreads.keep` takes the first 200 threads of the article (`packages/backend/convex/companionThreads.ts`, the `by_article` read) and looks for the same mode, passage, question and paragraph among them.
- **Lookups:** `lookups.record` takes the first 200 rows for the word (`packages/backend/convex/lookups.ts`, the `by_user_word` read) and looks for the same article, paragraph and sentence.

The live data had 25 threads in total on 2026-10-16, so neither limit can be reached today. If either is, add an index that includes the matching fields and read through it with `.first()`.

## Two tabs diverging on a kept conversation

Found by an independent review of `e9c9f9d` on 2026-10-16. A kept answer's follow-ups are written with `companionThreads.updateTurns` (`packages/backend/convex/companionThreads.ts`), which replaces the stored turns. If two tabs hold the same kept answer and the stale one asks a follow-up, it sends its shorter transcript and shrinks the record. `keep` refuses to shrink a transcript; `updateTurns` does not.

One fix is to make `updateTurns` append only the turns the record does not have, or to refuse a write with fewer turns than stored. The reader is one person, so two tabs on one kept answer is unlikely.
