# 07: Roadmap

## Build philosophy

- Skateboard → scooter → bicycle → motorbike → car. Each rung is a working, deployed Marginalia that BK uses the same day and that feels better in one way he'd notice.
- Each rung fits one working session and ships to https://reader.bhekani.com through `docs/operations.md`. Frontend-only rungs deploy with Vercel. A rung that touches Convex takes a snapshot first and needs BK's approval before the backend deploy.
- At most two new unknowns per rung. A rung that needs a third is split.
- Stop after any rung and the app is whole: no half-migrated screens, no two button systems on one page.
- A rung added later gets a letter (3b), so cited numbers keep their meaning.
- "Tests pass" is required but never enough on its own. "It behaves as specified" isn't enough either. A rung is done when it passes the design gate in [02](02-design-concept.md#the-design-gate) (D-DES-027).
- Every rung starts with a comp or HTML prototype of its screens and moments, in Night and Paper at 1440×900 and 390×844, approved by BK before code.

## Status and order

| Rung | Promise, short | Status (2026-10-16) |
|---|---|---|
| 1 | The pen colour is mine; the reader gets out of the way | Done: live at origin/main `6e2e49a` |
| 2 | The margin talks | Done: live at `67798dc`, accordion open notes at `de6f560` (D-DES-049) |
| 2a | The reader finishes its own redesign | Done: live at `fac7694` (notes-pane split moved to 2b) |
| 2b | Answers beside the text, kept only on purpose | Done: live at `6471b14`; Define → refresh → Keep → Notes walked live on 2026-10-16. Edge cases in `docs/issues/companion-keep-edge-cases.md` |
| 2g | It remembers how I read | Done: live at `82fba7d`; feed history backfilled |
| 3 | The desk asks one question and answers it | Done: live at `8741fbd`; warm pick in 121 ms |
| 3c | Ask by topic, one at a time, fast | Done: a repeated query ~110–150 ms through the direct call and query cache (`221f633`); a new query ~0.8–1.4 s, bound by its embedding |
| 2d | Links wait for me, and saved things come back | Done: live; link menu verified |
| 2e | The summary reads in layers | Done: live at `4c46980` |
| 2c | A critical friend in the margin | Done: live at `a2d16bc`; 111 short unread articles re-annotated. Failed first annotations now retry (`800263e`) |
| 2f | It reads alongside me, and doesn't repeat itself | Done: live at `c24abfd`; unchanged articles skip with no model call, and after a new note the sections ahead got 2–3 notes each (logs, 2026-10-16) |
| 3b | I bring my own (PDF) | Done: live at `28e29c3`, book parts regrouped at `574a233`. Per-part summaries, the book's point from them, passage embeddings and Ask about a book live at `f342745` (Pro Git: 97 summaries, 851 passages; Ask cites Part 22 for rebasing) |
| 4 | Four rooms | Done: live at `27cce50` |
| 5 | Notes is my commonplace book | Done: live at `6730c0b` |
| 5b | Your reading: stats and dictionary | Done: live at `efea4a4` |
| 5c | It learns what I'd read | Live at `23b75b6`: taste profile built (26 signals). No feed or tag-merge suggestion qualifies yet, and no deferred articles exist, so the pre-annotation lift isn't measurable yet (`preAnnotate:preAnnotationReport`) |
| 5d | My ideas, connected | Done: live at `09a1e2c`, edge polish `0f4c280` |
| 6 | Settings are quiet | Done: live at `e1c0e30` |
| 7 | It flies | Live at `a4e3fb7`: title morph seen live (320 ms). Finishing and the sweep checked only in a harness; finishing and the sweep later seen live; Safari and the installed PWA still need BK's hand check (sign-in) |

Build in the order of the table (D-DES-052). Letters keep the numbers already cited; the order, not the number, is the sequence. The product questions that gated rungs are all answered except Q3 and Q4, which BK answers before rung 4. Spikes: S6 before 2f, S9 before 2c, S3 before 3, S5 before 3c, S7 and S8 before 3b, S1 before 7. S3 and S5 are done.

Two fixes shipped outside the rungs and stay: the notes pane no longer blocks the article (D-DES-050), and choosing a time keeps going through every article that fits (D-DES-031).

## Rung 1: Skateboard: "My pen is mine again, and the reader gets out of the way"

**Previously:** the pen colour paints links, drop caps, progress, hovers and settings actions. The reader toolbar has six equal icons, including GitHub and Re-annotate. The Ask pill covers Done at the end.
**Now:** the pen colour appears only on the reader's own marks. The reader toolbar is ← Desk, Aa, ★, ♡ and ⋯. It stays visible while reading and shows a compact title once the heading scrolls away (D-DES-070). The end of the article is clean.

**Promise:** "When I read, the only colour on the page is mine, and nothing sits on top of the text."

**Build:**
- Add the token layers from [02 Visual language](02-design-concept.md#visual-language) to `globals.css`: `--ink*`, `--pencil`, `--pencil-rule`, kind colours, `--danger`, type and motion tokens. Check `--pencil` contrast in all six themes.
- Replace chrome uses of `--pen` with ink or pencil across the about 25 files that use it ([01](01-current-state.md#the-pen-colour-paints-the-interface)). Keep the reader's marks and the pen settings swatches.
- Reader toolbar per [03 Toolbar](03-reader.md#toolbar), including the time-left tooltip on the map (D-DES-022, D-DES-023).
- The Ask pill hides while the back matter is in view ([03](03-reader.md#ask-about-this-article)). Quiet focus on "+ New".
- Run S4. Fix the progress line if it's real.

**Design:** reader screens in all themes. Key moments: opening, finishing (static part). This rung sets the colour rule every later rung follows.

**New unknowns:** contrast of `--pencil` across six themes; whether toolbar fade fights the reader package's own controls.

**Demo:** open an annotated article in Night on desktop and phone. Highlight a passage and see that it is the only saturated colour on screen. Scroll and see the title appear in the toolbar once the heading has gone. Reach the end and press Done without anything covering it.

**Done when:**
- `grep` shows `--pen` used only for marks, the pen and highlighter settings and the reader's notes.
- The design gate passes for the reader in all six themes at both widths.

**Left out:** the margin itself, the desk and navigation.

## Rung 2: Scooter: "The margin talks"

**Previously:** margin notes hide behind underlines and superscript numbers, and one card opens on click.
**Now:** on wide screens, every margin note sits in the margin beside its line in pencil. The reader's own notes and marks show as pen ticks. On a phone, notes unfold under their paragraph.

**Promise:** "I see what Marginalia noticed as I read, without clicking anything, and it never gets in the way of the text."

**Build:** [03 The margin](03-reader.md#the-margin): sidenote layout with collisions and elbows, open-in-place cards, arrival motion, "Reading alongside you…" while annotation runs, pen ticks, phone in-flow unfolding (D-DES-019, D-DES-026). Remove the underline and superscript treatment on wide screens.

**Design:** comps of a heavily annotated article at 1280 px and 1440 px, and a phone with a note unfolded. Key moments: a margin note arriving, waiting on model work, asking.

**New unknowns:** S2 (collision layout and performance); in-flow unfolding versus the reading position on a phone.

**Demo:** open the most annotated article in the library. Scroll and watch notes arrive. Open one, read it, Esc. Repeat on a phone.

**Done when:**
- No overlapping notes at 1280 px or 1440 px on the S2 article.
- Scrolling stays smooth on that article (no long tasks over 50 ms while scrolling in a performance trace).
- The design gate passes, including journey 1 from opening to the end.

**Left out:** Explain, Define and Ask answers move into the margin in rung 2b if the open-in-place card can't take them in this session.

## Rung 2a: "The reader finishes its own redesign"

**Previously:** after rung 2, Notes still sits on the wide toolbar, ★ opens a popover, Back always says "Desk", the paragraph map knows only whether a paragraph is annotated, kept answers mark their passage in the highlighter colour, and the margin card says "Cross-reference". Verified at origin/main `de6f560`: `reader-toolbar.tsx#L109`, `#L122`, `#L137`; `reader-map.tsx#L48`.
**Now:** the reader matches [03](03-reader.md) everywhere rung 1 and 2 didn't reach.

**Promise:** "Everything in the reader is where I expect it, and nothing Marginalia did looks like something I did."

**Build:**
- Notes into ⋯ on wide screens; keep `n` and the badge ([03 Toolbar](03-reader.md#toolbar)).
- ★ scrolls to the impression in the back matter instead of a popover.
- Back names where it returns (Desk, Library, Notes) and restores that room's scroll position ([02 The map](02-design-concept.md#the-map)).
- Paragraph map: kind dots in kind colours, pen ticks for marks, the current position as an ink bar ([03 The paragraph map](03-reader.md#the-paragraph-map)).
- The auto-finish line "Finished · Mark unread" at the end of the back matter ([03 Finishing](03-reader.md#finishing)).
- Notes pane: your words lead with a pen rule; saved answers collapse to one pencil line ([03 Notes panel](03-reader.md#notes-panel)).
- Kept answers mark their passage in pencil, not highlighter ([03 Passage menu](03-reader.md#passage-menu)).
- The margin card and labels say "connection", not "Cross-reference".
- Getting back to where you were after any in-article jump ([03](03-reader.md#getting-back-to-where-you-were), D-DES-053).
- Esc returns to the origin room, unless a menu, note, pane, editor or selection has it.
- Closing an open note animates its content out as it shrinks (rung 2's close is not yet a true reverse).

**Design:** comp of the toolbar, map, back matter and notes pane in Night and Paper at both widths.

**New unknowns:** restoring scroll position across the App Router on Back.

**Demo:** open an article from Library, check Back says Library; press ★ and land on the impression; scroll and see the map's position bar move; finish by reading to the end and see "Finished · Mark unread"; open the notes pane and see your words first.

**Done when:** no Marginalia mark uses `--highlighter`; the design gate passes for the reader.

**Tier:** Standard (frontend only).

## Rung 2b: "Answers beside the text, kept only on purpose"

**Previously:** Explain, Simplify, Define and Ask answer in a separate card, and every answer is saved to Notes automatically (`companion.ts#L204`).
**Now:** every tool answers in the margin beside its passage, in pencil, in the accordion layout from rung 2, as long as it needs to be. Answers stay while the article is open, including a refresh, and are kept only on **Keep**. Reflections still save automatically.

**Promise:** "When I don't know a word or a claim, I find out right here and carry on reading, and nothing is kept unless I choose."

**Build:** [03 Passage menu](03-reader.md#passage-menu) and [Ask about this article](03-reader.md#ask-about-this-article). Each tool gets only its context budget plus the summary as background ([03 What each tool sees](03-reader.md#what-each-tool-sees), D-DES-054). Every Define lookup is recorded for the dictionary whether or not it's kept (D-DES-058). Kept answers carry a source marker so the notes pane can tell them from BK's own notes (deferred from 2a). Answers in the margin column (Ask-about-article answers at the top of the margin; on phones, in the flow). Session-scoped answer storage keyed by article, surviving refresh and cleared when the article closes. **Keep** writes the existing saved-thread record. The passage menu ordered by hand. Length discipline in the tool prompts (backend snapshot and deploy).

**Design:** the approved rung 2b comp (Define, After a refresh, Kept).

**New unknowns:** session storage that survives a refresh but not the article closing.

**Demo:** define a word, read on, refresh, see the definition still there; keep one answer and find it in Notes; close and reopen the article and see the unkept answer gone.

**Done when:** unkept answers never reach Notes; no reader tool navigates away; the design gate passes.

**Tier:** Full (changes what is persisted).

## Rung 2g: "It remembers how I read"

**Previously:** visits, sessions and offer outcomes are recorded (`readingActivity`, `sessions`, `articleInteractions`), but not where BK lingers, and feeds have no outcome counts.
**Now:** time per paragraph is sampled while reading, and per-feed outcomes are counted. Nothing new to look at yet; the history starts accruing now because it can't be filled in later (D-DES-057).

**Promise:** "From today, Marginalia remembers how I read, so the stats and taste it builds later start from real history."

**Build:** sampled paragraph dwell in the reader (batched with the existing checkpoints), per-feed offered/opened/finished/skipped counts. Backend snapshot and deploy.

**Demo:** read an article, then see its paragraph dwell rows and the feed's counts in the Convex dashboard (no UI yet).

**Done when:** dwell is recorded for every visit without measurable scroll cost; counts match `articleInteractions`.

**Tier:** Full (new persisted data).

## Rung 3: Bicycle: "The desk asks one question and answers it"

**Previously:** about twelve equal-weight blocks and nine keycaps. Choosing a time leaves the desk for a differently styled page.
**Now:** the question, one slot, four numerals and the bar. Choosing a time fills the slot with a pick and its reason, usually within 150 ms, and the separate `/session` page becomes a deep link into the desk.

**Promise:** "I open Marginalia, say how long I've got, and there's the thing to read."

**Build:** [04](04-desk.md) in full: hierarchy, time choices, the pick in the slot (D-DES-028), prefetch on intent (S3), Continue with minutes left, no backlog count and no Up next (D-DES-034, D-DES-035), with a minimal Up next shelf and archive added to Library in the same release because the desk's rows are the only place archiving exists today (D-DES-052), empty and error states. Topic search moves to rung 3c; the Saved boost to rung 2d. Keycaps hidden, with the hold-`Alt` overlay and tooltips (D-DES-021). The right-hand column removed.

**Design:** desk comps at both widths. Key moments: first open, choosing time, empty.

**New unknowns:** S3 (prefetch effect); the hold-to-reveal keycap overlay.

**Demo:** cold open the desk. Choose 10, press Another twice, press Read now. Then Esc from the reader back to the desk.

**Done when:**
- The pick appears without a route change, within 150 ms with a warm prefetch, measured on the deployed app.
- The design gate passes for journeys 1 and 2.

**Left out:** the title morph into the reader (rung 7).

## Rung 3c: "Ask by topic, one at a time, fast"

**Previously:** the bar waits 600 ms, then ranks with a model before showing anything, and shows a list (`article-finder.tsx#L63`, `http.ts#L488`).
**Now:** the bar answers a topic with one article at a time: reading time, a reason, Read now, Another and Save for later. The first card appears from the search alone; the model's reason fills in on that card without replacing it.

**Promise:** "I type what I feel like reading about, and the first article is there before I'd have left."

**Build:** [04 Topic search](04-desk.md#topic-search-the-second-way-in). S5 first. With a time chosen, only articles that fit, with a nothing-fits state offering the shortest on the topic. Library keeps the full list. Backend deploy if the search endpoint splits into a fast search and a slower explanation.

**Demo:** type a topic and see the first card at once; press Another twice; choose 10 minutes and type the same topic.

**Done when:** the first card lands within S5's target, measured on the deployed app; the design gate passes.

**Tier:** Standard.

## Rung 2d: "Links wait for me, and saved things come back"

**Previously:** a link in the article navigates away; Saved doesn't affect picks.
**Now:** a link opens a small menu with its title, domain and reading time: **Save for later**, then **Open in background**. Saved articles get a boost in picks within what fits.

**Promise:** "A link I click doesn't take me away, and what I save for later finds me again."

**Build:** [03 Links in the article](03-reader.md#links-in-the-article); [04 Saved gets a boost](04-desk.md#saved-gets-a-boost) (`suggestions.ts`). ⌘-click keeps the browser's behaviour. Save for later imports through `addArticleByUrl` and saves. Backend snapshot and deploy.

**Demo:** click a link in an article, save it for later without leaving; choose a time it fits and see it offered first among close fits.

**Done when:** a plain click on an article link never navigates; the boost never offers an article longer than the window.

**Tier:** Standard.

## Rung 2e: "The summary reads in layers"

**Previously:** the summary opens with the gist; the one point is optional and second; the idea map can cross its own lines (`idea-map.tsx#L61-L112`).
**Now:** the one point first and always present, then the short summary, then a legible idea map.

**Promise:** "One sentence tells me whether to read on, and the map is clear."

**Build:** [03 Front matter](03-reader.md#front-matter). Summary prompt asks for the one point and a legible map (about seven ideas, mostly a tree, few cross-links). A layered-graph layout with crossing minimisation (dagre or elkjs). Older summaries without a one point regenerate on open. Backend snapshot and deploy.

**Demo:** open a long article's summary and read one point, then More, then the map, with no crossed lines.

**Done when:** the map has no edge crossings on the articles tried; the design gate passes.

**Tier:** Standard.

## Rung 2c: "A critical friend in the margin"

**Previously:** four note kinds, 3–7 notes, connections only to vault notes, and the pushback mostly at the end.
**Now:** nine kinds in three families, leaning toward pushback close to balance, budgeted by density and as long as they need to be. Connections reach the whole library, read or unread, with **Save for later** and never a link.

**Promise:** "Beside me, something says where the argument is strong, where it's weak and what it connects to."

**Build:** [02 Note kinds](02-design-concept.md#note-kinds), [03 Connections and discovery](03-reader.md#connections-and-discovery). The same import call writes the one point and short summary (D-DES-054) and one to three tags under the vocabulary rules ([02 Tags](02-design-concept.md#tags), S9 first). Articles over 20 minutes stop being annotated at import; instead picking starts annotating long candidates three ahead, and long articles become offerable before they're annotated ([04 Annotating only what you'll read](04-desk.md#annotating-only-what-youll-read), D-DES-056). This moved here from rung 3 because until this rung every article is annotated at import, so there's nothing to look ahead for. Schema: the new kinds and an article reference on connections (mixed-version safe: the old frontend must render unknown kinds as a plain pencil note). The import-pass prompt for families, lean, density and length, retrieving library articles as well as vault notes. Family colours with the contrast test. Backend snapshot and deploy. After the deploy, re-annotate and tag the unread articles of 20 minutes or less once; longer ones get theirs when they come up (D-DES-052, D-DES-056).

**Design:** comps of a margin with each family and a connection with Save for later.

**New unknowns:** tuning the lean so it reads as fair; library retrieval cost per article.

**Demo:** open a re-annotated article and see a fallacy, an assumption, a strong point and a connection to another article you can save for later.

**Done when:** every kind renders with its family colour at ≥ 4.5:1 for its label; the unread library has been re-annotated; the design gate passes.

**Tier:** Full (schema, re-annotation).

## Rung 2f: "It reads alongside me, and doesn't repeat itself"

**Previously:** annotation runs once, at import.
**Now:** a second pass runs as BK reads, ahead of where he is, informed by what he has marked and asked, and only when something relevant has changed since the last pass.

**Promise:** "The margin fills in ahead of me as I read, and it costs nothing when nothing has changed."

**Build:** [03 Reading alongside](03-reader.md#reading-alongside). S6 first. The article's last-annotated time and context fingerprint. The reading-time pass over passages ahead; existing notes never move. Backend snapshot and deploy.

**Demo:** open an article read yesterday with nothing new: no model call (log). Add a note elsewhere, reopen: new notes appear ahead only.

**Done when:** an unchanged article makes no annotation call on open, measured in logs; the design gate passes.

**Tier:** Full (schema, cost).

## Rung 3b: "I bring my own"

**Previously:** the bar takes a topic or a URL; PDFs can't be read at all.
**Now:** drop a PDF on the bar and it opens as an article, with the margin reading alongside.

**Promise:** "When I already know what I want to read, I hand it over and I'm reading."

**Build:** [04 Bringing your own](04-desk.md#bringing-your-own). Upload to Convex storage, text extraction (S7), the article record, annotation. Long documents and books: sections, the outline, annotation that follows the reading, and picks by next section only ([03 Books and long documents](03-reader.md#books-and-long-documents), [04 Books in picks](04-desk.md#books-in-picks), S8). An article you bring opens straight away. Backend snapshot and deploy.

**Demo:** drop a PDF, read it with notes in the margin, find it later in Library.

**Done when:** a text PDF opens readable within seconds, with headings and paragraphs; the design gate passes.

## Rung 4: Motorbike: "Three rooms"

**Previously:** seven destinations, and eight tabs on a phone.
**Now:** Desk, Library and Notes in the header. Library has shelves (Up next, Saved, Loved, Finished) and stars. Sources, Account and Readers are behind the avatar menu, which also shows source status.

**Promise:** "I know where everything is, and the things I do every day are the only things I see."

**Build:** [05 Library](05-library-notes-week.md#library), restyling the Up next shelf rung 3 added, and [06 The avatar menu](06-sources-and-settings.md#the-avatar-menu). Header and phone bar per [02 The map](02-design-concept.md#the-map). Redirects for `/saved`. Stars instead of `RatingMarks`. One word per idea across UI copy ([02 The mental model](02-design-concept.md#the-mental-model)). Update `docs/reader-guide.md` and `docs/mobile-and-pwa.md` for the new map.

**Design:** comps of the header, phone bar, avatar menu and Library. Walk all five journeys across the new map.

**New unknowns:** the redirect and keyboard map changes (`g s`, `g w`); the phone bar with a Search slot.

**Demo:** from the desk, reach Saved, a loved article, Sources and Readers. Do it on a phone too.

**Done when:**
- Old URLs and shortcuts still land somewhere sensible.
- The design gate passes for journeys 3 and 5.

**Left out:** the Notes rework (rung 5) and the settings form pattern (rung 6).

## Rung 5: "Notes is my commonplace book"

**Previously:** notes and saved AI answers in identical boxes, marks invisible outside the reader, and This week a separate page of counters.
**Now:** your words lead, AI answers collapse, and your highlights appear under their article. Your week moves to the Your reading room in rung 5b.

**Promise:** "Everything I kept from my reading is in one place, in my own hand."

**Build:** [05 Notes](05-library-notes-week.md#notes). The paginated highlights query (backend snapshot and deploy). Clicking a note opens its line with the note open in the margin.

**New unknowns:** the cost of the highlights query; restyling the rhythm chart under the `dataviz` rules.

**Demo:** highlight a line in an article, then find it in Notes. Open it and land back on the line.

**Done when:**
- Journey 4 ends in Notes and returns to the line.
- The design gate passes.

**Left out:** search within Notes (the picker already searches notes).

## Rung 5b: "Your reading, seen"

**Previously:** "This week" shows a few charts and counters; looked-up words aren't findable anywhere.
**Now:** a room of its own, Your reading, with stats as real graphics and a dictionary of every word BK looked up.

**Promise:** "I can see how I read and what I'm drawn to, and every word I learned is in my own dictionary."

**Build:** [05 Your reading](05-library-notes-week.md#your-reading). `/reading` becomes the room; the header gains it after Notes; nothing in the reader links to it. The `dataviz` rules for every chart.

**Design:** comps of the stats and of a dictionary spread, Night and Paper, both widths.

**Done when:** every chart reads correctly in all six themes; a word looked up today appears in the dictionary with its sentence and opens to its line.

**Tier:** Standard.

## Rung 5c: "It learns what I'd read"

**Previously:** picks rank by fit, recency and Saved; long articles are annotated only when they come up.
**Now:** a taste model from recorded behaviour ranks picks and annotates likely reads ahead of time; Sources quietly suggests feeds BK almost always skips; tag merges are suggested.

**Promise:** "What it offers me feels like what I'd choose, and it stops wasting effort on things I never read."

**Build:** taste from finishes, dwell, skips, Another presses, ratings, loves and tags (D-DES-057); ahead-of-time annotation for likely reads (D-DES-056); feed suggestions; tag-merge suggestions (D-DES-059). Every suggestion is BK's to accept.

**Done when:** pre-annotated articles are opened at a measurably higher rate than a random sample; no suggestion acts without BK.

**Tier:** Full (ranking and cost behaviour).

## Rung 5d: "My ideas, connected"

**Previously:** Notes is a list grouped by article, which grows into a pile.
**Now:** Notes opens on a small local graph around one idea, with search; the list is one click away (D-DES-062).

**Promise:** "I can see how my ideas connect, follow one to the next, and think by writing right there."

**Build:** an edges query from what exists (embedding nearness over notes, highlights, kept answers and vault chunks; shared tags; same article; Marginalia connections; BK's own links, a new additive table). A local layout of about 15 nodes (d3-force or the dagre setup from rung 2e, whichever reads better). Edge reasons generated on selection only. A side panel to read, reply and create a connected note. Search to recentre. The list as a toggle. Backend snapshot and deploy.

**Design:** comp of the graph centred on a note, an edge selected with its reason, and a new connected note, in Night and Paper at both widths.

**Done when:** the graph never shows more than about 15 nodes; every edge can say why; a note written from the graph appears in it at once; keyboard users can move between nodes; the design gate passes.

**Tier:** Full (new persisted links, new queries).

## Rung 6: "Settings are quiet"

**Previously:** seven button styles, cards around every section, and technical counts on the surface.
**Now:** one form pattern and five control roles. Details sit behind "Details ▸".

**Promise:** "I set things up once, and when something breaks I see it on the avatar."

**Build:** [06](06-sources-and-settings.md) for Sources, Account and Readers. The failure dot on the avatar.

**New unknowns:** none beyond restyling. Keep it to one session.

**Done when:**
- Only the five control roles appear on settings pages.
- The design gate passes for journey 5.

## Rung 7: Car: "It flies"

**Previously:** pages swap and finishing is a toast-less jump.
**Now:** the title travels from the desk into the reader. Finishing turns the page back to the desk, where the next pick slides in. The highlighter sweeps. Every motion has a reduced-motion form.

**Promise:** "Moving through Marginalia feels like one continuous thing, and it's instant."

**Build:** S1 then View Transitions for desk ↔ reader, with the motion tokens from [02 Motion](02-design-concept.md#motion) applied everywhere. The highlighter sweep. The shared patterns no earlier rung owns: "Saved" shown in place, the 600 ms change wash, errors in place with Retry ([02 Shared patterns](02-design-concept.md#shared-patterns)). A last pass over all key moments. Rewrite `apps/web/DESIGN.md` to record the shipped system, since it describes the current one.

**New unknowns:** S1 (View Transitions in App Router, Safari and the PWA).

**Demo:** journey 1 end to end on desktop and phone, with reduced motion on and off.

**Done when:** every key moment in [02](02-design-concept.md#key-moments) is performed on the deployed app and feels as described.

## After the car (not planned yet)

- An offline reading design, if offline reading is ever taken on (`docs/limitations.md`).
- Sharing a margin note or a passage with its pencil note as an image.
- A reading-lamp theme that warms with the time of day.
