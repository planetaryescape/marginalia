# Read the Bible in Marginalia

Enable **Your account → Bible reading → Enable Bible reading**. The setting is off by default and belongs to your account, not your browser or other readers.

## Find a passage

On Home, use the **Look in** source toggle to choose **Articles only**, **Articles + Bible**, or **Bible only**. The same finder handles every source: type a topic or passage and results appear after a short pause. The current result is ready to open with Enter; arrows move through the cards and matching notes. Paste a link and press Enter to save and read it. Choose a reading-time button on Home to constrain results; the selected time remains until cleared and reading durations stay visible on the result cards. `/` opens the finder and `F` cycles the enabled source choices. These single-key shortcuts pause while typing or while a modal is open, and respect the account's shortcut opt-out.

Try these searches:

Specific references appear immediately without a topic-search request. Common unambiguous book-name typos such as `colosians 2` are shown as **Colossians 2** before you open them. Abbreviations such as `COL 2` and compact references such as `John3:16` also work. Direct references remain visible even when they exceed a selected recommendation time; ambiguous or invalid references are not silently changed to another passage. Articles-only mode continues to search your library.

- `Romans 8` opens a whole chapter.
- `John 3:16-21` opens a verse range.
- `5 minutes about forgiveness` suggests passages related to the topic and within the estimated time.
- `I have 10 minutes` offers starter passages without an AI request.

Use the dedicated `/bible` page to browse available editions and passages. Licensed display supports a verse range within one chapter or a whole chapter. WEB also supports up to three consecutive chapters, such as `Matthew 5-7`. Chapter navigation in the reader continues into the next book.

In mixed mode, article results and Bible suggestions are retrieved independently after a short typing pause. If one fails, the other remains usable. Bible-only mode keeps the same finder and source chooser; article time picks and PDF import are not shown in that scope.

## Choose a Bible and open the normal reader

Choose **All available Bibles** below the finder, or **Browse all available Bibles** in Your account. The `/bible` page lists the complete collection authorized for the app, not the unrestricted public YouVersion catalogue. The live API check on 26 October 2026 returned **1,485 editions across 1,262 language tags**; the app shows the current count, not a hard-coded list.

Search by title, language tag, common abbreviation or version ID, or filter by language. Search covers the entire downloaded metadata catalogue, including rows not yet shown. Use **Show more versions** to browse the next rows. Your authorized preferred editions—NIV 2011, NASB 2020, NASB 1995 and NIV Anglicized 2011—appear first.

Choose an edition, enter a passage such as `John 3:16-21`, and open it in the same reader used for articles. Your summaries, idea maps, marginalia, highlights, notes and reading settings remain available. Some editions contain only part of the Bible; an unavailable passage produces an error rather than a substitute.

Comparison is **off by default**. Use the **Compare versions** toolbar icon to add or remove the second pane. Open **Bible tools** beside it to choose **Compare with**, navigate chapters with chevrons, browse books or study words. These optional tools do not replace the standard reader header, summary or bottom reflections. The additional pane follows the same reference, preserves provider HTML and footnotes, and sits outside the primary selection/progress container. It appears beside the primary reading on desktop and below it on narrow screens. Comparisons are limited to two editions within one chapter. Only one licensed display is active per account; opening another retires the older display, and losing the live connection hides the licensed text.

ESV, **New Living Translation** and The Message are not in the verified active entitlements. Biblica's New Luo Translation is not New Living Translation despite sharing the abbreviation NLT.

## Read with an explicitly labeled AI study source

Select text to highlight it, write a note, or ask the companion a question. Your chosen edition supplies the displayed Scripture; **World English Bible (WEB)** supplies AI summaries, idea maps, marginalia and passage explanations. Source disclosure and publisher attribution appear as fine print after the passage. The standard summary entry point remains above the text, with **More actions → Summary** and `u` as additional ways to open it. The usual **Before you go** reflections and response field remain at the bottom. WEB-based margin notes and summary jumps attach to licensed text by verse identity, not by claiming identical English wording.

Marginalia is generated on demand. Reopening reuses the WEB study source and your notes; licensed display text is never saved as an article body. When a licensed display provides verse markers, Scripture notes are attached to the matching displayed verse even when its text spans several display blocks. The note stays grounded in WEB; matching by verse does not claim that two editions use identical wording. If the display has no usable verse markers, notes cannot be placed on that licensed text. The study source is stored separately for each display edition so notes and highlight positions do not cross translations. Each exact reference is a separate reading: `Romans 8` and `Romans 8:1-10` do not automatically share marks.

Scripture notes follow the passage's genre and supplied context. They distinguish textual observation, interpretation and application, and may return no margin notes when nothing useful is supported. Missing evidence does not license named scholarly, manuscript, original-language or cross-reference claims. To request a fresh reading of this passage, choose **More actions → Re-annotate with latest vault**. This is explicit and applies to the selected passage only; there is no library-wide refresh. A failed refresh leaves the previous notes and reflection in place, and a saved reflection response is retained.

Provider responses use a separate, server-only cache shared across readers. YouVersion's public HTTP cache lifetimes govern licensed text and metadata (one hour in the verified responses) and font stylesheets (one day). `private`, `no-store`, `no-cache`, expired responses and unsupported `Vary` dimensions are not shared. Credentials are represented in cache keys only by a SHA-256 scope hash; disabling the connection blocks cached access too. WEB chapters are shared for seven days, independently of personal notes. There is no extra licensed-passage download before navigating to the reader, and expired cache rows are purged hourly. Desk suggestions themselves are references, not pre-downloaded readings.

Automatically captured licensed quotations are excluded from note embeddings, highlight embeddings, library recall and idea-graph AI context. Your own note prose can still be indexed. Companion requests for licensed-display readings are normalized server-side to the saved WEB source; displayed DOM and selected wording are not AI evidence. Licensed bodies are not cached for offline reading or printed.

## Study an original-language word

Select an English word in a verse and choose **Define**. The word-study pane shows your selected wording, verse reference and ordinary English dictionary meanings with source and license links. It sits beside the passage on desktop and fills the screen on phones; use **Back to passage** to return. The dictionary receives only a single English headword, never the verse or your notes, and does not use AI. Missing entries and phrases are reported without a guessed definition. These general meanings do not establish a contextual sense or a Greek/Hebrew match.

For source-language detail, expand **Optional original-language details** and choose **Load original words**. You can also open **Bible tools → Original-language word study**, enter one verse and load its words directly. No original word is selected automatically. A transliteration is shown when the source supplies one; Greek or Hebrew script remains supporting detail.

Selecting **Define** in the generated summary instead uses the ordinary English reading companion with the saved summary as context. It does not open original-language study or send the displayed Bible translation as AI evidence.

Choose a Greek or Hebrew word to see source-supplied Strong’s references, morphology tags, historical dictionary entries and up to eight other occurrences in the same book. Choose **Explain this original word** to ask your connected AI provider for an explanation grounded in those sources, the surrounding original-language verses and WEB. Loading words and dictionary entries does not require AI.

The Greek source is the public-domain Robinson-Pierpont parsed Byzantine text, which can differ from the critical text underlying NIV. Hebrew uses Open Scriptures Hebrew Bible / WLC, with its English/Hebrew verse map; partial or ambiguous mappings fail explicitly. Missing dictionary spellings remain missing. Strong’s numbers are dictionary indexes, not a guarantee that every listed sense applies in a verse. Source revisions, attribution, exact source downloads and license terms are shown with each study. See [third-party data notices](bible-word-study-sources.md).

## Run a Deep Study

Select Bible text and choose **Deep study** in the selection menu. The app resolves the containing verses to canonical WEB identities before closing the menu; it does not align licensed English wording to WEB. The study uses those verses, wider WEB chapter context and retrieved evidence. It may return zero findings or mark coverage partial or insufficient. Read each finding with its saved citations and source details; the source list is evidence for that run, not a claim of scholarly consensus. Reopen a result through **Bible tools → Saved deep studies**.

Deep Study saves private selections, runs, findings and evidence until you delete the Study, its source article or your account. Completed results remain until deletion; expired leases and unpublished or superseded run data are cleaned up in bounded batches after 24 hours. A failed retry or refresh leaves the previous successful result available. Reopening history does not regenerate it; use the explicit retry or refresh action to request another run. There is one active run per reader, a limit of six new runs per hour, one chapter and at most 40 verses per selection, 24,000 source characters, 8 HTTP requests, 16 evidence records, a 6,000-token model output cap, two model dispatches and a 90-second run deadline. Closing a pending study waits for admission or cancellation acknowledgement and prevents later publication or retrieval. A model request already dispatched may still finish and incur provider cost.

Deep Study verifies the selection against a retrieved public-domain WEB chapter. It includes the full retrieved chapter when it fits, with up to 12,000 additional characters beyond the selected and adjacent verses. Otherwise it expands nearby context within the shared input budget. **Coverage and limits** lists the supplied ranges and says whether the full chapter was available. The request carries canonical WEB identities and evidence, not licensed display wording.

New runs can also use saved note prose from this reading as personal context. Notes help the model understand your questions; they are never instructions or scholarly evidence. At most eight note excerpts are supplied, each limited to 1,200 characters, within a 4,000-character serialized note-context budget shared with the 24,000-character source limit. Selection wording, rich HTML, annotation prompts, marks and unsaved drafts are excluded. In a single-chapter reading, a note whose exact verse cannot be verified is labelled chapter-level context. Ambiguous notes in multi-chapter readings are omitted. The run records a context hash and note count, not note text in its evidence manifest. Open **Coverage and limits** to check note use and truncation.

Before publication, the app checks every finding and can send specific correction feedback to the model. Schema retries and finding corrections share the same two-dispatch limit and 90-second deadline. A missing WEB citation is completed without another call only when its exact selected-source match is unique. Final publication repeats the evidence checks. If correction leaves some findings unverified, only the verified subset is published, with an omission notice; if none can be verified, the run fails without replacing a previous result. An empty, valid response remains an allowed outcome.

Deep Study uses the public-domain World English Bible and pinned source datasets. It includes adapted Aquifer Open Study Notes, derived from Tyndale Open Study Notes under CC BY-SA 4.0, with attribution, license and change notices in the source manifest and interface. This is one adapted corpus, not a survey or consensus source. The Byzantine text comparison covers printed editions (NA/Byz, NA27–28, ECM, NA27 and NA28); it does not identify manuscript witnesses or establish an original reading. Existing OSHB and Strong’s evidence is sampled: up to three verses, at most 25 tokens per verse, and up to three dictionary entries with 900-character excerpts. It does not infer English alignment or broad modern-scholar consensus. The app can retrieve up to two related WEB passages found in supplied source records, preferring ranges outside supplied chapter context and reusing supplied ranges as fallbacks. The bounded packet includes at most one printed-text comparison. The model does not choose URLs or start a research chain. The result shows the saved source, excerpt, locator, revision, hash and license for its evidence. Those source records do not certify every free-form claim in a finding.

### Ask a follow-up

Ask a question about the latest saved study. Follow-ups are unavailable while a refresh is running. If it succeeds, ask about the new study; if it fails, the previous result remains available. The original study sources and earlier answers stay saved with their run. An answer can cite those sources and verified WEB evidence requested for it or carried from an earlier answer. Each answer may request one optional expansion of up to two canonical references, each within one chapter and no more than 40 verses total. Arbitrary URLs and further research rounds are not accepted. The expansion is bounded to eight additional evidence records and 12,000 excerpt characters; earlier supplemental evidence is carried forward within the same limits.

Click an answer’s citation number to inspect the saved passage, excerpt, source limits, attribution, revision, URL, license and content hash. If requested evidence is invalid or unavailable, it does not support a claim; the answer should explain a material gap. Citation checks establish that cited evidence matches the saved records, not that every interpretation is correct. You can ask up to 12 completed questions, with at most 24 attempts for a study. A failed or stopped answer can be asked again while the limit allows it. Refreshing the study preserves the prior successful result until a replacement succeeds; follow-ups then apply to the latest published run.

For the frozen public-fixture prompt comparison, see the [Deep Study evaluation guide](../scripts/deep-study/README.md).

The configured ChatGPT-plan deep model currently fails before evidence retrieval with `model_output_limit_unavailable` when its adapter cannot enforce the Study output cap. Choose a compatible API deep model in **Settings → Models**, then select the passage again. No account or provider is selected automatically.

## Keep a cited passage

Use **Keep for later** on a citation from one of your published Study findings or an owned active WEB margin note. A Keep stores the exact canonical reference and up to 500 characters of the source-generated reason; it does not store private notes. You can keep at most 256 references and attach at most 16 source connections to each. The existing Library shelf shows the reference, reason and optional source link. Remove a Keep with its confirmation control. Deleting a source article or Study detaches its link while preserving the kept reference and reason; deleting your account removes all Keeps.

When Bible recommendations are enabled, a Keep can be suggested for time fit or an explicit topic match. Article-only scope and Bible opt-out suppress Keeps. A reference offered in the last 24 hours or opened in the last seven days is cooled down. Completing that exact reference in any edition excludes it until you use the ordinary **Mark unread** action. Direct reference lookup is unchanged, and choosing **Keep** never opens the passage or creates another queue.

Connect an AI provider in **Your account** for generated marginalia and recommendations on specific topics. Direct reference lookup, chapter browsing, highlights, personal notes, time-based starter recommendations and a limited set of topic starters work without an AI key. After a provider is connected, the existing catch-up process can annotate passages previously skipped for lack of a provider. To retry manually, use the desktop toolbar's **Re-annotate with latest vault** button, or **More reading actions → Re-annotate** on mobile. Annotation jobs paused while Bible reading is off resume when you enable it and reopen the passage.

AI chooses references and writes commentary; it never supplies the Scripture text. Read its annotations and reflections as interpretation, check cross-references, and consider the surrounding context. Bible readings use the same saved summary, tags, annotation and reflection workflow as articles, grounded in the saved WEB source. Older Bible readings that were annotated without reflections are queued for reflection-only repair when reopened; existing marginalia, viewing/dismissal state, personal notes and answered reflections are preserved.

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
