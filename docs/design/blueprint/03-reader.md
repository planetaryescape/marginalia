# 03: Reader

The reader is where the product lives. It's built on the shared `@planetaryescape/reader` package plus Marginalia's own route, `apps/web/src/app/read/[articleId]/page.tsx`. This document says how the reader should look and feel in the concept's terms ([02](02-design-concept.md)). The behaviour it keeps is in [the reader guide](../../reader-guide.md). Rests on D-DES-017 through D-DES-023, D-DES-026 and D-DES-007.

## The page

The text column is the hero (principle 1). Its type, size, measure, leading, alignment and theme stay reader settings.

- **Title block:** title in `--type-title` scaled to the reader's size, then one meta line (source · minutes) in `--type-meta`. Nothing else above the text except front matter.
- **Drop cap:** stays a setting with its default unchanged. It's drawn in `--ink`, not `--pen`, because it is print, not the reader's mark (D-DES-020, Q10).
- **Links in the article:** ink with a `--pencil-rule` underline (D-DES-020).
- **The reader's marks:** highlights in `--highlighter`, underlines in `--pen`. These are the most saturated things on the page by design.
- **Lines that have a margin note:** no underline and no superscript number. On wide screens the note beside the line is enough. A faint kind dot sits at the end of the line's last word on phones only, where the margin doesn't exist (D-DES-026). Today's underline-plus-superscript treatment goes away; it turned every annotated line into a link.

## The margin

On screens where the right gutter is at least 300 px (`MIN_GUTTER` in `margin-card.tsx`), margin notes are **sidenotes**. They're always visible, quiet and set at their line's height (D-DES-019, Q6).

### Collapsed and open notes

A **collapsed note**:

```
───── • connection
      Your note on deep work from March
      makes the same claim. ¶14
```

- A 24 px connector in `--pencil-rule` from the text column's edge.
- The kind dot and kind name in `--type-label`.
- At most three lines of the note's first sentence in `--type-pencil`, `--pencil` colour.
- No box, no background and no close button.

An **open note** appears on click, Enter, or `o` on the current paragraph:

- The note grows in place into today's margin card, with its full text, quoted line, sources, follow-up and actions. It stays in the margin column at the column's width and never covers another note: the notes below slide down to make room (`--motion-move`, by transform) and slide back when it closes; the notes above don't move (D-DES-049).
- It gains a raised surface (`--surface-raised`, 10 px radius) because it now floats.
- The connector thickens to 1.5 px and the note's line gets a soft `--surface` wash in the text.
- Only one note is open at a time. Esc or a click on the page collapses it.

Your own notes and marks show in the margin too, in your pen. A note you wrote about a line gets a pen-coloured connector and your first line. A highlight or underline gets a 6 px pen tick at the line's height, so the margin is a record of both hands.

### Collisions

When notes would overlap, the later note moves down until it clears the one above, with an 8 px gap. Its connector bends with one elbow to keep pointing at its line. If a note would be pushed more than 240 px below its line, it collapses to a single line ("• question · ¶22") until its neighbour is closed.

S2 measured these rules (result in [09](09-open-questions.md#s2-result-2026-10-16)) and added three:

- **The three-line clamp is load-bearing.** A collapsed note is always about 70 px tall. Unclamped notes drift thousands of pixels at high density; clamped ones stay within one screen.
- **Notes whose lines sit within 40 px share one stacked note** with one connector. Several notes on one passage is the likely real pattern, and merging cut displaced notes from 51 to 12 in the clustered test.
- **Nothing hangs below the article.** If the last note would end more than one note-height below the article's last line, every remaining displaced note collapses to one line.
- **Layout is one measure-then-place pass**, rerun on resize and on type or theme changes, debounced to a frame. 531 notes relayout in about 5 ms, so there's no virtualisation. Anchor each note to the first client rect of its mark, not its paragraph.

### Arrival

Notes arrive as their line scrolls within 40% of the viewport. The connector draws (`--motion-move`), then the text fades in. A note arrives once per visit. Reduced motion shows notes already in place.

### While notes are still being written

If annotation is still running for the article, the first sidenote position shows a pencil line drawing itself, with "Reading alongside you…" in `--type-meta`. New notes arrive in place as they're stored. No toast.

## The paragraph map

Today's left-hand minimap stays, with three changes:

- Kind dots in kind colours.
- Pen ticks for the reader's marks.
- The current position as an ink bar.

Hovering the map shows "about 6 min left" in a tooltip. That replaces the toolbar's "~7 min left" counter, so the toolbar loses a piece of text (principle 5). On phones the map stays hidden, as today.

## Toolbar

Wide screens, top right:

```
 ← Desk                                                   Aa   ★   ♡   ⋯
```

- **← Back:** names where it returns to ("Desk", "Library", "Notes"), the place you came from.
- **Aa:** reading settings.
- **★:** rate. It opens the impression in the back matter, scrolled into view, rather than a popover.
- **♡:** love.
- **⋯:** Notes (also `n`), Summary, Listen, Mark unread, Copy link, Re-annotate (D-DES-023), Open original. Notes keeps its `n` key and its badge count; it moves into the overflow on wide screens because the margin now shows your notes in place.
- **Removed:** the GitHub link (D-DES-022) and the time-left counter (it moves to the map).

The toolbar fades to 0 opacity over `--motion-quick` once the reader scrolls 120 px into the text. It returns when the reader scrolls up, moves the pointer into the top 64 px, or presses Tab. The thin progress line at the very top stays, in `--ink-muted`, not pen.

Phones keep today's bottom bar, renamed to the glossary: **Ask · Notes · Listen · Done** (and **Mark unread** once finished). The top bar keeps ← Desk, the truncated title, Aa and ⋯.

## Front matter

"Summarize this article" stays above the text as one quiet line, not a bordered card: "Summary, key claims and a map, before you start →" in `--type-pencil`. Opening it expands in place, in pencil, above the text. It never covers the text.

It reads in order of increasing detail, so BK can stop at any layer (D-DES-047):

1. **The one point:** one sentence. Often enough to decide whether to read on. Always present; today `thesis` is optional in `summaries` and shown second, after the gist (`summary-panel.tsx`, origin/main `67798dc`).
2. **The short summary** (today's `gist`).
3. **The idea map.**

The idea map is designed, not just generated (D-DES-048). The model is told to keep it legible: about seven ideas at most, built mostly as a tree toward the conclusion, few cross-links, and nothing that adds lines without adding understanding. Layout uses a layered-graph library with crossing minimisation (dagre or elkjs) instead of today's single ordering pass (`idea-map.tsx#L61-L112`), and runs top-down when the map is long.

## Passage menu

The menu keeps its actions (Ask, Explain, Simplify, Define, Highlight, Underline, Note, Copy) and its `.reader-float` surface (D-DES-007).

- **Order by hand:** first the pen actions that mark the page (Highlight, Underline, Note), then a hairline, then the pencil actions that ask Marginalia (Explain, Simplify, Define, Ask), then Copy.
- **Highlight:** sweeps the selection (`--motion-sweep`) and adds a pen tick in the margin.
- **Explain, Simplify, Define and Ask:** each opens its answer as an open note in the margin beside the passage (on phones, in the flow below it), not in a separate panel. Answers write in pencil as they stream. ¶ references in an answer are links that scroll to and briefly wash the cited paragraph. These tools exist so BK never leaves the page to understand something (D-DES-039).
- **Kept answers mark their passage in pencil**, a faint `--surface` wash or a `--pencil-rule` underline, never in the highlighter colour. Today `companion-saved` marks look like BK's own highlights, which blurs whose hand is whose (D-DES-020, D-DES-051).
- **Answers are temporary until kept.** An answer stays in the margin while the article is open, including across a refresh, and disappears when the article is closed. **Keep** on the answer saves it to Notes. A follow-up doesn't keep it. Today every finished answer is saved automatically (`apps/web/src/lib/companion.ts#L204`); that changes (D-DES-045).
- **Length:** an answer is as long as it needs to be and no longer. A definition is a line; an explanation a short paragraph; Ask runs longer only when the question needs it (D-DES-042).

## Getting back to where you were

Every jump inside the article (a ¶ reference in an answer or card, the paragraph map, a summary or idea-map link) remembers where BK was reading. A quiet pencil chip, "↩ Back to ¶N", appears under the toolbar (above the bottom bar on phones) and returns him to that exact line. Jumps stack, so two jumps go back in two steps. The chip disappears once he's back, including when he scrolls back on his own; plain scrolling never adds an entry (D-DES-053).

## Links in the article

A link in the article never navigates on click (D-DES-044). It opens a small `.reader-menu` beside the link with the link's title (when known) and domain, then:

1. **Save for later:** imports the page into the library as Saved, which boosts it in picks (D-DES-040).
2. **Open in background:** last, and it opens a new tab without focusing it.

Modifier-click (⌘ or Ctrl) keeps the browser's own new-tab behaviour for people who reach for it deliberately.

## Connections and discovery

A connection note can point at an article in the library, read or unread, not only at a vault note (D-DES-040). Today a `cross_reference` must cite a vault note (`generateAnnotations.ts#L101`). A connection to an article shows that article's title and reading time and one action, **Save for later**. It is never a link, because following it would leave the page. Saved articles get a boost when picks are made, so the connection finds BK in a later session.

## Reading alongside

Annotation runs in two passes (D-DES-041):

- **On import,** as today (`actions/extractArticle.ts#L113`): the whole article, so the desk can offer it.
- **While reading:** when BK opens the article, and as he moves through it, Marginalia looks at the part ahead of him with what he has done so far (highlights, questions, notes) and adds notes there. The "Reading alongside you…" line marks where it's working.

The second pass runs only when something has changed (D-DES-046). Each article records when it was last annotated and a fingerprint of what the margin drew on: BK's notes and marks, the library articles it connected to, and the vault. On open, if nothing relevant has arrived since, the margin is current and no model call is made. If something has, only the new material and the passages ahead are annotated; existing notes stay where they are, so the margin never reshuffles under him.

Density replaces the fixed count (D-DES-042). Today the prompt asks for 3–7 notes and the code caps at 10 (`lib/constants.ts#L10`). The new budget is per length of text (for example, on average at most one note per screen of text), with the S2 layout rules keeping crowded passages calm.

## Ask about this article

The floating "Ask about this article /" pill stays on wide screens, but it must never cover a control. It hides while the back matter is in view, because the back matter has its own question prompt. That fixes today's overlap with Done ([01](01-current-state.md#small-breakages-at-the-end-of-an-article)). Its answers open as a margin note at the top of the article's margin, or below the title on phones.

## Notes panel

The side panel stays for the list of all notes on this article (`n`). It docks beside the text and never blocks the article: BK can scroll, select, highlight and start another note while it's open (D-DES-050). On phones it's a half-height sheet. Three changes remain:

- **Your words lead:** your text in `--type-ui` ink with a 2 px pen rule on its left. A saved AI answer is collapsed to its first line in pencil, with "Marginalia's answer" in meta, and expands on click.
- **Quoted lines** stay italic serif in `--ink-muted`.
- **"+ New"** becomes a quiet button. Focus is the global quiet ring (D-DES-004), never a square white outline.

## Finishing

The end of the article is back matter, in this order:

1. **"Before you go":** keep today's four prompts (strongest point, weakest assumption, counterview, question for you), in pencil, without circled glyph icons.
2. **Your impression:** stars with labels (D-DES-005), tags as quiet chips, "What stayed with you?" as a borderless field with a hairline under it.
3. **Done:** the single primary button of the back matter, solid ink.

Nothing moves on automatically (D-DES-038). The back matter is a pause for reflection; BK leaves when he chooses. A reflection he writes on an annotation or in "What stayed with you?" saves automatically, because it's his own writing (D-DES-045).

Pressing Done marks the article finished:

- The page fades over `--motion-page` to wherever the reader came from.
- On the desk, the next pick fills the slot (D-DES-010).
- No toast. The article simply isn't offered again.
- Auto-finish (end reached after 40% of the estimated time) shows a one-line "Finished · Mark unread" note at the bottom of the back matter instead of acting silently.

S4 checks that the top progress line reaches the end when it should.

## Phone specifics

- Margin notes unfold in the flow below their paragraph, indented 16 px with a 1 px pencil rule on the left. The paragraph stays in view above (D-DES-026, Q5). Tapping the dot again folds the note.
- The passage menu keeps today's two-column labelled phone layout.
- The bottom bar is the reader's chrome. Nothing else floats over the text except the passage menu.

## Done when (reader)

- At 1440×900, a heavily annotated article shows every margin note as a pencil sidenote at its line, with no overlaps, in all six themes.
- No element on the page uses `--pen` except the reader's own marks.
- The toolbar fades while reading and returns on scroll-up, pointer and Tab.
- Ask never covers a control at any scroll position, at both widths.
- Each key moment from [02](02-design-concept.md#key-moments) that this document touches (opening, a margin note arriving, marking, asking, finishing, waiting) is performed by hand and feels as described, including with reduced motion.
