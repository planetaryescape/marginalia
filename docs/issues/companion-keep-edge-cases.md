# Keep and lookup edge cases found in review

## Repeat checks only look at the first 200 rows

Found by an independent review of `f1819ef` on 2026-10-16. Both idempotency checks read a bounded set of candidates, so beyond 200 a repeat could insert a duplicate instead of updating the existing row.

- **Keep:** `companionThreads.keep` takes the first 200 threads of the article (`packages/backend/convex/companionThreads.ts`, the `by_article` read) and looks for the same mode, passage, question and paragraph among them.
- **Lookups:** `lookups.record` takes the first 200 rows for the word (`packages/backend/convex/lookups.ts`, the `by_user_word` read) and looks for the same article, paragraph and sentence.

The live data had 25 threads in total on 2026-10-16, so neither limit can be reached today. If either is, add an index that includes the matching fields and read through it with `.first()`.

## Two tabs diverging on a kept conversation

Found by an independent review of `e9c9f9d` on 2026-10-16. A kept answer's follow-ups are written with `companionThreads.updateTurns` (`packages/backend/convex/companionThreads.ts`), which replaces the stored turns. If two tabs hold the same kept answer and the stale one asks a follow-up, it sends its shorter transcript and shrinks the record. `keep` refuses to shrink a transcript; `updateTurns` does not.

One fix is to make `updateTurns` append only the turns the record does not have, or to refuse a write with fewer turns than stored. The reader is one person, so two tabs on one kept answer is unlikely.

## Found in review of `3d2e26d`

Logged on 2026-10-16, not fixed.

- **Occurrences collapse after punctuation normalisation.** `wordKeyOf` strips edge punctuation, so "bass," and "bass." in one sentence share a key; with the same sentence, paragraph and occurrence index they merge (`packages/backend/convex/lookups.ts`, the repeat check). The occurrence index tells them apart only when the client counts them as different matches, and the client matches on the normalised text.
- **Fixed 2026-10-28: keep drops `occurrence` and `paragraphEnd`.** `companionThreads.keep` now stores both, also on a row kept before, `getBody` returns both, and the article previews return `occurrence`. Before that, it stored neither, so a reopened kept answer that is regenerated or extended is asked against the first occurrence of its words and loses the short-block context a multi-paragraph selection had (`apps/web/src/lib/companion.ts`, `fromDoc` and `keep`). Both fields would need to be added to the record.
- **Fixed 2026-10-28: several answers on one passage are reachable only as the first.** Each tap on a shared passage now opens the next of its answers, and a tap on the last one open closes it, as the `o` key cycles. Before that, `useSavedPassages` hit-tests with `.find()` and returns the first match, so on phone and sheet layouts, where the passage is the handle, a second answer on the same passage cannot be opened by tapping it (`apps/web/src/lib/saved-passages.ts`, `hitTest`). Margin layouts are unaffected.
- **Fixed 2026-10-28: re-anchoring ignores the captured occurrence.** `findOccurrenceRange` (`apps/web/src/lib/text-range.ts`) finds the selected match in its paragraph through the reader package's `createTextQuoteIndex(…).find(text, { occurrence, caseSensitive: false })`, which v0.1.4 already had, so the package needed no change. Before that, the open answer's passage is found with `findTextRange`, which returns the first match, so the second "bass" is highlighted at the first (`apps/web/src/app/read/[articleId]/page.tsx`, the `openRange` effect). `findTextRange` lives in the `@planetaryescape/reader` package, so the fix belongs there: accept an occurrence index.
- **Legacy transcript matching strips code-like text.** `plainText` in `kept-answers.ts` removes anything between `<` and `>`, which also removes text such as `Array<T>` from a real old copy, so its body no longer equals the thread's transcript and the copy reads as the reader's own note. It stays visible, only unfolded. Matching on the unescaped text before stripping tags would fix it.
