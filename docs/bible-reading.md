# Read the Bible in Marginalia

Enable **Your account → Bible reading → Enable Bible reading**. The setting is off by default and belongs to your account, not your browser or other readers.

## Find a passage

On Home, choose **Articles only**, **Articles + Bible**, or **Bible only** from **Look in**. Choose a reading-time button to constrain Bible suggestions, then use **Bible topic or passage** to add a topic or enter a reference. Article discovery keeps the existing floating search picker; in mixed mode the Bible finder appears alongside it, independently.

Try these searches:

- `Romans 8` opens a whole chapter.
- `John 3:16-21` opens a verse range.
- `5 minutes about forgiveness` suggests passages related to the topic and within the estimated time.
- `I have 10 minutes` offers starter passages without an AI request.

Use **Browse the Bible** below the Bible finder to choose any of the 66 books and a chapter. Licensed display supports a verse range within one chapter or a whole chapter. WEB also supports up to three consecutive chapters, such as `Matthew 5-7`. Chapter navigation in the reader continues into the next book.

In mixed mode, article results and Bible suggestions are retrieved independently. If one fails, the other remains usable. Bible-only mode hides the article search and recommendation slot.

## Choose a Bible and open the normal reader

Choose **All available Bibles** below the finder, or **Browse all available Bibles** in Your account. The `/bible` page lists the complete collection authorized for the app, not the unrestricted public YouVersion catalogue. The live API check on 26 October 2026 returned **1,485 editions across 1,262 language tags**; the app shows the current count, not a hard-coded list.

Search by title, language tag, common abbreviation or version ID, or filter by language. Search covers the entire downloaded metadata catalogue, including rows not yet shown. Use **Show more versions** to browse the next rows. Your authorized preferred editions—NIV 2011, NASB 2020, NASB 1995 and NIV Anglicized 2011—appear first.

Choose an edition, enter a passage such as `John 3:16-21`, and open it in the same reader used for articles. Your summaries, idea maps, marginalia, highlights, notes and reading settings remain available. Some editions contain only part of the Bible; an unavailable passage produces an error rather than a substitute.

Comparison is **off by default**. Use the **Compare versions** toolbar icon to add or remove the second pane. Open **Bible tools** beside it to choose **Compare with**, browse books or study words. The additional pane follows the same reference, preserves provider HTML and footnotes, and sits outside the primary selection/progress container. It appears beside the primary reading on desktop and below it on narrow screens. Chapter chevrons flank the passage title. Comparisons are limited to two editions within one chapter. Only one licensed display is active per account; opening another retires the older display, and losing the live connection hides the licensed text.

ESV, **New Living Translation** and The Message are not in the verified active entitlements. Biblica's New Luo Translation is not New Living Translation despite sharing the abbreviation NLT.

## Read with an explicitly labeled AI study source

Select text to highlight it, write a note, or ask the companion a question. Your chosen edition supplies the displayed Scripture; **World English Bible (WEB)** supplies AI summaries, idea maps, marginalia and passage explanations. Source disclosure and publisher attribution appear as fine print after the passage. Request a summary or idea map through the toolbar's **More actions → Summary**; there is no summary teaser above Bible text. WEB-based margin notes and summary jumps attach to licensed text by verse identity, not by claiming identical English wording.

Marginalia is generated on demand. Reopening reuses the WEB study source and your notes; licensed display text is never saved as an article body. The study source is stored separately for each display edition so notes and highlight positions do not cross translations. Each exact reference is a separate reading: `Romans 8` and `Romans 8:1-10` do not automatically share marks.

Provider responses use a separate, server-only cache shared across readers. YouVersion's public HTTP cache lifetimes govern licensed text and metadata (one hour in the verified responses) and font stylesheets (one day). `private`, `no-store`, `no-cache`, expired responses and unsupported `Vary` dimensions are not shared. Credentials are represented in cache keys only by a SHA-256 scope hash; disabling the connection blocks cached access too. WEB chapters are shared for seven days, independently of personal notes. There is no extra licensed-passage download before navigating to the reader, and expired cache rows are purged hourly. Desk suggestions themselves are references, not pre-downloaded readings.

Automatically captured licensed quotations are excluded from note embeddings, highlight embeddings, library recall and idea-graph AI context. Your own note prose can still be indexed. Companion requests for licensed-display readings are normalized server-side to the saved WEB source; displayed DOM and selected wording are not AI evidence. Licensed bodies are not cached for offline reading or printed.

## Study an original-language word

Open the toolbar's **Bible tools → Word study · Greek / Hebrew / Strong’s**, enter one verse, then choose **Load original words**. Selecting **Define** on Bible text opens this tool for the selected verse when verse markup is available. English words are not automatically aligned to original-language words.

Choose a Greek or Hebrew word to see source-supplied Strong’s references, morphology tags, historical dictionary entries and up to eight other occurrences in the same book. Choose **Explain this original word** to ask your connected AI provider for an explanation grounded in those sources, the surrounding original-language verses and WEB. Loading words and dictionary entries does not require AI.

The Greek source is the public-domain Robinson-Pierpont parsed Byzantine text, which can differ from the critical text underlying NIV. Hebrew uses Open Scriptures Hebrew Bible / WLC, with its English/Hebrew verse map; partial or ambiguous mappings fail explicitly. Missing dictionary spellings remain missing. Strong’s numbers are dictionary indexes, not a guarantee that every listed sense applies in a verse. Source revisions, attribution, exact source downloads and license terms are shown with each study. See [third-party data notices](bible-word-study-sources.md).

Connect an AI provider in **Your account** for generated marginalia and recommendations on specific topics. Direct reference lookup, chapter browsing, highlights, personal notes, time-based starter recommendations and a limited set of topic starters work without an AI key. After a provider is connected, the existing catch-up process can annotate passages previously skipped for lack of a provider. To retry manually, use the desktop toolbar's **Re-annotate with latest vault** button, or **More reading actions → Re-annotate** on mobile. Annotation jobs paused while Bible reading is off resume when you enable it and reopen the passage.

AI chooses references and writes commentary; it never supplies the Scripture text. Read its annotations as interpretation, check cross-references, and consider the surrounding context. Bible passages do not receive the article reader's argumentative-critique reflection box.

Turn Bible reading off in **Your account** to remove its discovery controls and block passage access. This does not delete saved passages or notes; enable it again to reopen them. Existing personal notes can still appear in your Notes collection.

## Translation and availability

The **World English Bible (WEB)** remains the public-domain study source and a directly readable edition. Licensed editions use the normal reader and a policy-limited shared HTTP cache, never a silent WEB substitution. See the [direct access research](research/bible-direct-access.md) for provider-specific access and obligations.

Marginalia's YouVersion app is **Live** after the operator accepted the available agreements and completed Make Live. The existing app key is stored in the personal family 1Password Private vault as **Marginalia — YouVersion API** and configured only on the backend. No app key is sent to the browser, including in font stylesheet URLs.

Set `YOUVERSION_APP_KEY` on the intended Convex deployment using the vault value, then set `YOUVERSION_READING_ENABLED=true` after verifying live status and accepted licenses. Removing either value disables licensed requests and cached access, and retires active displays. The client never requests `all_available=true`. It refreshes attribution within the provider's cache lifetime, requires notices before displaying text, includes footnotes, and links to the publisher. Accepting a reading license does not authorize personalized AI features.

WEB text is fetched server-side, one chapter at a time, from [bible-api.com](https://bible-api.com/), then retained in your private library. The app checks the returned translation, book, chapter and requested verse endpoints before saving it. Scripture is escaped before rendering. No whole-Bible import or pre-annotation runs when you enable the feature.

The external text service is rate-limited and has no availability guarantee. New study passages require a network connection; saved WEB passages reuse their stored text. Licensed display requires a live connection even when its WEB study source is saved. A busy or unavailable source produces an error and allows retry, never an AI replacement.

## Verify the integration

Run from the repository root:

```sh
bun run typecheck
bun run test
```

The Bible tests cover opt-in, reader isolation, source filters, saved notes and highlights, retrieval failures, translation restrictions, short-passage annotations and reference validation. The control tests cover disabled discovery and Bible-only search without article requests.

For browser verification, configure the web app's public Convex URL and sign in to a test reader. Check Home and Your account on desktop and mobile, open a passage, make a highlight and note, reopen it, then disable Bible reading and confirm its controls and search results disappear. Missing `NEXT_PUBLIC_CONVEX_URL` prevents the local app from loading; do not bypass authentication to run this check.
