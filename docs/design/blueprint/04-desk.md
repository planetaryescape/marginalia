# 04: Desk

The desk is the home screen, `apps/web/src/app/(desk)/page.tsx`. It asks one question and has one answer ready. It stays one screen with no scrolling at the tested desktop and phone sizes (D-DES-002). It offers only unread articles (D-DES-010), only ones that fit the time chosen (D-DES-034), and it must feel instant (D-DES-009). The desk exists so BK never faces the pile (D-DES-033): it answers "how much time do you have?" with one thing he can finish.

## Hierarchy

Above the fold there are at most six things, in this order of weight:

1. The question, "How much time do you have?", in `--type-display`.
2. The main slot: Continue, or the pick for the chosen time, or the best pick for no particular time.
3. The time choices.
4. The search field ("Ask, or paste a link").
5. ~~Up next~~: removed from the desk; it's a Library shelf (D-DES-035).
6. The date line in `--type-meta`. No backlog count: showing the size of the pile is the overwhelm the desk exists to remove (D-DES-034).
7. The header.

Off the desk (D-DES-021, D-DES-024):

- **The right-hand column** (From your notes, Recently rated, Where it comes from) is removed. Notes and ratings live in Notes and Library, and source status lives in the avatar menu ([06](06-sources-and-settings.md)). The desk uses the full 1180 px width, with the question and slot on the left two-thirds and the time choices and search beside the question on wide screens (see the mockup in [02](02-design-concept.md#desk)).
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

If the pick hasn't arrived within 150 ms, the slot shows its own skeleton (a title-width bar and a meta-width bar) in place. Never a centred loader, and never a page change.

## Continue

When an article is in progress, it takes the main slot at rest:

```
CONTINUE
A field guide to slow software                                   8 min left
▬▬▬▬▬▬───────────────────────────────
```

The progress bar is in `--ink-muted` with an ink fill. It's progress, not the reader's mark, so it isn't pen-coloured (D-DES-020). The minutes shown are what is *left*, so Continue answers the same question as the time choices. `c` opens the article. Choosing a time replaces Continue in the slot, and Esc brings it back.

## Up next

Three rows: serif title, then one meta line (source · minutes · "annotating" if annotation is still running). Rows are separated by hairline rules, with no boxes (principle 6).

The archive action (today's icon button) appears at the row's right on hover and on keyboard focus within the row. It's always visible on touch devices (`apps/web/DESIGN.md`: delete must be reachable by keyboard and touch). Archiving slides the row out (`--motion-move`) and shows the existing Undo toast.

## Topic search: the second way in

Typing a topic into the bar is the second way to the same moment (D-DES-036). It answers one article at a time, like a time choice: the best match, its reading time, and one pencil line on why it matches, with Read now, Another and Save for later.

- **Fast first.** Today the bar waits 600 ms after typing (`article-finder.tsx#L63`), then embeds the question, searches the library and asks a model to rank and explain the matches before showing anything (`http.ts#L488`). The first card comes from the search alone and appears at once; the model's explanation then fills the reason line on that card in place, without replacing the article. S5 measures today's latency and the target.
- **One at a time.** No list in the bar. The Library room keeps the full list for deliberate browsing (Q16).
- **With a time chosen,** a topic only offers articles that fit it, and says so when none do (Q14, Q15).

## Bringing your own

Sometimes BK knows exactly what he wants (D-DES-043). The bar takes three things: a topic, a URL (as today, `addArticleByUrl`) and a PDF (dropped on the bar, or picked as a file). An article he brings opens straight away, with the margin showing "Reading alongside you…" while its notes are written. PDF import is new: today the only PDF handling is Readwise sync skipping them (`actions/readwiseSync.ts#L21`). S7 settles extraction.

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

- The question in `--type-display` at its clamp minimum, then the slot, then the time choices as a row of four numerals, then search, then as many Up next rows as fit (today's behaviour on short screens).
- A bottom bar with four slots: Desk, Library, Notes, Search (D-DES-024).
- No date line on screens shorter than 700 px.

## Done when (desk)

- At 1440×900 and 390×844, in all six themes, the desk shows no more than the seven elements above, with no keycaps and nothing pen-coloured.
- Choosing a time shows the pick in the slot without leaving the desk. With a warm prefetch, the pick appears within 150 ms of the choice, measured on the deployed app (S3).
- Archive is reachable by keyboard and touch, slides the row out, and Undo restores it.
- The design gate in [02](02-design-concept.md#the-design-gate) passes for the desk's journeys 1 and 2.
