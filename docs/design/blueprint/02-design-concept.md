# 02: Design concept

This document decides what Marginalia is to the person using it and how it should feel. Every screen in [03](03-reader.md)–[06](06-sources-and-settings.md) is written in its terms. It exists because Marginalia's features were each built to spec and the whole was never designed (D-DES-001). A builder who follows only the behaviour sections will rebuild today's app. This document is what's different.

The concept below was the blueprint's proposal, built on BK's words and the code's own vocabulary, and BK confirmed it (D-DES-018, D-DES-029). It rests on the foundation in [00](00-overview.md#the-foundation-ai-as-a-thinking-partner): AI as a thinking partner (D-DES-051). Pencil and pen are that partnership made visible: Marginalia's contributions look like suggestions, BK's look like his.

## What this is to the person

Marginalia is the cure for the read-later pile. In Readwise Reader BK landed on "a tonne of articles I need to read and i dn't know where to start" (D-DES-033). Marginalia asks how much time he has and hands him one thing he can finish in it, because "sometimes I just have 5 mins to read and I don't want to start soemthing and then be stopped midway". In his words, it's "a better way to get something to read and read it". The pile exists, but he never has to look at it.

He reaches for it three ways: with an amount of time, with a topic he feels like reading about (D-DES-036), or with the thing itself, a link or a PDF (D-DES-043). Each way ends in one article offered with its reading time, never a list.

Once he's reading, Marginalia is where he reads things worth reading, with a second voice beside the text. Its job is to keep him there, reading and reflecting, and to keep him from believing a well-written author too easily (D-DES-037). In his words: "When an article has been selected, the reader should optimise to keep me there and keep me reading and keep me reflecting on this article and it's connections to other things I've read and importantly, help me not be too impressionable by telling me about tensions, counterpoints, showing me logical fallacies, etc. That's why I love that bottom section so much because sometimes when I read an article that's written well, i believe the author too much because of recency bias and just being enamoured about a well written thing." That voice is a well-read friend who knows his notes, has read the article and leaves pencil notes in the margin: "this connects to what you wrote in March", "this claim is contested", "here's the question this raises". He reaches for it when he has a slot of time, five minutes or half an hour, and wants to spend it on something good rather than on a feed.

He doesn't come to manage a queue, configure sources or look at statistics. Those exist so that reading can happen. He leaves wanting to feel two things: *I read that well*, and *I kept something from it*. A highlight, a note or a rating is how the second one happens.

The objects in his head are the ones a reader has always had: a desk, a page, a margin, a pencil, his own pen, a shelf of things read, and a commonplace book of what stayed with him. The code already uses two of these words. The reader picks a **pen** colour and a **highlighter** colour (`@planetaryescape/reader` settings: cobalt, vermilion, forest, graphite).

## The concept

**Print, pencil and pen.** Three hands write on every page, and each has its own voice:

- **Print** is the author. Newsreader, in ink, at the reader's chosen size and measure. It's the hero, and nothing covers it.
- **Pencil** is Marginalia. Notes in the margin beside the line they're about, in a smaller sans in a soft graphite tone, with a small coloured dot naming the kind of note. Pencil is quiet, a little lighter than print, and easily ignored. It never shouts over the author. Its character is a critical friend: it leans toward pushback, close to balance, says where the argument is strong as well as where it is weak, and is exactly as long as it needs to be (D-DES-038, D-DES-042).
- **Pen** is the reader. Highlights, pen underlines, notes, ratings and reflections, in the colour the reader chose. The pen colour belongs to the reader alone, so their own marks are the most vivid thing on the page.

The material is paper under a reading lamp: warm, matte, still. Paper and Sepia are daylight paper. Night, Dusk and Ink are the same page under a lamp at night, not an inverted screen (D-DES-007). The mood is a quiet library desk with a good book and a good pencil.

The concept fits this product and not just any product because the product is literally named for the pencil. It also settles arguments a builder would otherwise settle by habit:

- Should this be coloured? Only if it is someone's mark.
- Where does this go? Next to the line it's about, or at the front or back of the article, the way a book has front and back matter.
- How loud should it be? Print, then pen, then pencil, then chrome.

## How the whole fits together

### The mental model

These are the words the reader thinks in. Every screen, button, empty state, toast and doc uses these words and no others.

| Word | Means | Replaces today's |
|---|---|---|
| **Desk** | The home screen, where you choose what to read next | Home |
| **Article** | One piece of writing | "piece", "document", "item" |
| **Up next** | Unread articles waiting, as a Library shelf; the desk offers one at a time and never shows the shelf (D-DES-035) | queue, "fit" |
| **Margin note** | A note Marginalia wrote beside a line, of one of nine kinds in three families ([Note kinds](#note-kinds)) | annotation, cross-reference, "open note" |
| **Marks** | Your highlights and pen underlines | highlight, pen mark |
| **Note** | Something you wrote, about a line or the whole article | user note |
| **Impression** | Your stars, tags and "what stayed with you" after reading | rating, impressions |
| **Library** | Every article you have, with shelves: Up next, Saved, Loved, Finished | Library, Saved |
| **Notes** | Your commonplace book of notes and marks | Notes |
| **Your reading** | The room that shows BK his own reading: stats, topics and his dictionary (D-DES-057, D-DES-060) | This week, Activity, Reading activity |
| **Dictionary** | Every word BK looked up, as a dictionary: headwords, the sense he met, the sentence he met it in (D-DES-058) | (new) |
| **Tag** | A topic Marginalia gave an article, from a vocabulary that resists growth (D-DES-059) | (new) |
| **Sources** | Where articles come from: feeds, Readwise Reader, links, the API | Sources, feeds |

Margin notes come in nine kinds in three families (D-DES-038, [Note kinds](#note-kinds)), named in plain words in the interface: "connection", never "cross-reference".

### The map

```
                      ┌─────────────────────────── Desk  / ───────────────────────────┐
  `/` anywhere ──────▶│  the question · the next read · the bar                       │
  search picker       └───────────────┬───────────────────────────────┬───────────────┘
  (floats over any                    │ open an article                │ rooms (header)
   room, never a page)                ▼                                ▼
                      ┌──── Reader  /read/:id ────┐        ┌── Library ──┐  ┌── Notes ─────────┐
                      │ front matter · page ·     │        │ ask · shelves│  │ notes · marks ·  │
                      │ margin · back matter      │        │ Up next      │  │ Your week        │
                      │ Esc / Back → where you    │        │ Saved · Loved│  └──────────────────┘
                      │ came from                 │        │ Finished     │
                      └───────────────────────────┘        └──────────────┘

  Your reading (header, after Notes): stats · dictionary. Never linked from the reader (D-DES-060).
  Account menu (avatar, top right): Sources · Readers (owner) · Account · Install app · Keyboard · About
```

- **Always present on desk-frame pages:** the header with the wordmark, three rooms (Desk is the wordmark) and the avatar menu. On a phone, a four-slot bottom bar: Desk, Library, Notes, and a search button that opens the picker.
- **Replaces the page:** the reader. It's a separate frame with its own toolbar, because reading is a different posture.
- **Opens on top:** the search picker, the account menu and the reader's settings. Each closes with Esc and returns focus where it was (`useModalDialog`).
- **Opens beside, never blocking:** the reader's notes pane docks beside the text, and the article stays usable while it's open (D-DES-050). Answers and summaries open in the margin and front matter, not on top.
- **Getting back:** Esc or Back in the reader returns to the exact room and scroll position you came from, not always to the desk.

### The journeys, end to end

1. **"I have ten minutes."**
   - The reader opens the desk and sees one question.
   - They choose 10 (or press `2`), and the desk's main slot fills with one pick and the reason it fits (D-DES-028).
   - They open it, and the title travels from the slot to the top of the page (S1).
   - Margin notes are already in the margin.
   - At the end, back matter offers an impression. Done lays the article down: it's finished, and the desk offers the next pick.
   - *What carries over:* the time chosen (the pick's length), the article's place, and where you came from.
2. **"Pick up where I left off."** The desk shows the article in progress in the main slot, above the time choices, as "Continue". Opening it restores the exact paragraph, and the paragraph map shows the place.
3. **"What did I think about X?"**
   - `/` opens the picker from anywhere. The reader types a half-memory.
   - Results explain why they match (D-DES-003). An article opens in the reader. A note opens in Notes, scrolled to that note, with its article one click away.
4. **"Keep this."** While reading:
   - Select text, and the passage menu offers Highlight, Note, Explain, Define and Ask.
   - A highlight appears instantly in the pen colour, and the margin gains a small pen tick at that line.
   - Later, the mark is in Notes under the article, in the same pen colour.
5. **"Add where my reading comes from."** Avatar menu, then Sources: paste a feed URL, connect Readwise with a token, or import OPML. Each source shows one status line and is then forgotten (D-DES-012).

The hand-offs must not break: the same article title, the same pen colour and the same kind names on the desk, in the reader, in search results and in Notes.

### Shared patterns

A new feature reuses these. It doesn't invent its own.

- **Pick something:** a row (title in serif, one meta line in sans). Rows are separated by hairline rules, not boxed. Hover or focus shows a soft surface behind the row, never a coloured title.
- **Primary action:** one per view, a solid ink button (ink fill, page-coloured text), like "Add a passkey" today. Everything else is a quiet button (text in ink-soft on a chip surface). Links are underlined text in ink, never pen-coloured.
- **Destructive action:** a quiet button that turns to a confirm ("Remove? Yes / Keep") in place. Removals that can be undone don't confirm; they toast with Undo (today's Archive pattern).
- **Confirm a change:** saving is silent and immediate. A small "Saved" fades in at the place the change happened, never in a corner toast.
- **Show "this changed":** a 600 ms surface wash at the changed row.
- **Waiting:** a skeleton in the shape of the real layout, never a centred spinner or a pulsing line. For model work, a pencil line that writes itself (see [Key moments](#key-moments)).
- **Errors:** in the place where the action was, in one sentence that says what happened and what to do, with Retry beside it. Toasts only for background work that has no place on screen.
- **Keys:** the keyboard map is complete (D-DES-004), and hints are hidden by default (D-DES-021). Every control's tooltip shows its key. `?` shows the map. Holding `Alt` (or `⌥`) for 400 ms overlays keycaps on the visible controls.
- **Status:** one line of meta in sans muted, with a dot in a status colour only when something is wrong or in progress.

### Across surfaces

The surfaces are the desktop web app, the installed phone PWA, the API that other apps send articles through, and toasts and status lines.

- **Same words:** the glossary above, in UI copy, toasts, API error messages and docs.
- **Same states:** an article is Up next, Reading, Finished or Archived everywhere, with the same labels.
- **Same sentences:** a failure reads the same in a toast, on Sources and in an API error. For example: "Readwise didn't respond. Marginalia will try again in 10 minutes."
- **The phone isn't a shrunken desktop.** The margin folds into the text flow (D-DES-026). The rooms move to a bottom bar. The reader's toolbar moves to the bottom, where the thumb is (today's bottom bar: Ask, Notes, Listen, Finish).

### The system's own state

The reader always knows, without asking:

- **What's saved:** everything is saved as you go. A note's "Saved" mark appears beside it. A failed save stays visible with Retry (current behaviour, D-DES-006).
- **What's still being annotated:** an article whose margin notes are still being written shows a pencil line writing itself in the margin, top right. In Library's rows, it says "annotating" in muted meta.
- **Where sources stand:** one line in the avatar menu ("Synced 12 min ago"), and a status dot on the avatar only when a source has failed.

## Principles

1. **The page is the hero.** In the reader, nothing overlaps the text column except a menu you asked for. Chrome fades after reading starts and returns when you scroll up or move the pointer to the top.
2. **Colour belongs to a hand.** Ink for print and chrome, graphite plus kind dots for pencil, the reader's pen colour for the reader's own marks only (D-DES-020). If an element isn't someone's mark, it isn't coloured.
3. **Beside the line, or at the ends.** Things about a passage live in the margin next to it. Things about the whole article live in front matter (summary, map) or back matter (impression, "Before you go"). Not in floating panels when a place on the page exists.
4. **One question per screen.** The desk asks "How much time do you have?" Library asks "What are you looking for?" Each room has one primary action, and everything else recedes.
5. **Calm by default, detail on demand.** Counts, keycaps, sync details and statistics are one gesture away, not on the surface.
6. **Rules, not boxes.** Group with space and hairline rules. A border earns its place only around something that floats or something you type into.
7. **Instant is a feeling.** Respond within 100 ms with the real layout: an optimistic state, a prefetched pick, a title already moving (D-DES-009). A loader is a design failure, not a default.
8. **Settings are boring on purpose.** Sources, Account and Readers share one form pattern and no personality, so the personality goes to reading.

## Key moments

| Moment | What the reader should feel | The interaction that makes it land |
|---|---|---|
| First open of the day | "There's something good waiting, and I don't have to choose from a pile." | The question in large Newsreader and the date. No backlog count anywhere on the desk (D-DES-034). Below it, the Continue or best pick, already chosen. Nothing animates except the pick fading up 8 px over 240 ms. |
| Choosing time | "It understood me, and I'll finish this." | The chosen time stays lit and the others dim. The main slot cross-fades to the pick with its reason in pencil ("Short, and it answers the question you asked on Tuesday"). The pick was prefetched on hover or focus (S3), so it lands under 150 ms. |
| Opening an article | "I'm in." | The title morphs from the desk row into the reader heading (View Transitions, S1). The header chrome dissolves, and the page settles. Fallback: a 200 ms fade. |
| A margin note arriving | "Someone read this with me." | As the line scrolls into view, the note's connector draws from the line's end into the margin (240 ms), then the text fades in. Each note arrives once. It doesn't redraw on scroll back. |
| Marking a passage | "That's mine now." | The highlighter sweeps left to right across the selection (180 ms) in the reader's colour. A small pen tick appears in the margin at that line. |
| Asking | "A good answer, beside the text." | The answer writes into the margin card in pencil, beside the passage, with ¶ references that scroll and pulse the paragraph they cite. |
| Finishing | "Done. That was worth it." | At the end, back matter appears ("Before you go", impression stars). Pressing Done gives a soft page-turn fade back to the desk. The next pick slides into the slot. No confetti and no streaks. |
| Looking something up | "I understood it and kept going." | Define, Explain, Simplify or Ask writes its answer in pencil in the margin beside the passage. Nothing opens elsewhere. The answer stays while the article is open, even across a refresh, and a quiet **Keep** saves it to Notes (D-DES-039, D-DES-045). |
| A link in the article | "I can follow that later." | Clicking a link opens a small menu with the link's title and domain: **Save for later**, then **Open in background** last. Nothing navigates (D-DES-044). |
| A connection to another article | "I'll read that one day." | A connection note names the other article with its reading time and offers **Save for later**, never a link. Saved articles come back to you as picks (D-DES-040). |
| Waiting on model work | "It's working; I can keep reading." | A pencil line writing itself in the margin. Never a spinner on the page and never a blocked page. |
| Something failed | "I know what happened and what to do." | One sentence in place, in ink, with a small terracotta dot and Retry. The rest of the page keeps working. |
| Empty (new reader, no sources) | "I know the one step to take." | The desk asks the question anyway. Under it: "Nothing to read yet. Add a source, or paste a link with `/`." One primary button: Add a source. |

## Visual language

### Type

Families are unchanged (D-DES-017): Newsreader for print and headings, DM Sans for pencil and controls, JetBrains Mono for keys only. Literata and Atkinson Hyperlegible stay as reading options.

| Token | Size / line | Family, weight | Use |
|---|---|---|---|
| `--type-display` | clamp(48px, 6vw, 72px) / 1.02, −0.02em | Newsreader 300 | The desk question, room titles |
| `--type-title` | 32px / 1.15 | Newsreader 400 | Article title in the reader (scales with reader size) |
| `--type-heading` | 22px / 1.25 | Newsreader 400 | Section headings inside rooms |
| `--type-row` | 18px / 1.35 | Newsreader 400 | Article titles in rows |
| `--type-ui` | 15px / 1.45 | DM Sans 400 | Controls, body UI copy |
| `--type-pencil` | 14px / 1.55 | DM Sans 400 | Margin notes, reasons, AI answers |
| `--type-meta` | 13px / 1.4 | DM Sans 400 | Meta lines, timestamps |
| `--type-label` | 11.5px / 1.2, +0.08em, small caps | DM Sans 500 | Section labels (rare) |

Article body size, measure and leading stay reader settings (14–28 px).

### Colour

Each theme keeps its existing `--reader-*` values. Two semantic layers are added on top, and every component uses these names:

| Token | Meaning | Paper | Night |
|---|---|---|---|
| `--ink` | Print and chrome text (= `--reader-fg`) | `#201d1b` | `#f3f1ef` |
| `--ink-soft` | Secondary text (= `--reader-fg-soft`) | `#3b3733` | `#dcd7d2` |
| `--ink-muted` | Meta (= `--reader-muted`) | `#70675f` | `#a3968c` |
| `--pencil` | Marginalia's voice: margin notes, reasons, answers | `#5e5751` | `#bdb3aa` |
| `--pencil-rule` | Margin connectors and rules | ink at 18% | ink at 22% |
| `--pen` | The reader's chosen colour; their marks only | unchanged | unchanged |
| `--highlighter` | The reader's highlight | unchanged | unchanged |
| `--kind-connection` / `-context` / `-tension` / `-question` | Margin-note kind dots | existing `annotation.*` | lightened 15% for dark |
| `--danger` | Failure dot and destructive confirm | `#b0503a` | `#e07a5f` |
| `--surface` / `--surface-raised` | Rows on hover, floating menus | `--reader-chip` / `--reader-surface` | same |

Contrast: `--pencil` must reach 4.5:1 on `--reader-bg` in every theme. Check all six, not only these two. Prose links become ink with an underline in `--pencil-rule`; they turn ink-underlined on hover (D-DES-020).

New readers get `theme: "auto"`, which follows the operating system. That's already the default in `@planetaryescape/reader`.

### Note kinds

Margin notes come in three families, each with one colour family, and the kind's name always shows on the note (D-DES-038):

| Family | Kinds | What it does |
|---|---|---|
| Pushback | tension (counterpoint), fallacy, assumption, unsupported, other explanation | Slows premature agreement: a conflict, a reasoning error, an unstated premise, a claim without evidence, another cause that fits the same facts |
| Support | strong point, crux | Says what survives: where the argument is well made, and the claim the rest depends on |
| Connection | connection, context, question | Relates the passage to BK's notes and library, adds context he wouldn't have, or asks him something |

The mix leans toward pushback, close to balance. Pushback family colours are the warm end of the existing annotation palette (terracotta), support the sage end, connection the slate and purple. Exact values are set in rung 2c with the contrast test from rung 1.

### Tags

Marginalia gives each article one to three topic tags in the import call, from a vocabulary that resists growth (D-DES-059):

1. Seeded from BK's own vault tags (`noteChunks.tags`), so topics are named his way.
2. The call chooses from existing tags first, and may propose a new one only with a reason.
3. A proposal is compared by embedding against tags and their aliases; a near match becomes that tag and the new name becomes an alias.
4. A genuinely new tag starts as a hidden candidate and becomes real only after it recurs (for example on three articles); until then the article also gets its nearest existing tag.
5. Drifting tags are suggested for merging ("'Hiring' and 'Interviewing' cover the same 14 articles. Merge?"); BK decides.

Tags are Marginalia's labels, so pencil; BK's impression reactions ("Made me think") stay his, in pen. S9 sets the similarity threshold. Tags give topic search an instant first card (D-DES-036), the topic map in Your reading, and taste.

### Materials and depth

The page is flat paper. Floating things (the search picker, menus, the margin card when expanded, the passage menu) are the only raised surfaces:

- Light themes use one shadow, `0 12px 32px -16px rgb(0 0 0 / 0.25)`, with a 1 px `--reader-border`.
- Dark themes use `--reader-surface` with a 1 px `--reader-border-strong` and no shadow (`.reader-float`, D-DES-007).
- Radii: 6 px for controls, 10 px for floating surfaces, full for pills. No 16 px-radius cards.

### Iconography

Lucide, as today, at 1.5 stroke and 18 px in toolbars and 16 px inline. Icons appear only where a word would be worse, and an icon-only button always has a name (`apps/web/DESIGN.md`). The desk uses no icons except the search glass.

### Density

Calm. The desk shows at most six things above the fold ([04](04-desk.md#hierarchy)). Rows get 14–16 px vertical padding. Room pages run to 1180 px, with the main column 680 px and a 320 px side column used on purpose, or not at all.

## Motion

Motion explains a change of place or state. It never decorates (`apps/web/DESIGN.md`).

| Token | Duration | Easing | Used for |
|---|---|---|---|
| `--motion-press` | 90 ms | ease-out | Button and row press |
| `--motion-quick` | 160 ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Menus, tooltips, dimming siblings |
| `--motion-move` | 240 ms | same | Margin note connector and arrival, the pick filling the slot, rows leaving |
| `--motion-page` | 320 ms | `cubic-bezier(0.4, 0, 0.2, 1)` | Desk ↔ reader transition, title morph |
| `--motion-sweep` | 180 ms | linear | Highlighter sweep |

Reduced motion (`prefers-reduced-motion: reduce`): every move becomes a 120 ms opacity fade or nothing. The title morph becomes an instant swap, the sweep becomes the final highlight, and the connector appears already drawn. Nothing the reader needs is hidden behind an animation that hasn't finished.

## Hierarchy and restraint

| Screen | Primary | Secondary | Hidden until asked | Left off, and why |
|---|---|---|---|---|
| Desk | The question; the one pick or Continue | Time choices; the bar | Keycaps; counts per window; sync detail; "Worth revisiting" when Continue is shown | The right-hand timeline (notes, ratings, sources): it's Notes' and Library's job, not the desk's |
| Reader | The text | Margin notes in pencil; the paragraph map | Toolbar (fades while reading); rating; love; settings | GitHub; re-annotate (overflow menu); time-left counter (in the map's tooltip) |
| Library | The ask field | Shelves; results | Filters | Example prompts as four pill buttons: show two, as plain text |
| Notes | Your words | The line each is about; the article | AI answers you saved (collapsed to one line) | Boxes around every note |
| Settings | The one thing each section sets | Status lines | Technical detail (document counts, phases) | Seven button styles |

## Taste references

BK confirmed these references (D-DES-029). Each is here for one quality, not its features.

- **Tufte-style sidenotes (tufte-css) and gwern.net.** Notes set beside the line they belong to, in the margin the page already has. We take the sidenote placement and the quiet secondary voice. We don't take gwern's density or popups-within-popups.
- **iA Writer.** Type does the design work. Chrome disappears while you work and returns when you reach for it. We take the fading chrome and the confidence of one typeface at a few sizes.
- **Things 3.** Calm, one accent, and small moments that land (the checkbox, the item sliding away). We take "finishing is a felt moment" and the single-accent discipline.
- **Readwise Reader**, as a counterexample. BK imports from it, and Marginalia replaces part of its job. Its strength is completeness. Its cost is a screen where every feature is visible at once. We take its keyboard completeness and leave its density.
- **A well-used paperback with pencil notes.** The physical model behind the concept: the author's print untouched, a reader's pencil in the margins, a few lines underlined in ink.

## Screens

Behaviour is in the domain documents. This section says how each main screen should be experienced.

### Desk

```
 Marginalia                         Desk   Library   Notes                          (◯)
─────────────────────────────────────────────────────────────────────────────────────────

  Friday 16 October

  How much time
  do you have?

   5 min        10 min        20 min        30+ min           ⌕  Ask, or paste a link

  ────────────────────────────────────────────────────────────────────────────────────
  CONTINUE
  A field guide to slow software                                         8 min left
  ▬▬▬▬▬▬───────────────────────────────
```

The eye lands on the question, then on the one article already chosen. Time choices are a row of plain numerals in Newsreader, not boxes; the chosen one stays lit. There is no list. It should feel like a tidy desk with one book open on it. Detail: [04](04-desk.md).

### Reader, wide

```
 ← Desk                                                              Aa   ★   ♡   ⋯
                                                                    (fades while reading)
 ▕▔▔                The quiet cost of interruptions
 ▕▔▔▔               example.com · 7 min
 ▕▔▔ •
 ▕▔▔▔▔              ┌ Summary, key claims and a map ─ before you start ┐   (front matter)
 ▕▔▔ •
 ▕▔▔▔               Every interruption costs more than its own      ───── • connection
 ▕▔▔                length: the mind takes minutes to return          Your note on deep work
 ▕▔▔▔▔ •            to where it was, and most days are cut            from March makes the
 ▕▔▔                into pieces too small to return at all.           same claim. ¶14
 ▕▔▔▔
 (paragraph map)    The studies behind this figure are older        ───── • tension
                    than the phones that made it famous…                Later studies found a
                                                                         smaller effect.
```

The text column is centred in the window, as today. Margin notes sit in the right margin at their line's height, in pencil, each with a kind dot and a one-line connector. The eye reads print and glances right, as with a pencil-marked book. Detail: [03](03-reader.md).

### Reader, phone

```
 ← Desk           The quiet cost of…        Aa  ⋯

 Every interruption costs more than its
 own length: the mind takes minutes to
 return to where it was, and most days
 are cut into pieces too small to return•
   ┊ • connection
   ┊ Your note on deep work from March
   ┊ makes the same claim. ¶14
 at all.

 ─────────────────────────────────────────
  Ask        Notes · 2      Listen     Done
```

Margin notes show as a small kind dot at the end of their line. Tapping the dot unfolds the note in the flow, indented with a pencil rule, and the passage stays visible above it (D-DES-026).

### Library, Notes, Settings

See [05](05-library-notes-week.md) and [06](06-sources-and-settings.md) for their mockups. Their shared intent: one column of rows on paper, one question or one job at the top, and nothing boxed that doesn't float.

## The design gate

A rung that touches a screen is done only when all of these hold (D-DES-027):

1. **Comp first.** Before code, a comp or an HTML prototype of the rung's screens and key moments, in Night and Paper, at 1440×900 and 390×844, approved by BK. Brief any worker with this document and the comp, not only the behaviour.
2. **Screenshots in every theme.** After building, screenshots of each touched screen in all six themes at both widths, read against this document. Check: does the eye land where [Hierarchy and restraint](#hierarchy-and-restraint) says? Is anything coloured that isn't someone's mark?
3. **A design review against this document.** Run the `design-review` skill with this document as the brief. "Readable and not broken" is not a pass.
4. **Key moments used, not inspected.** Each moment the rung touches is performed by hand on the deployed app, on a phone as well as a desktop, with reduced motion on and off.
5. **Journeys walked.** The journeys in [The journeys, end to end](#the-journeys-end-to-end) that the rung touches are walked across every part they touch, checking the same words, pen colour and kind names at each hand-off.
6. **Contrast and keyboard.** Every text token at least 4.5:1 in every theme. The full keyboard path still works (`/`, arrows, Enter, `n`, Tab, Esc), and focus is quiet but visible (D-DES-004).
