# The dictionary's "this month" count can call an old word new

The Dictionary header counts words first looked up in the current month. It works that out from the lookups the page has loaded, which are the reader's 2,000 most recent (`DICTIONARY_CAP` in `apps/web/src/lib/dictionary.ts`). A word first looked up before that window, then looked up again this month, has no older row in view, so it counts as new.

A reader with fewer than 2,000 lookups is unaffected. Past that, the count can be too high by the number of old words met again this month, and the header's total word count is also short by the words only found in older lookups.

Fixing it needs the first-seen date outside the window: either a `firstLookedUpAt` on a per-word row written by `lookups.record`, or a bounded `by_user_word` lookup per word met this month. Left as it is until a library gets near the cap.
