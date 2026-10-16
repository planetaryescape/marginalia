# 05: Library, Notes and Your reading

These are the rooms besides the desk (D-DES-024): Library, Notes, and Your reading (D-DES-060). **Library** is everything you have, and **Notes** is everything you kept. Today they're spread across five destinations: Library, Saved, Notes, This week and the Library impressions column. Behaviour stays. What changes is where things live, and how they look in the concept's terms ([02](02-design-concept.md)).

## Library

Library asks "What are you looking for?" and keeps your shelves.

```
 Library

 What are you looking for?
 ┌──────────────────────────────────────────────────────────┐
 │ That piece about cows last month… or something about science │
 └──────────────────────────────────────────────────────────┘
 Try "what did I love recently?" or "a short read for tonight"

 Up next 130     Saved 1     Loved 14     Finished 212
 ──────────────────────────────────────────────────────────────
 The case for boring technology          example.org · 9 min      ★★★★☆
 On writing in the margins               example.com · 6 min
```

- **The ask field** keeps its behaviour (library search and conversational answers). Answers write in pencil below the field, with each cited article as a row.
- **Example prompts:** two, as a plain line of text whose quoted parts are clickable, not four pill buttons (principle 5).
- **Shelves** are tabs, as text with a count in meta: Up next, Saved, Loved, Finished. **Saved** moves here from its own nav item (D-DES-015). `/saved` redirects to Library with the Saved shelf selected.
- **Rows** follow the shared row pattern. Ratings show as **stars**, not squares (D-DES-005). That replaces `RatingMarks` in `library/page.tsx`. Stars are drawn in `--ink-muted`, filled in `--ink`, because a rating is a judgement, not a mark on the page.
- **Your impressions** (today's right column) becomes the Finished shelf's rows, each with stars and the "what stayed with you" line in pencil underneath.

## Notes

Notes is your commonplace book: every note and mark you made, grouped by article, newest first. Your week moved to its own room, Your reading (D-DES-060), so Notes is only the commonplace book.

```
 The quiet cost of interruptions                          example.com
 ──────────────────────────────────────────────────────────────
 ┃ "Every interruption costs more than its own length…"        ← quoted line, italic serif, muted
 ┃ This matches what I see on meeting-heavy days.              ← your words, ink, pen rule
 ┃ Marginalia's answer · Explain ▸                              ← collapsed, pencil
   Oct 15
 ▍"…most days are cut into pieces too small to return"         ← a highlight, in your highlighter
```

- **Only what was kept.** Marginalia's answers appear here only when BK pressed **Keep** (D-DES-045). His own notes and reflections are always here.
- **Your words lead.** A note is your text in `--type-ui` ink with a 2 px pen-coloured rule. Saved AI answers collapse to one pencil line ("Marginalia's answer · Explain ▸") and expand in place. Today both sit in the same box at the same weight ([01](01-current-state.md#collection-pages-are-boxes-in-two-thirds-of-the-page)).
- **Highlights and underlines** appear under their article in the reader's highlighter and pen. Today Notes shows only notes, and marks are invisible outside the reader. This makes journey 4 ("Keep this") end somewhere.
- **No boxes:** articles are separated by space and a hairline. Each note row is the hand's rule, not a card.
- **Clicking a note** opens the article at that line with the note open in the margin. The hand-off keeps the line, the note and the pen colour.

Showing marks in Notes needs one new paginated query over the `highlights` table's `by_userId` index. It's the one data-side addition in this document. Today Notes reads only `userNotes.listAll`, and `highlights` exposes only `listByArticle` (origin/main `bc23f5e`).

Each highlight document carries a 1536-dimension `embedding`. That's the same bytes-read problem the 2026-10-15 performance pass found with `articles`, so the query must paginate and must not return the embedding. If that isn't cheap, ship Notes without marks first and add them in the next rung ([07](07-roadmap.md)).

## Your reading

A room of its own, reached from the header and never linked from the reader or the Notes pane, because looking at your stats while reading is a distraction (D-DES-060). It replaces "This week" (`/reading`) and grows out of its charts (`components/dashboard/`). Two parts:

### Stats

A mirror, not a scoreboard (D-DES-057): no streaks, goals or nudges. Real graphics, built with the `dataviz` skill's rules:

- When BK reads: hour of day by day of week, short against long.
- What he reads: topics from tags (D-DES-059), as a topic map he can click into, with what he finishes, lingers on and skips.
- Where he lingers: time per paragraph, grouped by topic.
- How he reads: time choices made, Another presses, finishes, abandons.
- His sources: per feed, offered against opened against finished, with a quiet "you skip most of this feed; unsubscribe?" that he decides on in Sources.

### Dictionary

Every word BK looked up, laid out like a printed dictionary (D-DES-058): headwords in alphabetical order with thumb-index letters down the side and a search field; each entry gives the word, its part of speech, the sense he met it in, the sentence he met it in (in italic, with its article), and when. A word met twice shows both senses. Opening an entry's sentence takes him to that line in the article.

Lookups are recorded on every Define, whether or not BK kept the answer (D-DES-045 makes answers temporary; the record of the lookup is his, not Marginalia's answer).

## Your week (inside Your reading)

Today's "This week" / "Activity" / "Reading activity" page becomes the opening view of the Your reading room (D-DES-060), renamed once.

- **Lead with a sentence:** "You read for 44 minutes on 4 days this week and finished 3 articles." Below it, the period selector as a quiet text control ("This week ▾").
- **The rhythm chart** stays: daily bars in `--ink-muted`, today's bar in ink, with no pen colour. Use the `dataviz` skill's rules when restyling it.
- **"What you kept"** becomes rows of the week's notes, linked to Notes, not counters ("5 Notes · 0 Reflections · 12 Annotations opened"). The counts move into the sentence.
- **The tracking caveat** ("Some older visits weren't fully tracked…") becomes a footnote in `--type-meta` at the bottom, not a paragraph under the stats.

## Done when (rooms)

- The header shows Desk (wordmark), Library, Notes and Your reading, and the phone bar shows Desk, Library, Notes and Search. `/saved` redirects to its new home and `/reading` is the Your reading room, with old links still working.
- Ratings render as stars everywhere they appear.
- In Notes, your words are visibly first, AI answers are collapsed, and clicking a note lands on its line with the note open.
- All six themes at both widths pass the design gate in [02](02-design-concept.md#the-design-gate), including journey 3 ("What did I think about X?") and journey 4 ("Keep this").
