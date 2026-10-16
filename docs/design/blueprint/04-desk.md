# 04: Desk

The desk is the home screen, `apps/web/src/app/(desk)/page.tsx`. It asks one question and has one answer ready. It stays one screen with no scrolling at the tested desktop and phone sizes (D-DES-002). It offers only unread articles (D-DES-010), only ones that fit the time chosen (D-DES-034), and it must feel instant (D-DES-009). The desk exists so BK never faces the pile (D-DES-033): it answers "how much time do you have?" with one thing he can finish.

## Hierarchy

The desk is one column, about 760 px wide and centred, read top to bottom (D-DES-064). Above the fold there are at most six things, in this order:

1. The date line in `--type-meta`. No backlog count: showing the size of the pile is the overwhelm the desk exists to remove (D-DES-034).
2. The question, "How much time do you have?", in `--type-display`.
3. The time choices, directly under the question.
4. The main slot, directly under the times: Continue, or the pick for the chosen time, or the best pick for no particular time. Choosing a time puts the pick right below the numeral that was clicked.
5. The search field ("Ask, or paste a link").
6. ~~Up next~~: removed from the desk; it's a Library shelf (D-DES-035).

The header sits above all of it. The phone order is the same.

Off the desk (D-DES-021, D-DES-024):

- **The right-hand column** (From your notes, Recently rated, Where it comes from) is removed. Notes and ratings live in Notes and Library, and source status lives in the avatar menu ([06](06-sources-and-settings.md)). The desk is one column (D-DES-064).
- **Keycaps:** removed from the surface. The keys still work (`1`–`4`, `c`, `j`/`k`, `/`).
- **Per-window counts** ("30 fit"): shown in a time choice's tooltip only.
- **"Worth revisiting"** shares the main slot instead of taking a second card. It shows only when there's no article in progress and no time chosen, as "Worth revisiting · loved 6 months ago", with "Not now" as a quiet text button.
- **"Press ? for keyboard shortcuts":** removed. `?` is in the avatar menu.

## Time choices

Four plain numerals in Newsreader (`5`, `10`, `20`, `30+`) with "min" in meta. There are no boxes and no descriptions on the surface; "Quick read" and "Coffee break" go to the tooltip. Hover or focus brings a `--surface` wash behind the numeral. A chosen time stays in ink while the others dim to `--ink-muted` (`--motion-quick`).

## Choosing time

Choosing a time keeps you on the desk (D-DES-028, Q12):

1. On hover or keyboard focus of a time, prefetch `suggestions.forWindow` for that window (S3).
2. On choose, create the session record as today. The main slot cross-fades (`--motion-move`) to the first pick:

   ```
   FOR 10 MINUTES
   The case for boring technology
   example.org · 9 min
   Short, and it answers the question you asked on Tuesday.      ← reason, in pencil

   Read now        Another        Save for later
   ```

3. **Only what fits.** Every pick is no longer than the window. When nothing fits, the slot says "Nothing fits in N minutes" and offers the shortest unread article as a labelled choice ("The shortest is 14 min"), or another time (D-DES-034). **Read now** is the slot's primary (solid ink). **Another** moves to the next article that fits, and keeps going until every fitting article has been offered (D-DES-031). It moves with a short horizontal slide (today's `direction` animation, re-timed to `--motion-move`). **Save for later** is quiet.
4. Esc, or choosing the same time again, returns the slot to its resting state.
5. `/session/[id]?m=` stays as a deep link and renders the desk in this state.

S3 found the wait is mostly the route change and the session mutation that precedes it, not the query (click to card 311–484 ms, of which 164–274 ms is `sessions.create` before `router.push`). So the pick renders on the desk from the prefetched query at once, and the session record is created in the background; nothing waits on it. If the pick hasn't arrived within 150 ms, the slot shows its own skeleton (a title-width bar and a meta-width bar) in place. Never a centred loader, and never a page change.

## Continue

When an article is in progress, it takes the main slot at rest:

```
CONTINUE
A field guide to slow software                                   8 min left
▬▬▬▬▬▬───────────────────────────────
```

The progress bar is in `--ink-muted` with an ink fill. It's progress, not the reader's mark, so it isn't pen-coloured (D-DES-020). The minutes shown are what is *left*, so Continue answers the same question as the time choices. `c` opens the article. Choosing a time replaces Continue in the slot, and Esc brings it back.

## Up next lives in Library

Up next is no longer on the desk (D-DES-035). It's a Library shelf ([05](05-library-notes-week.md#library)), and archiving moves with it: today the archive action exists only on the desk's Up next rows (`(desk)/page.tsx`, origin/main `de6f560`), so the rung that removes the rows from the desk adds the shelf with archive in the same release (D-DES-052).

On the shelf, each row is a serif title and one meta line (source · minutes · "annotating" if annotation is still running), separated by hairlines. The archive action appears at the row's right on hover and on keyboard focus, and is always visible on touch devices (`apps/web/DESIGN.md`: delete must be reachable by keyboard and touch). Archiving slides the row out (`--motion-move`) with the existing Undo toast.

## Topic search: the second way in

Typing a topic into the bar is the second way to the same moment (D-DES-036). It answers one article at a time, like a time choice: the best match, its reading time, and one pencil line on why it matches, with Read now, Another and Save for later.

- **Fast first.** Today the bar waits 600 ms after typing (`article-finder.tsx#L63`), then embeds the question, searches the library and asks a model to rank and explain the matches before showing anything (`http.ts#L488`). The first card comes from the search alone and appears at once; the model's explanation then fills the reason line on that card in place, without replacing the article. S5 measured 6.7–8.8 s from the last keystroke to the first result today; the target is a first card under 1 s after the debounce from a search-only path, with a `Server-Timing` header so the stages can be measured.
- **One at a time.** No list in the bar. The Library room keeps the full list for deliberate browsing (Q16, D-DES-052).
- **With a time chosen,** a topic only offers articles that fit it. When none do, it says so and offers the shortest article on that topic as a labelled choice (Q14, Q15, D-DES-052).

## Bringing your own

Sometimes BK knows exactly what he wants (D-DES-043). The bar takes three things: a topic, a URL (as today, `addArticleByUrl`) and a PDF (dropped on the bar, or picked as a file). An article he brings opens straight away, with the margin showing "Reading alongside you…" while its notes are written. PDF import is new: today the only PDF handling is Readwise sync skipping them (`actions/readwiseSync.ts#L21`). S7 settles extraction.

## Annotating only what you'll read

AI work is spent on what BK will realistically read (D-DES-056):

- **Articles of 20 minutes or less** are annotated at import, as today, so any 5, 10 or 20 minute pick opens with its margin ready.
- **Longer articles** are annotated ahead of picking. When BK chooses 30+, or a topic search offers a long article, Marginalia starts annotating and summarising the first three candidates while it shows the first card, and keeps three ahead as he presses Another. Read now before they're ready opens with "Reading alongside you…", and notes arrive as he reads.
- **A long article is offerable before it's annotated.** Today picks require `annotationStatus: "annotated"` (`suggestions.ts`); that changes for long articles, whose reason line comes from length and source until notes exist.
- **Later, taste decides.** Once Marginalia has learned what BK reads (D-DES-057), it annotates likely reads ahead of time as well.

## Books in picks

A book is offered by its next section, never by a section that merely fits (D-DES-055): "Chapter 4 of *X* · 12 min", and only when chapter 4 is the one after the last BK read. Continue shows the minutes left in the current section.

## Saved gets a boost

Saved is the reading list (D-DES-040). Among articles that fit the window, a saved one wins when it's close, so things BK saved from a margin connection or a link come back to him. A boost never breaks "only what fits" (D-DES-034). Today `suggestions.ts` ignores Saved.

## Search field

A quiet field-shaped button with the glass icon and "Ask, or paste a link". It opens the floating picker (D-DES-003), which keeps its behaviour. The picker's restyle:

- A raised surface with one input.
- Results as rows (title, then the reason in pencil).
- No keycaps except a single "esc" hint at the right of the input.

## First open, empty and error

- **First open of the day:** the slot's content fades up 8 px (`--motion-move`). Nothing else moves.
- **Empty library:** the question stays. The slot reads "Nothing to read yet. Add a source, or paste a link with `/`", with one primary button, **Add a source**, that opens Sources.
- **Everything read:** "You've read everything waiting. New articles arrive as your sources update." The slot is quiet, with no button.
- **Failure loading the desk:** in place in the slot ("Couldn't load your desk. Retry"). The header and search still work.

## Phone (390×844)

- The question in `--type-display` at its clamp minimum, then the slot, then the time choices as a row of four numerals, then the bar. Nothing else.
- A bottom bar with four slots: Desk, Library, Notes, Search (D-DES-024).
- No date line on screens shorter than 700 px.

## Done when (desk)

- At 1440×900 and 390×844, in all six themes, the desk shows no more than the six elements above, with no keycaps and nothing pen-coloured.
- Choosing a time shows the pick in the slot without leaving the desk. With a warm prefetch, the pick appears within 150 ms of the choice, measured on the deployed app (S3).
- Archive is reachable from Library's Up next shelf by keyboard and touch, slides the row out, and Undo restores it.
- The design gate in [02](02-design-concept.md#the-design-gate) passes for the desk's journeys 1 and 2.
