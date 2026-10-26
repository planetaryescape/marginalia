# Verify Bible reading in the normal reader

Enable **Your account → Bible reading**, then open **Browse all available Bibles** or `/bible`. Choose NIV 2011 and `John 3:16-21`, then open the normal reader. Confirm summaries, idea maps, marginalia, notes and highlights remain available. Comparison starts off: explicitly turn on **Compare versions** inside the reader to add another edition. On desktop, the same reference appears in two columns; on narrow screens, the versions stack.

## Access verified

The operator accepted the available YouVersion agreements and completed Make Live. A fresh portal inspection confirmed **LIVE**. The existing initial key is stored in the personal family 1Password Private vault as **Marginalia — YouVersion API** and configured only on the existing live Convex backend. The temporary secret template was removed after import; no key was committed, logged, or embedded in browser/font URLs.

The entitlement-filtered API returned **1,485 editions across 1,262 language tags**. The catalogue requests all metadata using the documented three-field projection, not `all_available=true`. Search examines the complete result, including rows not currently displayed. Preferred authorized editions are pinned first. ESV, New Living Translation and The Message were not found in the accepted account license inventories; New Luo Translation must not be mistaken for New Living Translation.

Real server-side adapter requests retrieved NIV 2011 and NASB 2020 for `John 3:16-21`, preserving their distinct HTML and current attribution. The smoke check also verified private font stylesheet retrieval. This confirms those actual requests, not that every reference in all 1,485 editions was tested. Partial Bibles can legitimately lack the requested book.

## Licensed-text boundaries

- Two distinct versions, each within one chapter; headings, verse labels and footnotes remain in the API-provided HTML.
- Current copyright notices are required before display, with publisher links and the applicable Lockman permission notice.
- Licensed passage bodies are transient action output, never saved article bodies or AI inputs. Each display edition has a separately stored, explicitly labeled WEB study source. Selected quotations can be retained in personal notes/highlights, but automatic quotations are excluded from embeddings and AI recall. Your own note prose can still be indexed.
- One display lease per reader retires older comparison views, including across devices. Disconnected clients hide the text. A slower, older request cannot retire a newer comparison. Opt-out deletes the lease and wins in-flight publication.
- Reader ownership is derived from authentication. Licensed text cannot be saved through the internal article-creation path, and legacy licensed article rows are excluded from article access and annotation publication.
- The service worker still caches only its offline fallback, not Scripture or API responses. Licensed display is omitted from print output.

`YOUVERSION_APP_KEY` and `YOUVERSION_READING_ENABLED=true` are required on the intended backend. Removing either disables new licensed calls and invalidates active displays. License acceptance and a live app do not grant personalized AI rights. AI features use WEB independently of the displayed edition; the companion enforces this server-side and prepared-display storage is blocked for these readings.

## Original-language study

Use **Word study · Greek / Hebrew / Strong’s** to load a single verse, select a verified source word, inspect its morphology and historical dictionary entry, then request an explanation. The server retrieves source evidence itself; it does not trust a client-supplied lemma, Strong’s number or English alignment. Explanations include original-language context, bounded same-book occurrences and WEB, not displayed NIV text. Greek textual-tradition differences, Hebrew versification ambiguity and source licenses are explicit. See [data notices](../bible-word-study-sources.md).

## Verification and rollback

The normal-reader update passed **1,759 backend tests** and **1,201 web tests** with `--maxWorkers=3 --testTimeout=30000`, plus workspace type checking and the production build. Regression checks cover comparison starting off, comparison failure preserving the primary edition, retired display leases, verse-based annotation mapping, source-verified word studies and WEB-only model inputs. A live-source smoke check loaded and parsed the first verse of all **66 books**, with no failures; this does not establish every verse's mapping or dictionary completeness.

Lint passes with the pre-existing `summary-panel.tsx` dependency warning. The build retains its existing CSS `::highlight` warnings; React Doctor reports one catalogue control-flow complexity warning. The staged diff and outgoing commits pass Gitleaks. A broader source scan reports only pre-existing UUID test-fixture false positives; generated Next/Turbo caches are not release source.

Authenticated browser end-to-end and desktop/mobile visual verification of this refactor remain **unverified**. The available isolated browser reaches the production sign-in gate without console errors; it is not signed in, and no authentication bypass was used. The earlier licensed-passage smoke check is not a substitute for testing this new reader flow while signed in.

Runtime source **`85c006e`** is deployed as **`dpl_AMGB6mX2AEoy82PvxPHgUXqw7p5X`**, confirmed **Ready / Production**, aliased to **https://reader.bhekani.com**. The backend was updated deliberately on the existing `dev:stoic-hare-718` deployment with `CONVEX_DEPLOYMENT=dev:stoic-hare-718 bunx convex dev --once --typecheck enable`. Do not use a bare `convex deploy`, which targets a different deployment.

The superseded separate comparison runtime was `085a779`, deployed as `dpl_BrjivBPYHDtBzth1d63ugtNewmHc`.

A pre-update Convex snapshot including file storage was exported at timestamp `1793015308845860544`, available in the `stoic-hare-718` snapshot dashboard. The schema update adds a small display-lease table and an annotation skip reason; no existing article, note or source is deleted. To stop licensed access, unset the enable flag; do not restore the data snapshot merely to disable this feature.

See [the reading guide](../bible-reading.md) for user-facing behavior and [direct-access findings](../research/bible-direct-access.md) for provider setup history.
