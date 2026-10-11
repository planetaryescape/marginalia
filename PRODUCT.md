# Marginalia product boundaries

Marginalia is a personal reading app: find something worth reading, read it with context, and keep the marks and thoughts that make the article useful later. This document records the product visible in the current implementation and the requests available from the development conversation. It is not a claim to recover decisions from conversations that are no longer available.

## Intended use

Use Home as a reading desk rather than a scrolling feed. Choose a time window, resume a piece, revisit a loved article, or search the library in natural language. Open an article to read, not to manage a queue.

The implemented inputs are RSS/Atom feeds, OPML subscriptions, pasted article URLs and optional Readwise Reader sync. The optional vault indexer adds Markdown notes to the contextual retrieval corpus; it does not edit the original vault.

Try the core path: **Home → search or time window → article → highlight or note → Notes/Library**.

## User-requested constraints

- Home stays wide, attractive and no-scroll at the representative desktop and mobile sizes tested during development.
- Search opens as a floating picker on click or `/`, explains its matches, accepts URLs and works with arrows, Enter and Escape.
- All main navigation destinations preserve the same header, theme and mobile navigation. Longer collections scroll inside that frame.
- Every task must remain keyboard accessible. Focus should be visible without a loud blue highlight.
- Ratings show stars and meaningful labels rather than relying on keyboard hints alone.
- Notes autosave and new note editors immediately focus.
- Preserve existing notes and reading activity while improving the app.

Verify these through [the reader guide](docs/reader-guide.md), the desk-layout tests and a desktop/mobile browser pass before changing their implementation.

## Implemented capabilities

- Reading: extracted article content, adjustable typography, themes, focus mode, paragraph navigation and browser speech synthesis.
- Context: cross-reference, context, tension and question annotations; passage Explain/Simplify/Ask; whole-article questions; summaries and idea maps.
- Memory: highlights, pen marks, notes, annotation reflections, saved companion conversations, loved articles and revisit scheduling.
- Library: semantic retrieval, conversational answers and explained search results.
- Impressions: a 1–5 rating, quick tags and a short personal note.
- Activity: reading sessions, engagement metrics and a weekly overview.

Use `?` in the app to discover the current keyboard map. AI output is assistance, not a verified factual source; inspect linked material and the original article.

## Boundaries, not silent commitments

The current implementation uses one `default_user`; that is an implementation limitation, not evidence that the user approved unauthenticated access forever. Authentication, rate limiting and a production/development data split need explicit follow-up decisions.

Do not turn a polish pass into a multi-user rewrite, replace the reading-first design, discard older saved content, or bulk-import a personal vault. See [decisions](docs/decisions.md) before making those changes.
