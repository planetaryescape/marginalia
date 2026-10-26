# Read the Bible in Marginalia

Enable **Your account → Bible reading → Enable Bible reading**. The setting is off by default and belongs to your account, not your browser or other readers.

## Find a passage

On Home, choose **Articles only**, **Articles + Bible**, or **Bible only** from **Look in**. Choose a reading-time button to constrain Bible suggestions, then use **Bible topic or passage** to add a topic or enter a reference. Article discovery keeps the existing floating search picker; in mixed mode the Bible finder appears alongside it, independently.

Try these searches:

- `Romans 8` opens a whole chapter.
- `John 3:16-21` opens a verse range.
- `5 minutes about forgiveness` suggests passages related to the topic and within the estimated time.
- `I have 10 minutes` offers starter passages without an AI request.

Use **Browse the Bible** below the Bible finder to choose any of the 66 books and a chapter. A passage can contain a verse range within one chapter, a whole chapter, or up to three consecutive chapters, such as `Matthew 5-7`. Chapter navigation in the reader continues into the next book.

In mixed mode, article results and Bible suggestions are retrieved independently. If one fails, the other remains usable. Bible-only mode hides the article search and recommendation slot.

## Read and annotate

Passages open in the existing reader. Select text to highlight it, write a note, or ask the companion a question. Your reading settings and saved-reading tools work there too.

Marginalia is generated only when you first open a passage. Opening it again reuses its text, annotations and notes. Each saved passage is keyed by its exact reference and translation: `Romans 8` and `Romans 8:1-10` are separate readings, even though their verses overlap. Marks and notes are not automatically copied between overlapping readings.

Connect an AI provider in **Your account** for generated marginalia and recommendations on specific topics. Direct reference lookup, chapter browsing, highlights, personal notes, time-based starter recommendations and a limited set of topic starters work without an AI key. After a provider is connected, the existing catch-up process can annotate passages previously skipped for lack of a provider. To retry manually, use the desktop toolbar's **Re-annotate with latest vault** button, or **More reading actions → Re-annotate** on mobile. Annotation jobs paused while Bible reading is off resume when you enable it and reopen the passage.

AI chooses references and writes commentary; it never supplies the Scripture text. Read its annotations as interpretation, check cross-references, and consider the surrounding context. Bible passages do not receive the article reader's argumentative-critique reflection box.

Turn Bible reading off in **Your account** to remove its discovery controls and block passage access. This does not delete saved passages or notes; enable it again to reopen them. Existing personal notes can still appear in your Notes collection.

## Translation and availability

This release offers the **World English Bible (WEB)**, a public-domain, relatively literal translation. ESV, NASB, NIV, NLT and The Message remain unavailable pending their provider connections and the permissions needed for this app's storage and AI features. They are never silently replaced with WEB. See the [direct access research](research/bible-direct-access.md) for provider-specific access and obligations.

Marginalia was registered on YouVersion on 26 October 2026. The portal shows the app as **In development** and an initial key exists. Biblica (NIV) and Lockman (NASB) fast-track agreements were available but have not been accepted. Public Domain and Creative Commons is the only confirmed active entitlement. Registration is not proof of permission to display or send copyrighted editions to AI, and the key has not been connected to the deployed app.

Text is fetched server-side, one chapter at a time, from [bible-api.com](https://bible-api.com/), then retained in your private library. The app checks the returned translation, book, chapter and requested verse endpoints before saving it. Scripture is escaped before rendering. No whole-Bible import or pre-annotation runs when you enable the feature.

The external text service is rate-limited and has no availability guarantee. New passages require a network connection; saved passages reuse their stored text. A busy or unavailable source produces an error and allows retry, never an AI replacement. A self-hosted, versioned WEB corpus is a possible later replacement for this dependency.

## Verify the integration

Run from the repository root:

```sh
bun run typecheck
bun run test
```

The Bible tests cover opt-in, reader isolation, source filters, saved notes and highlights, retrieval failures, translation restrictions, short-passage annotations and reference validation. The control tests cover disabled discovery and Bible-only search without article requests.

For browser verification, configure the web app's public Convex URL and sign in to a test reader. Check Home and Your account on desktop and mobile, open a passage, make a highlight and note, reopen it, then disable Bible reading and confirm its controls and search results disappear. Missing `NEXT_PUBLIC_CONVEX_URL` prevents the local app from loading; do not bypass authentication to run this check.
