# Verify Bible reading in the normal reader

Enable **Your account → Bible reading**, then open **Browse all available Bibles** or `/bible`. Choose NIV 2011 and `John 3:16-21`, then open the normal reader. Confirm summaries, idea maps, marginalia, notes and highlights remain available. Comparison starts off: explicitly turn on **Compare versions** inside the reader to add another edition. On desktop, the same reference appears in two columns; on narrow screens, the versions stack.

## Access verified

The operator accepted the available YouVersion agreements and completed Make Live. A fresh portal inspection confirmed **LIVE**. The existing initial key is stored in the personal family 1Password Private vault as **Marginalia — YouVersion API** and configured only on the existing live Convex backend. The temporary secret template was removed after import; no key was committed, logged, or embedded in browser/font URLs.

The entitlement-filtered API returned **1,485 editions across 1,262 language tags**. The catalogue requests all metadata using the documented three-field projection, not `all_available=true`. Search examines the complete result, including rows not currently displayed. Preferred authorized editions are pinned first. ESV, New Living Translation and The Message were not found in the accepted account license inventories; New Luo Translation must not be mistaken for New Living Translation.

Real server-side adapter requests retrieved NIV 2011 and NASB 2020 for `John 3:16-21`, preserving their distinct HTML and current attribution. The smoke check also verified private font stylesheet retrieval. This confirms those actual requests, not that every reference in all 1,485 editions was tested. Partial Bibles can legitimately lack the requested book.

## Licensed-text boundaries

- Two distinct versions, each within one chapter; headings, verse labels and footnotes remain in the API-provided HTML.
- Current copyright notices are required before display, with publisher links and the applicable Lockman permission notice.
- Licensed passage bodies are never saved article bodies or AI inputs; the caching follow-up below adds a separate policy-limited server response cache. Each display edition has a separately stored, explicitly labeled WEB study source. Selected quotations can be retained in personal notes/highlights, but automatic quotations are excluded from embeddings and AI recall. Your own note prose can still be indexed.
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

### Passage-opening latency follow-up

A reported slow desk opening exposed a redundant licensed-text preflight. Live Convex completion logs showed `openReading` taking **3.05 seconds**, followed by an **80 ms** reader bootstrap and `readComparison` taking **2.56 seconds**. The initial action downloaded a passage, metadata and font stylesheet, discarded the display body, then fetched the WEB source; the reader subsequently downloaded the licensed display again. Desk suggestions themselves contain references, not prepared passage bodies.

The opening action now validates configuration and request bounds locally, then reuses or creates only the WEB study source. Existing saved study sources reopen without external requests at that stage. The normal reader remains responsible for the single licensed-display fetch, including current entitlements, footnotes, attribution and display-lease checks. Regression tests assert no licensed fetch before navigation and no external requests for reopening a saved study source. This removes the duplicate provider wait without adding a licensed-text cache. The measured baseline is not a post-fix browser latency guarantee; a fresh licensed display still depends on provider response time.

### Content-first layout and shared caching follow-up

The follow-up moves comparison, browsing and word study to the toolbar, replaces chapter buttons with title-flanking chevrons, puts attribution/source disclosure after the passage in fine print, and removes the closed Bible-summary teaser. Summaries and idea maps are still requested from the toolbar. Summary inputs are additionally normalized to authoritative WEB on the backend, not just on the client.

The earlier blanket `no-store` policy was unnecessarily restrictive. Live YouVersion responses explicitly advertise `Cache-Control: public, max-age=3600` for NIV passage text and edition metadata, and `public, max-age=86400` for the font stylesheet. The implementation now shares validated server responses across readers for no longer than those lifetimes, subtracts `Age`/response age, and excludes private, no-store, no-cache or unknown-Vary responses. Cache keys separate app credentials by hash and exact request path. WEB chapters have a seven-day shared cache. Expired rows are unreadable immediately and purged in bounded hourly batches; no licensed cache data becomes an article or AI source. This is HTTP-authorized caching, not permission for a week-long NIV cache or offline web downloads.

The adapter timing harness using real NIV/Psalms 23 responses measured **379 ms / 3 upstream requests** cold and **0.25 ms / 0 upstream requests** warm with an in-process cache implementation. This isolates provider/cache behavior; it is not an end-to-end production-reader timing. Integration tests exercise the persistent Convex cache across two authenticated readers, including expiry and connection-disable behavior.

Desktop and 390px-mobile layouts were inspected using an isolated fixture built from the actual reader components and production CSS with public-domain WEB text, without bypassing app authentication. At 390px the passage body begins at approximately 194px, source fine print follows the passage, and the document has no horizontal overflow. The toolbar popover stays within the mobile viewport. This is component/layout verification, not a claim of signed-in production end-to-end verification.

Follow-up verification: **1,764 backend tests**, **1,205 web tests**, workspace typecheck and production build pass. The component fixture has no confirmed WCAG A/AA violations; the scanner's open-control reference was checked against the actual DOM. The mechanical design detector reports no findings. React Doctor flags the deliberate effect that opens Bible tools when a comparison fails; this exposes the error instead of leaving an apparently inactive toolbar toggle. Existing summary dependency and CSS `::highlight` build warnings remain non-blocking.

Runtime source **`e1571af`** is deployed as **`dpl_5nBu1P7pgzbQf4GCvpCD5FWMPj83`**, confirmed **Ready / Production** and aliased to **https://reader.bhekani.com**. The existing `dev:stoic-hare-718` backend includes the shared cache and bounded hourly expiration cleanup. No user notes or highlights were migrated or deleted.

### Restore the standard reader contract

The content-first follow-up overreached: it hid the normal summary entry point, while an earlier Bible-specific annotation path suppressed bottom reflections. Neither exclusion was requested. The correction restores the standard summary entry, header, reading settings and reflection workflow. Optional chapter navigation moves into Bible tools rather than rearranging the title. Shared caching, source fine print and opt-in comparison remain intact.

Bible annotations now use the ordinary article-generation prompt and reflection persistence, with an additional WEB source-identification safeguard. Already-annotated Bible readings missing reflections are queued once for reflection-only repair when opened. The repair inserts only the missing reflection: existing marginalia, viewed/dismissed state, personal notes and saved reflection responses are preserved. Adopted readings acquire a new generation input through the existing revision fence rather than bypassing it. This runs in the background and does not gate passage display. Readings without a connected AI provider follow the normal skipped-provider/catch-up path.

### Loading structure and startup correction

Live logs recorded an article bootstrap at **293 ms**, followed by licensed text delivery at **3.57 seconds**, even with valid shared cache entries. The Node action made sequential cross-runtime calls for authorization, opt-in, rate limit, lease acquisition, cache lookup and final lease verification. Text delivery now runs in the default Convex runtime through `bibleReading:readComparison`; opt-in, rate limit and lease acquisition share one transaction. The existing Node endpoint remains available for older clients. Shared HTTP expiry, edition identity, attribution and final opt-out/newer-display checks are unchanged.

The visible ordinary desk pick also prewarms the authorized reader-bootstrap subscription and reader route. It does not prefetch licensed wording, optional annotations or AI output. Reader loading, including authentication on `/read/` routes, now shares the loaded column geometry and reserves title, metadata, summary and body positions. Known authorized titles remain visible during text delivery. The desk skeleton reserves its action row instead of ending after the title and metadata.

Verification for runtime **`64b0636`**: **1,767 backend tests**, **1,208 web tests**, typecheck and production build passed. Desktop and mobile actual-component fixtures using production CSS had identical title coordinates and text-start coordinates between loading and loaded states, with no horizontal overflow. The fixture passed WCAG A/AA automated checks after matching production's `lang` attribute. React Doctor reported two non-blocking component-size/complexity warnings; existing CSS `::highlight` build warnings remain. A new signed-in production opening time has **not** been measured.

Deployment **`dpl_6E4XfLv7ksVrbUQEeG7oNgPeNXZN`** is confirmed **Ready / Production**, aliased to **https://reader.bhekani.com**. The existing `dev:stoic-hare-718` backend was updated explicitly; no schema migration or bulk rewrite ran.

A pre-update Convex snapshot including file storage was exported at timestamp `1793015308845860544`, available in the `stoic-hare-718` snapshot dashboard. The schema update adds a small display-lease table and an annotation skip reason; no existing article, note or source is deleted. To stop licensed access, unset the enable flag; do not restore the data snapshot merely to disable this feature.

See [the reading guide](../bible-reading.md) for user-facing behavior and [direct-access findings](../research/bible-direct-access.md) for provider setup history.
